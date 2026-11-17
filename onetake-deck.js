/* onetake-deck: the one-take deck engine. Every <section class="slide"> is a region of one world. One
 * paused master timeline holds the whole take: a camera (camera-rig) that travels between the regions and
 * is operated (a lead, a drift, a landing shake), and a carry (SFC.carry) at every seam.
 *
 * What it reads from the page, and nothing else:
 *   - #frame > #view > (#grounds, #rig > #world > section.slide ...) and the .hud (see index.html).
 *   - Each slide's ground class (ground-evening, ground-dusk, ground-morning, ...) becomes a screen-space
 *     ground that crossfades during the seam. The section itself stays transparent.
 *   - data-carry="<key>": an element on slide N and the element with the same key on slide N+1 are one
 *     object. It travels across the seam (SFC.carry: the box, its color and its radius). The same
 *     authoring as the classic engine.
 *   - data-fragments="N" on a slide, and .frag[data-frag="k"] elements: each forward key reveals the next.
 *   - data-reset on a slide: a hard chapter reset. No carry is needed into it, and none is built.
 *   - data-travel="follow" on a slide: the camera travels with the carry instead of leading it.
 *   - data-shake on a slide: a short landing shake. The last slide has one by default.
 *   - data-in="wipe|num|focus|lift" on a slide's element: how it enters (see build()).
 *   - data-layout="strip" on #world: one long film strip instead of the 4-per-row snake.
 *
 * What it does with them:
 *   - Lays the regions out on a snake path (4 per row), with a small vertical jog per column, so the
 *     camera never travels in a straight line. World size and camera keys follow the slide count.
 *   - Everything on a slide that is not a carry element enters when the camera lands (a fade and a 16 px
 *     rise, staggered in DOM order) and leaves in the first 0.3 s of the next carry. A carry target
 *     arrives with its carry. Fragments enter on their own key.
 *   - The master timeline has a settle frame (stop) per slide and per fragment. The frame between a stop
 *     and its exit is dead still, so a forward key jumps to the exit and plays on to the next stop with
 *     no visible jump. Back plays the same stretch in reverse, 1.6x faster.
 *   - Sends sfc:leave to the slide it leaves and sfc:enter to the slide it lands on, and sends sfc:enter
 *     again once SFC.mountAll() resolves, so packed components restart with their slide.
 *   - ?s=N opens slide N at its settled frame (1-based). ?medium=print shows each region at its final
 *     frame with every fragment in, unscaled (export-pdf.sh and slides-sheet.sh use it). ?play=film plays
 *     the whole take with its holds. ?t=SECONDS parks the take at that time (review shots of a move in
 *     flight). ?motion=reduce takes the reduced-motion path (index.html).
 *   - Reduced motion: every slide change is a 0.45 s crossfade between settled frames. Nothing travels.
 *   - Describes its own take for the craft test and the transitions sheet: OneTakeDeck.BEATS (contiguous
 *     shots with a kind: build, drift, fill, rest, cause, carry), OneTakeDeck.BOUNDARIES (one record per
 *     slide change: go, at, landed, settled, pairs, reset), and master-timeline labels s1..sN (slide n settled) and
 *     go1..go(N-1) (slide n's exit). ?report=boundaries writes the boundaries as JSON into
 *     <script id="sfc-boundaries"> for scripts that read the page with --dump-dom.
 *
 * No clock, no frame loop, no unseeded random: every frame is a pure function of the timeline time.
 * Exposes window.OneTakeDeck for tests and for presenters who want to drive it. */
