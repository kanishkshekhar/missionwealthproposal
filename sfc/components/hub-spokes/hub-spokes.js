/* hub-spokes: many sources join one hub. The hub lands, the sources land around it, a curve draws from each
 * source into the hub, packets ride the curves in waves (the hub's ring lights on each arrival), and then,
 * with converge on, the curves drain into the hub and the sources settle quiet while the hub stays: many
 * systems, one place. For Data 360, MuleSoft and integration slides.
 * Layout is computed once from the count, never from the clock: 'radial' puts the sources on an ellipse
 * around the hub, 'left' stacks them in a column that flows right into the hub. Curves are cubic, from the
 * side of a source that faces the hub to the hub's edge. Nodes are HTML on opaque plates; curves and packets
 * are one SVG under them. Dash offsets are tweened as SVG attributes (a CSS tween of stroke-dashoffset on a
 * path with pathLength holds its start value), and a plate never fades: it scales in opaque and its text
 * fades in once the plate is whole, so no text ever sits on a fading ground.
 * opts: hub={label, product?, icon?}, sources=[{label, product?, icon?}] (2 to 8), layout='radial'|'left',
 *       waves=2 (1 to 3), converge=true, caption? (a line under the hub, in once the curves have drained).
 *       icon is an image path (a catalog product logo); text always goes in through textContent.
 * Not ambient: it plays once and never repeats. Print and reduced motion show the end: every source and the
 * hub on screen, the curves drained when converge is on (drawn when it is off), the caption in. */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var VW = 1000, VH = 560;
  var HUB_IN = 0.5;
  var SRC_IN = 0.45, SRC_STEP = 0.09;
  var DRAW = 0.7, DRAW_STEP = 0.06;
  var TEXT_IN = 0.25;
  var PACKET = 0.7, PACKET_STEP = 0.07, WAVE_GAP = 0.8;
  var DOT = 0.012; // a packet's length as a share of its curve: with a round cap it reads as a dot
  var DRAIN = 0.7;
  var REST = 0.6;

  var num = function (v, d) { v = Number(v); return Number.isFinite(v) ? v : d; };
  var str = function (v) { return v == null ? '' : String(v); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var pct = function (v) { return Math.round(v * 10000) / 100 + '%'; };

  function el(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function path(cls, d, parent) {
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('class', cls);
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    parent.appendChild(p);
    return p;
  }
  function node(n, cls, parent) {
    var box = el('div', 'sfc-hs-node ' + cls, null, parent);
    var plate = el('div', 'sfc-hs-plate', null, box);
    var body = el('div', 'sfc-hs-body', null, plate);
    if (n.icon) {
      var img = el('img', 'sfc-hs-icon', null, body);
      img.src = n.icon;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
    }
    var words = el('div', 'sfc-hs-words', null, body);
    el('span', 'sfc-hs-label', n.label, words);
    if (n.product) el('span', 'sfc-hs-product', n.product, words);
    return { box: box, plate: plate, body: body };
  }
  function clean(n) {
    if (!n || typeof n !== 'object') return null;
    var label = str(n.label).trim();
    if (!label) return null;
    return { label: label, product: n.product == null ? '' : str(n.product), icon: typeof n.icon === 'string' && n.icon ? n.icon : '' };
  }

  // Where each source sits (centre, in the 1000 x 560 viewBox), and the hub.
  function place(count, layout) {
    var out = [];
    if (layout === 'left') {
      var hub = { x: 760, y: VH / 2 };
      for (var i = 0; i < count; i++) out.push({ x: 200, y: ((i + 0.5) / count) * VH });
      return { hub: hub, src: out };
    }
    var c = { x: VW / 2, y: VH / 2 };
    var rx = 380, ry = 205;
    // Start at the top-left and go round, so two sources never sit straight above and below the hub.
    var a0 = -Math.PI / 2 - Math.PI / count;
    for (var k = 0; k < count; k++) {
      var a = a0 + (k / count) * Math.PI * 2;
      out.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
    }
    return { hub: c, src: out };
  }

  // A curve from the source's side that faces the hub into the hub's rim, bending gently.
  function curve(s, h, sw, sh, hr) {
    var dx = h.x - s.x, dy = h.y - s.y;
    var horiz = Math.abs(dx) * (sh / sw) >= Math.abs(dy);
    var x1 = horiz ? s.x + Math.sign(dx) * sw / 2 : s.x;
    var y1 = horiz ? s.y : s.y + Math.sign(dy) * sh / 2;
    var len = Math.hypot(h.x - x1, h.y - y1) || 1;
    var x2 = h.x - ((h.x - x1) / len) * hr, y2 = h.y - ((h.y - y1) / len) * hr;
    var c1x = horiz ? x1 + (x2 - x1) * 0.5 : x1, c1y = horiz ? y1 : y1 + (y2 - y1) * 0.5;
    var c2x = x2 - (x2 - x1) * 0.25, c2y = y2 - (y2 - y1) * 0.25;
    return 'M' + r1(x1) + ' ' + r1(y1) + ' C' + r1(c1x) + ' ' + r1(c1y) + ' ' + r1(c2x) + ' ' + r1(c2y) + ' ' + r1(x2) + ' ' + r1(y2);
  }

  SFC.define('hub-spokes', {
    duration: 5.9,
    build: function (root, tl, opts) {
      var hubOpts = clean(opts.hub) || { label: 'Hub', product: '', icon: '' };
      var sources = (Array.isArray(opts.sources) ? opts.sources : []).map(clean).filter(Boolean).slice(0, 8);
      var layout = opts.layout === 'left' ? 'left' : 'radial';
      var waves = Math.max(1, Math.min(3, Math.round(num(opts.waves, 2))));
      var converge = opts.converge !== false;
      var caption = str(opts.caption).trim();

      root.textContent = '';
      root.setAttribute('role', 'img');
      var names = sources.map(function (s) { return s.label; });
      root.setAttribute('aria-label', (names.length ? names.join(', ') + ' into ' : '') + hubOpts.label + '.' + (caption ? ' ' + caption : ''));
      root.dataset.layout = layout;

      var stage = el('div', 'sfc-hs-stage', null, root);
      var svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'sfc-hs-wires');
      svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      stage.appendChild(svg);

      var P = place(sources.length, layout);
      // The sizes the curves assume (the CSS sets the same shares of the stage).
      var SW = layout === 'left' ? 230 : 200, SH = 74, HR = 92;

      var hub = node(hubOpts, 'sfc-hs-hub', stage);
      hub.box.style.left = pct(P.hub.x / VW);
      hub.box.style.top = pct(P.hub.y / VH);
      var ring = el('span', 'sfc-hs-ring', null, hub.plate);
      ring.setAttribute('aria-hidden', 'true');

      var src = sources.map(function (s, i) {
        var n = node(s, 'sfc-hs-source', stage);
        n.box.style.left = pct(P.src[i].x / VW);
        n.box.style.top = pct(P.src[i].y / VH);
        n.box.style.width = pct(SW / VW);
        n.d = curve(P.src[i], P.hub, SW, SH, HR);
        n.wire = path('sfc-hs-wire', n.d, svg);
        return n;
      });
      gsap.set(stage.querySelectorAll('.sfc-hs-node'), { xPercent: -50, yPercent: -50 });

      var cap = null;
      if (caption) cap = el('p', 'sfc-hs-caption', caption, root);

      // ---- 1. the hub, then the sources ----
      tl.fromTo(hub.plate, { scale: 0 }, { scale: 1, duration: HUB_IN, ease: 'expo.out' }, 0);
      tl.fromTo(hub.body, { opacity: 0 }, { opacity: 1, duration: TEXT_IN, ease: 'power1.out' }, HUB_IN * 0.8);
      var srcAt = HUB_IN * 0.6;
      src.forEach(function (n, i) {
        var at = srcAt + i * SRC_STEP;
        tl.fromTo(n.plate, { scale: 0 }, { scale: 1, duration: SRC_IN, ease: 'expo.out' }, at);
        tl.fromTo(n.body, { opacity: 0 }, { opacity: 1, duration: TEXT_IN, ease: 'power1.out' }, at + SRC_IN * 0.8);
      });
      var built = srcAt + Math.max(0, src.length - 1) * SRC_STEP + SRC_IN;

      // ---- 2. the curves draw into the hub ----
      var drawAt = built;
      src.forEach(function (n, i) {
        tl.fromTo(n.wire, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: DRAW, ease: 'power2.inOut' }, drawAt + i * DRAW_STEP);
      });
      var drawn = drawAt + Math.max(0, src.length - 1) * DRAW_STEP + DRAW;

      // ---- 3. packets, in waves; the hub's ring lights as each wave arrives ----
      var packetAt = drawn + 0.15;
      var arrivals = [];
      for (var w = 0; w < waves; w++) {
        src.forEach(function (n, i) {
          var p = path('sfc-hs-packet', n.d, svg);
          p.setAttribute('stroke-dasharray', DOT + ' 2');
          gsap.set(p, { opacity: 0, attr: { 'stroke-dashoffset': DOT } });
          var at = packetAt + w * WAVE_GAP + i * PACKET_STEP;
          tl.fromTo(p, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: 'none', immediateRender: false }, at);
          tl.fromTo(p, { attr: { 'stroke-dashoffset': DOT } }, { attr: { 'stroke-dashoffset': -1 + DOT }, duration: PACKET, ease: 'power1.in', immediateRender: false }, at);
          tl.to(p, { opacity: 0, duration: 0.1, ease: 'none' }, at + PACKET - 0.1);
        });
        arrivals.push(packetAt + w * WAVE_GAP + PACKET);
      }
      gsap.set(ring, { opacity: 0, scale: 1 });
      arrivals.forEach(function (at) {
        tl.fromTo(ring, { opacity: 0, scale: 1 }, { opacity: 1, scale: 1.08, duration: 0.12, ease: 'power1.out', immediateRender: false }, at);
        tl.to(ring, { opacity: 0, scale: 1.16, duration: 0.5, ease: 'power1.out' }, at + 0.12);
      });
      var flowed = (arrivals.length ? arrivals[arrivals.length - 1] : packetAt) + 0.62;

      // ---- 4. converge: the curves drain into the hub, the sources settle quiet, the hub stays ----
      var end = flowed;
      if (converge && src.length) {
        // Quiet is a colour, never a fade: the labels go from ink to muted ink, both read from the theme here.
        var cs = getComputedStyle(root);
        var ink = cs.getPropertyValue('--sfc-ink').trim() || cs.color;
        var muted = cs.getPropertyValue('--sfc-ink-muted').trim() || ink;
        var words = [];
        src.forEach(function (n) {
          tl.to(n.wire, { attr: { 'stroke-dashoffset': -1 }, duration: DRAIN, ease: 'power2.in' }, flowed);
          words.push.apply(words, n.box.querySelectorAll('.sfc-hs-label'));
        });
        tl.fromTo(words, { color: ink }, { color: muted, duration: DRAIN, ease: 'power1.inOut', immediateRender: false }, flowed);
        tl.fromTo(hub.plate, { scale: 1 }, { scale: 1.06, duration: DRAIN, ease: 'power2.out', immediateRender: false }, flowed);
        end = flowed + DRAIN;
      }
      if (cap) {
        tl.fromTo(cap, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, end - 0.1);
        end += 0.3;
      }
      tl.to({}, { duration: REST }, Math.max(end, tl.duration()));

      root.__sfcHub = { arrivals: arrivals, drawn: drawn, flowed: flowed, converge: converge };
      return tl;
    },
  });
})();
