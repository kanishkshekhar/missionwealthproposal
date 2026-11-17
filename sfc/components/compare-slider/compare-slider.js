/* compare-slider: before and after, in one frame. The two states are stacked; a divider is thrown across the
 * frame, holds, then sweeps slowly to rest, so the final frame (and print) shows both halves side by side.
 * Before sits left of the divider, after sits right of it.
 * Each state: {label, title?, subtitle?, rows?: [{label, value, status?}], src?, alt?}. With src the pane is a
 * picture (a screenshot from a demo org, a phone shot); otherwise the component draws a small screen from title,
 * subtitle and rows, laid out inside its own side of the rest position, so the last frame reads as two whole
 * screens. status on a row (good or warn) puts a dot in that colour by its value. Two pictures stack full frame.
 * opts: before, after, title='' (the group's accessible name), aspect='16 / 10', from=100, throwTo=18, rest=50 (the
 *   divider's place, % from the left, at the start, at the end of the throw, and at rest).
 * Only one value moves: the divider position, a CSS variable on the frame that both the divider and the after pane's
 * left edge read. The after pane is revealed by its wrapper's left edge (overflow hidden), not by a clip-path, and
 * neither pane ever fades, so the text is always at full contrast. The two tags stay put.
 * Not ambient: it plays once. Print and reduced motion show the rest position. */
(function () {
  'use strict';
  var GRAB = 0.3;      // the handle is grabbed
  var THROW = 0.7;     // the throw (power1.out, a quad: its peak speed is twice its average, under 80 px a frame)
  var HOLD = 0.6;      // the after state, seen almost whole
  var SWEEP = 1.6;     // the slow sweep back to rest

  var num = function (v, d) { v = Number(v); return Number.isFinite(v) ? v : d; };
  var str = function (v) { return v == null ? '' : String(v); };
  var pct = function (v, d) { return Math.min(100, Math.max(0, num(v, d))); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function pane(state, which) {
    var s = state && typeof state === 'object' ? state : {};
    var p = el('div', 'sfc-cmp-pane sfc-cmp-' + which);
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', str(s.label) || (which === 'before' ? 'Before' : 'After'));
    if (typeof s.src === 'string' && s.src) {
      var img = el('img', 'sfc-cmp-shot');
      img.src = s.src;
      img.alt = str(s.alt);
      p.appendChild(img);
      return p;
    }
    var screen = el('div', 'sfc-cmp-screen');
    if (s.title != null) screen.appendChild(el('b', 'sfc-cmp-title', str(s.title)));
    if (s.subtitle != null) screen.appendChild(el('span', 'sfc-cmp-subtitle', str(s.subtitle)));
    var rows = Array.isArray(s.rows) ? s.rows : [];
    if (rows.length) {
      var dl = el('dl', 'sfc-cmp-rows');
      rows.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var row = el('div', 'sfc-cmp-row');
        row.appendChild(el('dt', '', str(r.label)));
        var dd = el('dd');
        // The status is a dot beside the value, so the value keeps the ink colour (warn text fails contrast on light).
        if (r.status === 'good' || r.status === 'warn') {
          dd.dataset.status = r.status;
          var dot = el('span', 'sfc-cmp-dot');
          dot.setAttribute('aria-hidden', 'true');
          dd.appendChild(dot);
        }
        dd.appendChild(document.createTextNode(str(r.value)));
        row.appendChild(dd);
        dl.appendChild(row);
      });
      screen.appendChild(dl);
    }
    // The two panes are stacked by design, and the divider crosses their text: tell HyperFrames' layout check so.
    screen.querySelectorAll('b, span, dt, dd').forEach(function (t) {
      t.setAttribute('data-layout-allow-overlap', '');
      t.setAttribute('data-layout-allow-occlusion', '');
    });
    p.appendChild(screen);
    return p;
  }

  function arrows() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M9 7l-5 5 5 5M15 7l5 5-5 5');
    svg.appendChild(path);
    return svg;
  }

  SFC.define('compare-slider', {
    duration: 3.2,
    build: function (root, tl, opts) {
      var before = opts.before && typeof opts.before === 'object' ? opts.before : {};
      var after = opts.after && typeof opts.after === 'object' ? opts.after : {};
      var from = pct(opts.from, 100);
      var to = pct(opts.throwTo, 18);
      var rest = pct(opts.rest, 50);
      var title = str(opts.title);

      root.textContent = '';
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', title || ((str(before.label) || 'Before') + ' and ' + (str(after.label) || 'after')));
      root.setAttribute('data-ui', '');

      var frame = el('div', 'sfc-cmp-frame');
      frame.style.aspectRatio = str(opts.aspect) || '16 / 10';
      frame.style.setProperty('--sfc-cmp-rest', rest + '%');
      frame.appendChild(pane(before, 'before'));
      var reveal = el('div', 'sfc-cmp-reveal');
      // The wrapper's edge cuts through the after pane on purpose: tell HyperFrames' layout check so.
      reveal.setAttribute('data-layout-allow-overflow', '');
      reveal.appendChild(pane(after, 'after'));
      frame.appendChild(reveal);

      var divider = el('div', 'sfc-cmp-divider');
      divider.setAttribute('aria-hidden', 'true');
      var handle = el('span', 'sfc-cmp-handle');
      handle.appendChild(arrows());
      divider.appendChild(handle);
      frame.appendChild(divider);

      var tagBefore = el('span', 'sfc-cmp-tag sfc-cmp-tag-before', str(before.label) || 'Before');
      var tagAfter = el('span', 'sfc-cmp-tag sfc-cmp-tag-after', str(after.label) || 'After');
      tagBefore.setAttribute('aria-hidden', 'true');
      tagAfter.setAttribute('aria-hidden', 'true');
      frame.appendChild(tagBefore);
      frame.appendChild(tagAfter);
      root.appendChild(frame);

      tl.fromTo(frame, { '--sfc-cmp-pos': from + '%' }, { '--sfc-cmp-pos': to + '%', duration: THROW, ease: 'power1.out' }, GRAB);
      tl.to(frame, { '--sfc-cmp-pos': rest + '%', duration: SWEEP, ease: 'sine.inOut' }, GRAB + THROW + HOLD);
      // The grab: the handle tightens as it is thrown, and lets go on the way back.
      tl.fromTo(handle, { scale: 1 }, { scale: 0.88, duration: 0.15, ease: 'power2.out' }, GRAB - 0.15);
      tl.to(handle, { scale: 1, duration: 0.3, ease: 'power2.inOut' }, GRAB + THROW);
      return tl;
    },
  });
})();
