/* SFC runtime: one paused GSAP timeline per component root, played by a per-medium driver.
 * Media (from <html data-sfc-medium>): web (in-view or scrub) | deck (.slide sfc:enter/leave)
 * | hf (HyperFrames seeks a root timeline via composeHF) | print (final frame).
 * Components: SFC.define(id, {duration, build(root, tl, opts), render?(t, root, opts)}); render
 * gets the instance's root and merged opts, so two instances never share drawing state.
 * SFC.build(id, root, opts) builds a component on a paused, undriven timeline so another component can
 * nest it.
 * Sound cues are video only: SFC.cue(tl, t, kind, {strength, x, el}) records one while a component builds, and only
 * in a film (the hf medium, or a page that sets window.SFC_CUES = true before mounting). SFC.cues(rootTl) returns
 * them on the film's clock for window.__events(); the runtime never plays audio in any medium.
 * Sets window.SFC and nothing else. Needs window.gsap only when mounting. */
(function (w) {
  'use strict';
  if (w.SFC) return;
  var registry = {};
  var mounted = new WeakMap();
  var renders = new WeakMap(); // tl -> function (t) bound to its instance's root and opts
  var MEDIA = ['web', 'deck', 'hf', 'print'];
  var cueLog = []; // {tl, t, kind, strength, x, el, id, root} recorded in films only
  var building = null; // the component whose build() is running: {id, root, opts}
  var placed = new WeakMap(); // tl -> its start on the film's root timeline (composeHF), for proxies with no parent
  var tops = new WeakMap(); // mounted tl -> its root element (for data-sfc-at when nothing places the timeline)

  function medium() {
    var m = document.documentElement.dataset.sfcMedium;
    return MEDIA.indexOf(m) < 0 ? 'web' : m;
  }

  function reduced() {
    return medium() !== 'hf' && !!w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function define(id, impl) {
    if (!impl || typeof impl.build !== 'function' || typeof impl.duration !== 'number') {
      throw new TypeError('SFC.define("' + id + '"): impl needs build() and a numeric duration');
    }
    registry[id] = impl;
  }

  // mulberry32: deterministic PRNG in [0, 1).
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function playOnce(root, tl) {
    if (!w.IntersectionObserver) return tl.play();
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); tl.play(); }
    }, { threshold: 0.35 });
    io.observe(root);
  }

  function drive(root, tl, slideState) {
    var m = medium();
    if (m === 'hf') return;
    if (m === 'print' || reduced()) return tl.progress(1);
    if (m === 'deck') {
      if (!slideState) return tl.progress(1); // not inside a .slide: show the final state
      slideState.tl = tl;
      if (slideState.entered) tl.restart();
      return;
    }
    if ('sfcScrub' in root.dataset) {
      if (w.ScrollTrigger) {
        gsap.registerPlugin(ScrollTrigger);
        return ScrollTrigger.create({ trigger: root, animation: tl, scrub: true });
      }
      console.warn('SFC: data-sfc-scrub needs vendor/ScrollTrigger.min.js; playing on view instead');
    }
    playOnce(root, tl);
  }

  // Deck listeners go on before fonts.ready so an sfc:enter fired during mount is not lost.
  function listenSlide(root) {
    var slide = medium() === 'deck' && root.closest('.slide');
    if (!slide) return null;
    var s = { tl: null, entered: false };
    slide.addEventListener('sfc:enter', function () { s.entered = true; if (s.tl && !reduced()) s.tl.restart(); });
    slide.addEventListener('sfc:leave', function () { s.entered = false; if (s.tl && !reduced()) s.tl.pause(0); });
    return s;
  }

  function mount(root, overrides) {
    if (mounted.has(root)) return mounted.get(root);
    var id = root.dataset.sfc;
    var slideState = listenSlide(root);
    var p = Promise.resolve(document.fonts && document.fonts.ready).then(function () {
      var impl = registry[id];
      if (!impl) throw new Error('SFC.mount: no component defined as "' + id + '"');
      if (!w.gsap) throw new Error('SFC.mount: load vendor/gsap.min.js before mounting "' + id + '"');
      var opts;
      try { opts = Object.assign({}, JSON.parse(root.dataset.sfcOpts || '{}'), overrides); } catch (e) {
        throw new Error('SFC.mount: data-sfc-opts on "' + id + '" is not valid JSON');
      }
      var tl = withBuilding(id, root, opts, function () { return impl.build(root, gsap.timeline({ paused: true }), opts); });
      // HyperFrames renders swap gsap.timeline() for a queueing proxy (__hfIsProxy) that is not a Timeline instance.
      if (!(tl instanceof gsap.core.Timeline) && !(tl && tl.__hfIsProxy)) throw new Error('SFC.mount: "' + id + '" build() must return its timeline');
      tops.set(tl, root);
      if (impl.render) {
        var draw = function (t) { impl.render(t, root, opts); };
        renders.set(tl, draw);
        if (medium() !== 'hf') {
          var prev = tl.eventCallback('onUpdate');
          tl.eventCallback('onUpdate', function () { draw(tl.time()); if (prev) prev.apply(tl, arguments); });
        }
      }
      drive(root, tl, slideState);
      return { id: id, root: root, tl: tl };
    });
    mounted.set(root, p);
    p.catch(function () { mounted.delete(root); });
    return p;
  }

  function mountAll(scope) {
    var roots = (scope || document).querySelectorAll('[data-sfc]');
    return Promise.all(Array.prototype.map.call(roots, function (r) { return mount(r); }));
  }

  // HyperFrames: nest each mount at data-sfc-at on the registered root timeline.
  function composeHF(rootTl, mounts) {
    var withRender = [];
    mounts.forEach(function (m) {
      var at = Number(m.root.dataset.sfcAt || 0);
      rootTl.add(m.tl.paused(false), at);
      placed.set(m.tl, at);
      var draw = renders.get(m.tl);
      if (draw) withRender.push({ draw: draw, tl: m.tl, at: at });
    });
    if (!withRender.length) return rootTl;
    var prev = rootTl.eventCallback('onUpdate');
    rootTl.eventCallback('onUpdate', function () {
      var t = rootTl.time();
      withRender.forEach(function (r) {
        r.draw(Math.min(Math.max(t - r.at, 0), r.tl.duration()));
      });
      if (prev) prev.apply(this, arguments);
    });
    return rootTl;
  }

  function withBuilding(id, root, opts, fn) {
    var prev = building;
    building = { id: id, root: root, opts: opts || {} };
    try { return fn(); } finally { building = prev; }
  }

  // Sound cues. A film is the hf medium (HyperFrames renders and component previews) or a page that opts in with
  // window.SFC_CUES = true (a onetake comp that mounts components). Web, deck, doc and print record nothing.
  function cuesOn() { return medium() === 'hf' || w.SFC_CUES === true; }

  // kind: the palette first (whoosh, pop, key, glass, hit, wobble); click, toggle, select, tick, confirm and error
  // only for those exact interface moments. t is on the component's own timeline. x (screen px at 1920 wide) is
  // read from o.el, or the component's root, when the film asks for the cues, unless o.x is given.
  function cue(tl, t, kind, o) {
    if (!cuesOn() || !tl || typeof kind !== 'string') return;
    var b = building || {};
    if (b.opts && b.opts.cues === false) return;
    o = o || {};
    var s = Number(o.strength);
    cueLog.push({ tl: tl, t: Number(t) || 0, kind: kind, strength: Number.isFinite(s) ? Math.min(Math.max(s, 0), 1) : 0.5,
      x: Number.isFinite(Number(o.x)) && o.x != null ? Number(o.x) : null, el: o.el || null, id: b.id || '', root: b.root || null });
  }

  // A cue's time on the film's clock: up the timeline parents to rootTl (each start plus local time over its
  // time scale), else the composeHF placement, else the mounted root's data-sfc-at.
  function filmTime(c, rootTl) {
    var cur = c.tl, time = c.t;
    for (var i = 0; i < 32 && cur && cur !== rootTl; i++) {
      if (placed.has(cur)) return time + placed.get(cur);
      var p = cur.parent;
      if (!p || (w.gsap && p === gsap.globalTimeline) || typeof cur.startTime !== 'function') break;
      time = cur.startTime() + time / (cur.timeScale() || 1);
      cur = p;
    }
    if (cur === rootTl) return time;
    var top = tops.get(cur);
    return time + Number((top && top.dataset.sfcAt) || 0);
  }

  function screenX(c) {
    if (c.x != null) return c.x;
    var el = c.el || c.root;
    if (!el || !el.getBoundingClientRect || !w.innerWidth) return 960;
    var r = el.getBoundingClientRect();
    return Math.round(((r.left + r.width / 2) / w.innerWidth) * 1920);
  }

  // o: {mute: [component ids], kinds: {from: to} to swap a kind, within: an element whose cues alone are wanted}.
  function cues(rootTl, o) {
    o = o || {};
    var mute = o.mute || [], swap = o.kinds || {};
    return cueLog
      .filter(function (c) { return mute.indexOf(c.id) < 0 && (!o.within || (c.root && o.within.contains(c.root))); })
      .map(function (c) {
        return { t: Math.round(filmTime(c, rootTl) * 1000) / 1000, kind: swap[c.kind] || c.kind, strength: c.strength, x: screenX(c), source: c.id };
      })
      .sort(function (a, b) { return a.t - b.t; });
  }

  // A film's window.__events(): its own events plus every component cue, on one clock, by time.
  function events(own, rootTl, o) {
    return (own || []).concat(cues(rootTl, o)).sort(function (a, b) { return a.t - b.t; });
  }

  w.SFC = { define: define, mount: mount, mountAll: mountAll, medium: medium, reduced: reduced, rng: rng, composeHF: composeHF,
    cue: cue, cues: cues, cuesOn: cuesOn, events: events };

  // Nesting: build a defined component on its own paused timeline, with no driver, so another component
  // can place it on its timeline (parentTl.add(tl.paused(false), at)). Render hooks follow the nested
  // timeline in every medium. The root is recorded as mounted, so mount()/mountAll() never build it twice.
  w.SFC.build = function (id, root, opts) {
    var impl = registry[id];
    if (!impl) throw new Error('SFC.build: no component defined as "' + id + '"');
    root.dataset.sfc = id;
    var o = Object.assign({}, opts);
    var tl = withBuilding(id, root, o, function () { return impl.build(root, gsap.timeline({ paused: true }), o); });
    if (impl.render) {
      var draw = function (t) { impl.render(t, root, o); };
      renders.set(tl, draw);
      tl.eventCallback('onUpdate', function () { draw(tl.time()); });
    }
    mounted.set(root, Promise.resolve({ id: id, root: root, tl: tl }));
    return tl;
  };
})(window);