(function () {
  'use strict';
  const SFC = window.SFC;
  if (!SFC || !window.gsap || !SFC.carry) throw new Error('onetake-deck: load sfc.js, gsap, Flip and the carry and camera-rig components first');

  const PRINT = SFC.medium() === 'print';
  const REDUCED = SFC.reduced();
  const query = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const frame = $('frame'), view = $('view'), groundsEl = $('grounds'), rig = $('rig'), world = $('world');
  const slides = Array.from(world.children).filter((n) => n.matches('section.slide'));
  const N = slides.length;
  if (!N) throw new Error('onetake-deck: no <section class="slide"> in #world');

  // ---------------------------------------------------------------- the world
  const SW = 1920, SH = 1080;                 // one slide is one 1920 x 1080 region
  // Layout. The default is a snake, 4 regions per row. <div id="world" data-layout="strip"> puts every region
  // on one long film strip, left to right, so the camera dollies along it (a story told day by day, a
  // timeline). Either way each column sits a little higher or lower, so a move never runs on a ruler line.
  const STRIP = world.dataset.layout === 'strip';
  const STEP_X = STRIP ? 2000 : 2040, ROW_Y = 1700, COLS = STRIP ? Infinity : 4; // 80 / 120 px of ground between neighbours
  const JOG = STRIP ? [0, 180, 40, 200] : [0, 360, 120, 440];
  const DRIFT = [[14, 6], [-10, 8], [10, 4], [-12, -6]]; // where the camera leans on each settled slide

  const pos = slides.map((_, i) => {
    const row = STRIP ? 0 : Math.floor(i / COLS), c = STRIP ? i : i % COLS, col = row % 2 ? COLS - 1 - c : c; // a snake, or one strip
    return { x: col * STEP_X, y: row * ROW_Y + JOG[col % JOG.length] };
  });
  const W = Math.max(...pos.map((p) => p.x)) + SW, H = Math.max(...pos.map((p) => p.y)) + SH;
  world.style.width = W + 'px';
  world.style.height = H + 'px';
  slides.forEach((s, i) => { s.style.left = pos[i].x + 'px'; s.style.top = pos[i].y + 'px'; });
  const centre = pos.map((p) => [p.x + SW / 2, p.y + SH / 2]);

  // The grounds stay in screen space while the world moves. Each slide's ground class moves to its own
  // layer, and the layers crossfade during the seam.
  const grounds = slides.map((s) => {
    const g = document.createElement('div');
    g.className = 'ground ' + Array.from(s.classList).filter((c) => /^ground-/.test(c)).join(' ');
    if (s.dataset.sfcSurface) g.dataset.sfcSurface = s.dataset.sfcSurface;
    g.setAttribute('aria-hidden', 'true');
    Array.from(s.classList).filter((c) => /^ground-/.test(c)).forEach((c) => s.classList.remove(c));
    groundsEl.appendChild(g);
    return g;
  });

  slides.forEach((s, i) => {
    const sn = s.querySelector('.slide-number');
    if (sn) sn.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(N).padStart(2, '0');
  });

  // ---------------------------------------------------------------- what carries, what enters
  const pairs = slides.map((s, i) => {
    if (i === N - 1 || slides[i + 1].matches('[data-reset]')) return [];
    const out = [];
    s.querySelectorAll('[data-carry]').forEach((a) => {
      const b = slides[i + 1].querySelector('[data-carry="' + CSS.escape(a.dataset.carry) + '"]');
      if (b) out.push([a, b]);
    });
    return out;
  });
  const carryFrom = new Set(), carryTo = new Set();
  pairs.forEach((ps) => ps.forEach(([a, b]) => {
    if (carryTo.has(a)) console.warn('onetake-deck: an element is a carry target and a carry source; give the source its own key', a);
    carryFrom.add(a); carryTo.add(b);
  }));
  const carryAll = Array.from(new Set([...carryFrom, ...carryTo]));
  const holdsCarry = (el) => carryAll.some((c) => el.contains(c));
  const holdsTarget = (el) => Array.from(carryTo).some((c) => el.contains(c));
  // seams that carry nothing (and are not a hard reset) are worth a warning at build time
  pairs.forEach((ps, i) => {
    if (i < N - 1 && !ps.length && !slides[i + 1].matches('[data-reset]')) console.warn('onetake-deck: no data-carry pair from slide ' + (i + 1) + ' to ' + (i + 2) + '; add one, or mark slide ' + (i + 2) + ' data-reset');
  });

  // Items: the largest subtrees with no carry element in them. They enter with their slide and leave with
  // it. A carry source enters like an item and leaves by its carry. A carry target arrives by its carry,
  // and everything inside it comes with it. A container that holds only carry sources is a shell: its own box
  // enters and leaves like an item, and what is inside it enters on top (opacity only, so nothing rises
  // twice). A container that holds a carry target is never staged (the target flies in through it), so it
  // should have no box of its own.
  // Fragments have their own key.
  const inShell = new Set();
  function itemsOf(slide) {
    const out = [];
    (function walk(parent, nested) {
      Array.from(parent.children).forEach((ch) => {
        if (ch.classList.contains('frag') || carryTo.has(ch)) return;
        if (nested) inShell.add(ch);
        if (carryFrom.has(ch)) out.push(ch);
        else if (holdsTarget(ch)) walk(ch, nested); // it has to stay visible for the target to fly in: give it no box
        else if (holdsCarry(ch)) { out.push(ch); walk(ch, true); }
        else out.push(ch);
      });
    })(slide, false);
    return out;
  }
  const items = slides.map(itemsOf);
  const fragsOf = (s, k) => Array.from(s.querySelectorAll('.frag[data-frag="' + k + '"]'));

  // ---------------------------------------------------------------- the take, in seconds
  const T = { entry: 0.5, press: 0.2, carry: 0.8, lead: 0.12, whip: 0.1, drift: 1.0, rest: 1.2, frag: 0.45, fade: 0.3, handoff: 0.08, ground: 0.6, land0: 0.3 };
  const TRAVEL = 'sine.inOut', WHIP = 'power1.inOut';
  const stagger = (n) => Math.min(0.42, 0.08 * Math.max(0, n - 1));
  const key = (t, i, zoom, ease, dx, dy) => {
    const k = { t, x: centre[i][0] + (dx || 0) - W / 2, y: centre[i][1] + (dy || 0) - H / 2, zoom };
    if (ease) k.ease = ease;
    return k;
  };

  // Pass 1: when everything happens. Stops are the settled frames; a stop's exit is the same frame.
  const stops = [], keys = [key(0, 0, 1)], shakes = [], plan = [];
  let landed = T.land0;
  for (let i = 0; i < N; i++) {
    const entryAt = landed - 0.05, driftAt = landed + 0.1;
    const frags = Number(slides[i].dataset.fragments || 0);
    const first = driftAt + T.drift;
    plan[i] = { entryAt, landed, stagger: stagger(items[i].length) };
    // The drift leans the camera a little toward the slide. A print frame is exact: no lean, no zoom.
    const lean = PRINT ? [0, 0] : DRIFT[i % DRIFT.length];
    keys.push({ t: driftAt }, key(first, i, PRINT ? 1 : i === 0 ? 1.025 : 1.02, TRAVEL, lean[0], lean[1]));
    stops.push({ slide: i, frag: 0, t: first, go: first + T.rest });
    for (let k = 1; k <= frags; k++) {
      const last = stops[stops.length - 1], t = last.go + T.frag;
      stops.push({ slide: i, frag: k, t, go: t + T.rest, revealAt: last.go });
    }
    if (i < N - 1) {
      const go = stops[stops.length - 1].go, start = go + T.press;
      const lead = slides[i + 1].dataset.travel === 'follow' ? 0 : T.lead;
      const next = start + T.carry;
      plan[i].seam = { go, start, lead, ps: pairs[i] };
      // A whip is a power1.inOut leg (peak speed 2x the average), so it runs T.whip s longer than the carry to
      // stay under 80 px per frame over the longest world step; a follow is sine.inOut (1.57x) on the carry's window.
      keys.push({ t: start - lead }, key(next - lead + (lead ? T.whip : 0), i + 1, 1, lead ? WHIP : TRAVEL));
      // The last slide lands with a shake, unless it is an annex (data-reset): an appendix after the close lands still.
      if ((i + 1 === N - 1 && !slides[i + 1].matches('[data-reset]')) || slides[i + 1].matches('[data-shake]')) shakes.push({ t: next, amp: 4 });
      landed = next;
    }
  }
  const END = stops[stops.length - 1].go + 0.8;
  keys.push({ t: END });

  // The take as a beat sheet: contiguous shots that cover 0..END. A rest is dead still (the camera
  // included), a drift is the camera leaning a little toward the slide, a cause is the press that starts
  // a carry, a carry is the move, a fill is a fragment coming in. A seam with no pair (data-reset) has no
  // cause: its press window is part of the rest.
  const BEATS = [], BOUNDARIES = [];
  const beat = (kind, t0, t1, slide) => { if (t1 - t0 > 1e-9) BEATS.push({ kind, t0, t1, slide }); };
  slides.forEach((_, i) => {
    const p = plan[i], mine = stops.filter((st) => st.slide === i);
    if (i === 0) { beat('build', 0, p.landed + 0.1, 0); beat('drift', p.landed + 0.1, mine[0].t, 0); }
    else beat('drift', p.landed, mine[0].t, i);
    mine.forEach((st, k) => {
      if (k) beat('fill', mine[k - 1].go, st.t, i);
      const lastStop = k === mine.length - 1;
      const seam = p.seam && lastStop ? p.seam : null;
      if (i === N - 1 && lastStop) beat('rest', st.t, END, i);
      else if (seam && !seam.ps.length) beat('rest', st.t, seam.start, i);
      else beat('rest', st.t, st.go, i);
    });
    if (p.seam) {
      const { go, start, ps } = p.seam, landed = plan[i + 1].landed;
      if (ps.length) beat('cause', go, start, i);
      beat('carry', start, landed, i);
      BOUNDARIES.push({ from: i, to: i + 1, reset: slides[i + 1].matches('[data-reset]'), go, cause: ps.length ? go : null, at: start, landed, settled: stops.find((st) => st.slide === i + 1).t, lead: p.seam.lead, pairs: ps });
    }
  });

  // ---------------------------------------------------------------- build the take
  function imagesLoaded() {
    return Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((res) => {
      img.addEventListener('load', res, { once: true });
      img.addEventListener('error', res, { once: true });
    }))));
  }
  function fontsLoaded() {
    const f = document.fonts;
    if (!f) return Promise.resolve();
    return Promise.all(['600 96px AvantGarde', '300 26px "Salesforce Sans"', '400 26px "Salesforce Sans"', '600 26px "Salesforce Sans"']
      .map((s) => f.load(s))).then(() => f.ready);
  }

  function build() {
    const tl = gsap.timeline({ paused: true });

    // The camera is camera-rig on its own timeline, drawn from the master's updates (composeHF does that in
    // every medium), so seeking the master moves the camera.
    const camTl = SFC.build('camera-rig', rig, { keys, hand: { amp: 3, period: 3.1 }, lattice: !PRINT, seed: 7, shakeOn: shakes });
    SFC.composeHF(tl, [{ root: rig, tl: camTl }]);

    // The carries first, last seam first, before any entrance tween moves a thing: SFC.carry parks each
    // target on its source's box at build, and a source can sit inside an earlier target.
    const carries = [];
    for (let i = N - 2; i >= 0; i--) {
      carries[i] = pairs[i].map(([a, b]) => SFC.carry(a, b, { duration: T.carry, ease: TRAVEL }));
    }

    slides.forEach((s, i) => {
      const its = items[i], p = plan[i];
      // Entrances by kind (data-in on the element): "wipe" opens a photo from its leading edge (clip-path),
      // "num" lifts a big numeral out of its own baseline, H1/H2 come into focus (blur to sharp), everything
      // else lifts. Photos and numerals start arriving while the camera is still travelling, so the next
      // frame shows during the dolly; the rest waits for the landing. Shell children only fade.
      its.forEach((el, k) => {
        const kind = inShell.has(el) ? 'shell' : el.dataset.in || (!PRINT && /^(H1|H2)$/.test(el.tagName) ? 'focus' : 'lift');
        // (Print skips the focus blur: Chrome rasterizes any element that keeps a CSS filter, even
        // blur(0px), so a printed title would lose its text.)
        const early = i > 0 && (kind === 'wipe' || kind === 'num') ? 0.38 : 0;
        const at = p.entryAt - early + (its.length > 1 ? (p.stagger * k) / (its.length - 1) : 0);
        if (kind === 'wipe') {
          tl.fromTo(el, { opacity: 0, clipPath: 'inset(0% 0% 0% 100% round 28px)' }, { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 28px)', duration: 0.9, ease: 'expo.inOut' }, at);
        } else if (kind === 'num') {
          tl.fromTo(el, { opacity: 0, yPercent: 14 }, { opacity: 1, yPercent: 0, duration: 0.8, ease: 'expo.out' }, at);
        } else if (kind === 'focus') {
          tl.fromTo(el, { opacity: 0, y: 26, filter: 'blur(12px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' }, at);
        } else if (kind === 'shell') {
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: T.entry, ease: 'power2.out' }, at);
        } else {
          tl.fromTo(el, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out' }, at);
        }
      });
      const fragStops = stops.filter((st) => st.slide === i && st.frag > 0);
      fragStops.forEach((st) => {
        const els = fragsOf(s, st.frag);
        if (els.length) tl.fromTo(els, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: T.frag, ease: 'power3.out', stagger: 0.05 }, st.revealAt);
      });
      if (i > 0) {
        const prev = plan[i - 1].seam;
        // The ground fades to this slide's while the camera is on its way.
        tl.fromTo(grounds[i], { opacity: 0 }, { opacity: 1, duration: T.ground, ease: 'power1.inOut' }, prev.start + 0.1);
      }
      if (p.seam) {
        const { go, start, ps } = p.seam;
        // The cause: the source is pressed, then it travels.
        ps.forEach(([a]) => {
          tl.fromTo(a, { scale: 1 }, { scale: 0.965, duration: 0.08, ease: 'power2.out', immediateRender: false }, go);
          tl.fromTo(a, { scale: 0.965 }, { scale: 1, duration: 0.12, ease: 'power2.in', immediateRender: false }, go + 0.08);
        });
        carries[i].forEach((c) => tl.add(c, start));
        // Everything else on the slide gets out of the way of the carried box, but only after the carry's
        // handoff (its first tenth): a shell that fades from t0 drags the source down with it, and the pair
        // dips under half visible.
        const leaving = its.filter((el) => !carryFrom.has(el) && !inShell.has(el));
        if (leaving.length) tl.fromTo(leaving, { opacity: 1 }, { opacity: 0, duration: T.fade, ease: 'power1.in', immediateRender: false }, start + T.handoff);
      }
    });

    tl.set({}, {}, END); // the end hold is part of the take
    // Labels: s<n> is slide n settled and go<n> is slide n's exit (n counts slides from 1). stop<k> and
    // exit<k> are the same frames for every stop, fragments included.
    stops.forEach((st, k) => { tl.addLabel('stop' + (k + 1), st.t); tl.addLabel('exit' + (k + 1), st.go); });
    slides.forEach((_, i) => {
      tl.addLabel('s' + (i + 1), stops.find((st) => st.slide === i).t);
      if (i < N - 1) tl.addLabel('go' + (i + 1), stops.filter((st) => st.slide === i).pop().go);
    });
    return tl;
  }

  // ---------------------------------------------------------------- deck engine
  function fit() {
    if (PRINT) { frame.style.transform = 'none'; return; }
    const k = Math.min(innerWidth / SW, innerHeight / SH);
    frame.style.transform = 'translate(' + (innerWidth - SW * k) / 2 + 'px, ' + (innerHeight - SH * k) / 2 + 'px) scale(' + k + ')';
  }
  fit();
  addEventListener('resize', fit);

  const api = window.OneTakeDeck = { slides, stops, pairs, items, keys, T, END, W, H, BEATS, BOUNDARIES, shakes, reduced: REDUCED, current: 0, nav: null, crossfade: null, tl: null, go: null, next: null, prev: null };
  Object.defineProperty(api, 'slide', { get: () => stops[api.current].slide });

  api.ready = Promise.all([fontsLoaded(), imagesLoaded()]).then(() => {
    const tl = api.tl = build();
    frame.classList.add('ready');

    const bar = $('hud-bar'), live = $('hud-live');
    const signal = (i, type) => slides[i].dispatchEvent(new CustomEvent(type, { bubbles: true }));
    const lastStopOf = (s) => stops.reduce((acc, st, k) => (st.slide === s ? k : acc), 0);
    const firstStopOf = (s) => stops.findIndex((st) => st.slide === s);
    const titleOf = (i) => {
      const h = slides[i].querySelector('h1, h2');
      return (h && h.textContent.trim()) || slides[i].getAttribute('aria-label') || '';
    };
    function hud() {
      const s = stops[api.current].slide;
      bar.style.width = (100 * (s + 1) / N) + '%';
      live.textContent = 'Slide ' + (s + 1) + ' of ' + N + ': ' + titleOf(s);
      slides.forEach((el, i) => { if (i === s) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', 'true'); });
    }

    // A slide's sfc:enter goes out once the camera is most of the way there, so its components play as it lands.
    let pendingEnter = null;
    const fireEnter = () => { if (pendingEnter !== null) { const s = pendingEnter; pendingEnter = null; signal(s, 'sfc:enter'); } };
    function stopNav() {
      if (api.nav) { api.nav.kill(); api.nav = null; }
      fireEnter();
    }

    // Reduced motion (and Home/End jumps across more than one slide): a frozen copy of the outgoing frame
    // fades out over the new slide, which is already at its settled frame. Nothing travels.
    function crossfade(k) {
      const ghost = view.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.className = 'xfade';
      ghost.setAttribute('aria-hidden', 'true');
      if (api.crossfade) api.crossfade.progress(1);
      view.after(ghost);
      tl.time(stops[k].t);
      api.crossfade = gsap.fromTo(ghost, { opacity: 1 }, { opacity: 0, duration: 0.45, ease: 'power1.inOut', onComplete: () => ghost.remove() });
      return api.crossfade;
    }

    function go(k) {
      k = Math.max(0, Math.min(stops.length - 1, k));
      const from = api.current;
      if (k === from && !api.nav) return null;
      const A = stops[from], B = stops[k];
      stopNav();
      api.current = k;
      hud();
      const changed = A.slide !== B.slide;
      if (changed) signal(A.slide, 'sfc:leave');
      if (REDUCED || Math.abs(B.slide - A.slide) > 1) {
        crossfade(k);
        if (changed) signal(B.slide, 'sfc:enter');
        return api.crossfade;
      }
      if (k === from + 1) {
        tl.time(A.go); // the same frame as A.t: the hold between them is dead still
        if (changed) pendingEnter = B.slide;
        api.nav = tl.tweenTo(B.t, {
          ease: 'none',
          onUpdate() { if (pendingEnter !== null && api.nav && api.nav.progress() >= 0.45) fireEnter(); },
          onComplete() { fireEnter(); api.nav = null; },
        });
      } else if (k === from - 1) {
        // Back plays the same take in reverse, a little faster, and lands on the earlier stop.
        tl.time(A.t);
        if (changed) pendingEnter = B.slide;
        api.nav = tl.tweenTo(B.go, {
          ease: 'none',
          duration: (A.t - B.go) / 1.6,
          onUpdate() { if (pendingEnter !== null && api.nav && api.nav.progress() >= 0.5) fireEnter(); },
          onComplete() { tl.time(B.t); fireEnter(); api.nav = null; },
        });
      } else {
        tl.time(B.t); // the same stop again: finish it
        if (changed) signal(B.slide, 'sfc:enter');
      }
      return api.nav;
    }
    api.go = go;
    api.next = () => go(api.current + 1);
    api.prev = () => go(api.current - 1);
    api.goSlide = (s) => go(firstStopOf(Math.max(0, Math.min(N - 1, s))));

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      switch (e.key) {
        case 'ArrowRight': case ' ': case 'PageDown': e.preventDefault(); api.next(); break;
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); api.prev(); break;
        case 'Home': e.preventDefault(); go(0); break;
        case 'End': e.preventDefault(); go(stops.length - 1); break;
        case 'f': case 'F':
          if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
          else document.exitFullscreen?.();
          break;
        case 'Escape': if (document.fullscreenElement) document.exitFullscreen?.(); break;
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('a, kbd, button, input, textarea, select, [contenteditable], .no-advance')) return;
      if (window.getSelection && window.getSelection().toString()) return;
      api.next();
    });

    // Start: ?s=N opens slide N settled (print shows every fragment); ?play=film plays the whole take;
    // otherwise slide 1 builds.
    const asked = parseInt(query.get('s'), 10), at = parseFloat(query.get('t'));
    if (Number.isFinite(at)) {
      // Review only: ?t=SECONDS parks the take mid-move, so a headless shot can show a carry in flight.
      tl.time(Math.max(0, Math.min(END, at)));
      api.current = stops.reduce((acc, st, k) => (st.t <= tl.time() + 1e-6 ? k : acc), 0);
    } else if (Number.isFinite(asked)) {
      const s = Math.max(0, Math.min(N - 1, asked - 1));
      api.current = PRINT ? lastStopOf(s) : firstStopOf(s);
      tl.time(stops[api.current].t);
    } else if (query.get('play') === 'film' && !REDUCED && !PRINT) {
      tl.play(0);
    } else if (REDUCED || PRINT) {
      tl.time(stops[0].t);
    } else {
      tl.time(0);
      api.nav = tl.tweenTo(stops[0].t, { ease: 'none', onComplete: () => { api.nav = null; } });
    }
    hud();

    // Review hook: ?report=boundaries writes the boundaries as JSON, for scripts that read the page with
    // --dump-dom (scripts/transitions-sheet.sh).
    if (query.get('report') === 'boundaries') {
      const out = document.createElement('script');
      out.type = 'application/json';
      out.id = 'sfc-boundaries';
      out.textContent = JSON.stringify({ slides: N, end: END, boundaries: BOUNDARIES.map((b) => ({ from: b.from, to: b.to, reset: b.reset, go: b.go, cause: b.cause, at: b.at, landed: b.landed, settled: b.settled, pairs: b.pairs.map(([a]) => a.dataset.carry) })) });
      document.body.appendChild(out);
    }

    // An sfc:enter sent before the components mount is lost, so the current slide gets it once they are ready.
    SFC.mountAll().then(() => signal(stops[api.current].slide, 'sfc:enter')).catch((err) => console.error(err));
    return api;
  }).catch((err) => { console.error(err); throw err; });
})();
