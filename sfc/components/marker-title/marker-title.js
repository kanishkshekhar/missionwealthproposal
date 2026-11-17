/* marker-title: a title lands, then a rough marker stroke is drawn under one word or phrase of it.
 * The title is a hero title (AvantGarde, h1 or h2); the stroke is an SVG path under the marked words, drawn with
 * stroke-dashoffset on pathLength 1, so every frame is a pure function of the timeline position.
 * opts: title='Cases close in one conversation', mark='one conversation' (the words to mark; the first match, case
 *       sensitive; when it is missing the last word is marked), level='h2' ('h1' or 'h2'), seed=7 (the stroke's
 *       roughness), rise=0.6 (seconds for the title), draw=0.45 (seconds for the stroke), strokes=2 (1 or 2 passes).
 * All text goes in through textContent. Print and reduced motion show the title with the stroke drawn. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var num = function (v, d) { v = Number(v); return Number.isFinite(v) ? v : d; };
  var str = function (v, d) { return v == null || v === '' ? d : String(v); };

  // A hand-drawn stroke in a 100 x 10 box: one or two passes, each a cubic with seeded wobble.
  function strokePath(seed, passes) {
    var r = SFC.rng(seed);
    var j = function (a) { return (r() * 2 - 1) * a; };
    var d = 'M ' + (1 + j(1)).toFixed(2) + ' ' + (6 + j(0.8)).toFixed(2) +
      ' C ' + (30 + j(4)).toFixed(2) + ' ' + (4.6 + j(0.9)).toFixed(2) + ', ' + (64 + j(4)).toFixed(2) + ' ' + (6.8 + j(0.9)).toFixed(2) +
      ', ' + (99 + j(0.6)).toFixed(2) + ' ' + (5 + j(0.8)).toFixed(2);
    if (passes > 1) {
      d += ' C ' + (70 + j(4)).toFixed(2) + ' ' + (7.4 + j(0.6)).toFixed(2) + ', ' + (36 + j(4)).toFixed(2) + ' ' + (6.2 + j(0.6)).toFixed(2) +
        ', ' + (8 + j(2)).toFixed(2) + ' ' + (7.6 + j(0.6)).toFixed(2);
    }
    return d;
  }

  SFC.define('marker-title', {
    duration: 1.2,
    build: function (root, tl, opts) {
      var title = str(opts.title, 'Cases close in one conversation');
      var mark = str(opts.mark, '');
      var level = opts.level === 'h1' ? 'h1' : 'h2';
      var rise = Math.max(0.1, num(opts.rise, 0.6));
      var draw = Math.max(0.1, num(opts.draw, 0.45));
      var passes = num(opts.strokes, 2) >= 2 ? 2 : 1;

      var at = mark ? title.indexOf(mark) : -1;
      if (at < 0) { // no match: mark the last word
        var cut = title.trimEnd().lastIndexOf(' ');
        at = cut < 0 ? 0 : cut + 1;
        mark = title.slice(at);
      }

      root.textContent = '';
      root.classList.add('sfc-mt');
      var h = document.createElement(level);
      h.className = 'sfc-mt-title';
      if (at > 0) h.appendChild(document.createTextNode(title.slice(0, at)));
      var m = document.createElement('span');
      m.className = 'sfc-mt-mark';
      m.textContent = mark;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'sfc-mt-stroke');
      svg.setAttribute('viewBox', '0 0 100 10');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', strokePath(num(opts.seed, 7), passes));
      path.setAttribute('pathLength', '1');
      svg.appendChild(path);
      m.appendChild(svg);
      h.appendChild(m);
      var rest = title.slice(at + mark.length);
      if (rest) h.appendChild(document.createTextNode(rest));
      root.appendChild(h);

      // The title rises and fades in on its own (no plate behind it fades), then the stroke draws, starting as the
      // title settles.
      tl.fromTo(h, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: rise, ease: 'power3.out', immediateRender: true }, 0);
      tl.fromTo(path, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: draw, ease: 'power2.inOut', immediateRender: true }, rise * 0.85);
      return tl;
    },
  });
})();
