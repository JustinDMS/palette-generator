(function () {
  'use strict';

  const C = window.ColorMath;
  const H = window.Harmony;

  const MIN_COLORS = 2;
  const MAX_COLORS = 10;
  const DEFAULT_COUNT = 5;
  const HISTORY_LIMIT = 100;
  const SHADE_STEP = 0.05; // OKLCH lightness per lighten/darken click (about 5% perceived lightness)

  const ICON = {
    x: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlock: '<svg class="icon" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    sun: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg class="icon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    grip: '<svg class="icon" viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
  };

  /** Matches the CSS breakpoint where swatches stack vertically. */
  const VERTICAL_LAYOUT = window.matchMedia('(max-width: 760px)');

  const state = {
    colors: [], // [{ hex: '#rrggbb', locked: boolean }]
    harmony: 'auto', // selected in the UI ('auto' or a harmony id)
    wheel: 'ryb',
    used: 'analogous', // harmony actually used for the current palette
  };

  const undoStack = [];
  const redoStack = [];

  const $ = (sel) => document.querySelector(sel);
  const els = {
    palette: $('#palette'),
    harmony: $('#harmony-select'),
    wheel: $('#wheel-select'),
    generate: $('#generate-btn'),
    undo: $('#undo-btn'),
    redo: $('#redo-btn'),
    sizeMinus: $('#size-minus'),
    sizeInput: $('#size-input'),
    sizePlus: $('#size-plus'),
    wheelDiscs: document.querySelectorAll('.wheel-disc'),
    wheelSvg: $('#wheel-svg'),
    wheelIcon: $('#wheel-icon'),
    theoryBtn: $('#theory-btn'),
    theoryDialog: $('#theory-dialog'),
    theoryClose: $('#theory-close'),
    harmonyName: $('#harmony-name'),
    harmonyDesc: $('#harmony-desc'),
    fitText: $('#fit-text'),
    wheelNote: $('#wheel-note'),
    contrastText: $('#contrast-text'),
    toast: $('#toast'),
  };

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  const snapshot = () => ({ colors: state.colors.map((c) => ({ ...c })), used: state.used });

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(snap) {
    state.colors = snap.colors.map((c) => ({ ...c }));
    state.used = snap.used;
  }

  function undo() {
    if (!undoStack.length) return;
    closeEditor();
    redoStack.push(snapshot());
    restore(undoStack.pop());
    commit();
  }

  function redo() {
    if (!redoStack.length) return;
    closeEditor();
    undoStack.push(snapshot());
    restore(redoStack.pop());
    commit();
  }

  // ---------------------------------------------------------------------------
  // Palette operations
  // ---------------------------------------------------------------------------

  function slotsFromState() {
    return state.colors.map((c) => ({ hex: c.hex, fixed: c.locked }));
  }

  function regenerate() {
    if (state.colors.length && state.colors.every((c) => c.locked)) {
      toast('All colors are locked — unlock one to generate');
      return;
    }
    closeEditor();
    pushHistory();
    const res = H.generate(slotsFromState(), { harmony: state.harmony, wheel: state.wheel });
    state.colors = res.hexes.map((hex, i) => ({ hex, locked: state.colors[i].locked }));
    state.used = res.harmony;
    commit();
  }

  /** Insert a new harmonious color at `index`, keeping every existing color as-is. */
  function insertColor(index) {
    if (state.colors.length >= MAX_COLORS) {
      toast(`Palettes are limited to ${MAX_COLORS} colors`);
      return;
    }
    pushHistory();
    const slots = state.colors.map((c) => ({ hex: c.hex, fixed: true }));
    slots.splice(index, 0, { hex: null, fixed: false });
    const res = H.generate(slots, { harmony: state.used, wheel: state.wheel });
    state.colors.splice(index, 0, { hex: res.hexes[index], locked: false });
    commit();
  }

  /**
   * Grow or shrink the palette to `target` colors as a single undo step.
   * New colors are appended and fit the current harmony; shrinking drops colors from the end,
   * unlocked ones first, so locked colors are only removed when nothing else is left to remove.
   */
  function resizePalette(target) {
    const n = state.colors.length;
    const size = C.clamp(Math.round(target), MIN_COLORS, MAX_COLORS);
    if (size !== target) toast(`Palettes can have ${MIN_COLORS}–${MAX_COLORS} colors`);
    if (size === n) return;
    closeEditor();
    pushHistory();
    if (size > n) {
      const slots = state.colors.map((c) => ({ hex: c.hex, fixed: true }));
      for (let i = n; i < size; i++) slots.push({ hex: null, fixed: false });
      const res = H.generate(slots, { harmony: state.used, wheel: state.wheel });
      for (let i = n; i < size; i++) state.colors.push({ hex: res.hexes[i], locked: false });
    } else {
      let excess = n - size;
      for (let i = n - 1; i >= 0 && excess > 0; i--) {
        if (!state.colors[i].locked) {
          state.colors.splice(i, 1);
          excess--;
        }
      }
      state.colors.splice(state.colors.length - excess, excess);
    }
    commit();
  }

  function removeColor(index) {
    if (state.colors.length <= MIN_COLORS) return;
    pushHistory();
    state.colors.splice(index, 1);
    commit();
  }

  function moveColor(from, to) {
    if (from === to || to < 0 || to >= state.colors.length) return;
    pushHistory();
    const [col] = state.colors.splice(from, 1);
    state.colors.splice(to, 0, col);
    commit();
  }

  // Hue, chroma and intended lightness carried across repeated lighten/darken clicks on a
  // swatch, so stepping toward white or black (where chroma must shrink to stay in gamut, and
  // the last step gets clipped) and back retraces the same colors instead of drifting.
  // Keyed by index; only reused while the swatch still shows the color the last step produced.
  const shadeMemo = new Map();

  /**
   * Lighten (dir = 1) or darken (dir = -1) a color: the nearest color with the same OKLCH hue
   * and chroma but a lightness one step brighter or darker. Chroma is reduced only as far as
   * needed to stay in sRGB, and the step repeats until the hex value actually changes.
   */
  function shiftLightness(index, dir) {
    const current = state.colors[index].hex;
    const lch = C.hexToOklch(current);
    const memo = shadeMemo.get(index);
    const target = memo && memo.hex === current ? memo : { h: lch.h, c: lch.c, l: lch.l };
    let L = target.l;
    let hex;
    do {
      L += dir * SHADE_STEP;
      hex = C.oklchToHex(C.clamp(L, 0, 1), target.c, target.h);
    } while (hex === current && L > 0 && L < 1);
    if (hex === current) return;
    closeEditor();
    pushHistory();
    state.colors[index] = { hex, locked: true };
    shadeMemo.set(index, { hex, h: target.h, c: target.c, l: L });
    commit();
  }

  function toggleLock(index) {
    pushHistory();
    state.colors[index].locked = !state.colors[index].locked;
    commit();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function commit() {
    render();
    saveHash();
  }

  function render() {
    renderPalette();
    renderInsights();
    els.undo.disabled = !undoStack.length;
    els.redo.disabled = !redoStack.length;
    const n = state.colors.length;
    els.sizeMinus.disabled = n <= MIN_COLORS;
    els.sizePlus.disabled = n >= MAX_COLORS;
    if (document.activeElement !== els.sizeInput) els.sizeInput.value = n;
    els.harmony.value = state.harmony;
    els.wheel.value = state.wheel;
  }

  function buildSwatch() {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.setAttribute('role', 'group');
    sw.innerHTML = `
      <div class="swatch-tools">
        <button class="tool drag-handle" type="button">${ICON.grip}</button>
        <button class="tool" type="button" data-action="remove" title="Remove color" aria-label="Remove color">${ICON.x}</button>
        <button class="tool" type="button" data-action="copy" title="Copy hex" aria-label="Copy hex">${ICON.copy}</button>
        <button class="tool" type="button" data-action="lighten" title="Lighten" aria-label="Lighten">${ICON.sun}</button>
        <button class="tool" type="button" data-action="darken" title="Darken" aria-label="Darken">${ICON.moon}</button>
        <button class="tool lock" type="button" data-action="lock"></button>
      </div>
      <div class="swatch-label">
        <button class="hex-btn" type="button" data-action="edit" aria-haspopup="dialog" aria-expanded="false" title="Edit color"></button>
        <div class="swatch-meta"></div>
      </div>
      <button class="insert insert-before" type="button" data-action="insert" data-offset="0" title="Insert a color here" aria-label="Insert a color at the start">${ICON.plus}</button>
      <button class="insert insert-after" type="button" data-action="insert" data-offset="1" title="Insert a color here">${ICON.plus}</button>`;
    return sw;
  }

  /** Apply color-dependent visuals to a swatch. */
  function paintSwatch(sw, hex) {
    sw.style.setProperty('--swatch', hex);
    sw.style.setProperty('--ink', C.inkFor(hex));
    const [r, g, b] = C.hexToRgb(hex).map((v) => Math.round(v * 255));
    const { l, c, h } = C.hexToOklch(hex);
    sw.querySelector('.swatch-meta').innerHTML =
      `RGB ${r} ${g} ${b}<br>OKLCH ${(l * 100).toFixed(0)}% ${c.toFixed(3)} ${c < 0.002 ? '—' : h.toFixed(0) + '°'}`;
    sw.querySelector('.hex-btn').textContent = hex.slice(1).toUpperCase();
  }

  function updateSwatch(sw, col, i, n) {
    sw.dataset.index = i;
    sw.setAttribute('aria-label', `Color ${i + 1} of ${n}${col.locked ? ', locked' : ''}`);
    sw.classList.toggle('is-locked', col.locked);
    paintSwatch(sw, col.hex);

    sw.querySelector('.hex-btn').setAttribute('aria-label', `Edit color ${i + 1}, ${col.hex.slice(1).toUpperCase()}`);

    const lock = sw.querySelector('.lock');
    lock.innerHTML = col.locked ? ICON.lock : ICON.unlock;
    lock.setAttribute('aria-pressed', String(col.locked));
    lock.title = col.locked ? 'Unlock color' : 'Lock color';
    lock.setAttribute('aria-label', lock.title);

    const handle = sw.querySelector('.drag-handle');
    handle.title = 'Drag to reorder (or use arrow keys)';
    handle.setAttribute('aria-label', `Reorder color ${i + 1} of ${n}: use arrow keys`);

    sw.querySelector('[data-action="remove"]').disabled = n <= MIN_COLORS;
    sw.querySelector('[data-action="lighten"]').disabled = col.hex === '#ffffff';
    sw.querySelector('[data-action="darken"]').disabled = col.hex === '#000000';
    // One insert button between each pair, plus one at each end of the palette.
    const before = sw.querySelector('.insert-before');
    const after = sw.querySelector('.insert-after');
    before.hidden = i !== 0 || n >= MAX_COLORS;
    after.hidden = n >= MAX_COLORS;
    after.setAttribute('aria-label', i === n - 1 ? 'Insert a color at the end' : `Insert a color after color ${i + 1}`);
  }

  function renderPalette() {
    const n = state.colors.length;
    // Reuse swatch elements so colors animate between generations.
    while (els.palette.children.length > n) els.palette.lastElementChild.remove();
    while (els.palette.children.length < n) els.palette.appendChild(buildSwatch());
    state.colors.forEach((col, i) => updateSwatch(els.palette.children[i], col, i, n));
  }

  function wheelPoint(angle, r) {
    const t = (angle * Math.PI) / 180; // 0° at the top, clockwise
    return [r * Math.sin(t), -r * Math.cos(t)];
  }

  function renderWheelDisc() {
    const wheel = H.WHEELS[state.wheel];
    const stops = [];
    for (let a = 0; a <= 360; a += 10) {
      stops.push(`${C.oklchToHex(0.7, 0.16, wheel.fromWheel(a))} ${a}deg`);
    }
    const background =
      `radial-gradient(closest-side, #a3a3a3, rgba(163,163,163,0.55) 25%, rgba(163,163,163,0) 80%), conic-gradient(${stops.join(', ')})`;
    els.wheelDiscs.forEach((disc) => (disc.style.background = background));
  }

  /**
   * Wheel overlay: the ideal harmony geometry plus each color at (hue angle, chroma radius).
   * `compact` draws the small toolbar icon: bigger dots, solid guides, no spokes behind polygons.
   */
  function wheelMarkup(analysis, compact) {
    const R = 96;
    const f = (v) => v.toFixed(1);
    let svg = '';
    if (analysis.fit) {
      const angles = [...new Set(analysis.offsets.map((o) => analysis.fit.a0 + o))];
      const pts = angles.map((a) => wheelPoint(a, R));
      const hasPoly = pts.length >= 3 && state.used !== 'analogous';
      const poly = hasPoly ? `<polygon points="${pts.map((p) => p.map(f).join(',')).join(' ')}"/>` : '';
      const lines = compact && hasPoly ? '' : `<path d="${pts.map(([x, y]) => `M0 0L${f(x)} ${f(y)}`).join('')}"/>`;
      const [under, over, dash] = compact ? [16, 8, ''] : [3.5, 1.5, ' stroke-dasharray="4 3"'];
      svg += `<g fill="none" stroke="rgba(0,0,0,.35)" stroke-width="${under}" stroke-linejoin="round">${lines}${poly}</g>`;
      svg += `<g fill="none" stroke="#fff" stroke-width="${over}" stroke-linejoin="round"${dash}>${lines}${poly}</g>`;
    }
    if (!compact) svg += '<circle r="3" fill="#fff" stroke="rgba(0,0,0,.4)"/>';
    const [dot, ring] = compact ? [19, 7] : [9.5, 2.5];
    for (const p of analysis.points) {
      const r = p.chromatic ? 18 + Math.min(1, p.lch.c / 0.22) * 70 : 0;
      const [x, y] = wheelPoint(p.angle, r);
      svg += `<circle cx="${f(x)}" cy="${f(y)}" r="${dot}" fill="${p.hex}" stroke="#fff" stroke-width="${ring}"/>`;
      if (!compact) svg += `<circle cx="${f(x)}" cy="${f(y)}" r="11" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`;
    }
    return svg;
  }

  function renderInsights() {
    const hexes = state.colors.map((c) => c.hex);
    const info = H.HARMONIES[state.used];
    const analysis = H.analyze(hexes, state.used, state.wheel);

    els.wheelIcon.innerHTML = wheelMarkup(analysis, true);
    els.wheelSvg.innerHTML = wheelMarkup(analysis, false);
    els.theoryBtn.title = `Color theory: ${info.name}`;

    els.harmonyName.textContent = state.harmony === 'auto' ? `${info.name} · auto` : info.name;
    els.harmonyDesc.textContent = info.desc;
    els.wheelNote.textContent = `${H.WHEELS[state.wheel].note} Lightness and chroma are balanced in OKLCH.`;
    els.fitText.innerHTML = describeFit(analysis, info);
    els.contrastText.textContent = describeContrast(hexes);
  }

  function describeFit(analysis, info) {
    if (analysis.chromaticCount === 0) {
      return 'All colors are near-neutral, so hue harmony doesn’t apply — contrast comes from lightness alone.';
    }
    if (analysis.chromaticCount === 1) {
      return 'Only one color carries a clear hue; the others are neutrals that pair with anything.';
    }
    const rms = analysis.fit.rms;
    const label = rms < 5 ? 'Excellent' : rms < 12 ? 'Good' : rms < 25 ? 'Loose' : 'Off-harmony';
    let text = `Hues sit within <strong>±${rms.toFixed(1)}°</strong> of the ideal ${info.name.toLowerCase()} angles <span class="pill">${label}</span>`;
    const closest = analysis.closest;
    if (closest && closest.id !== state.used && closest.rms + 3 < rms) {
      text += ` — closer to <strong>${H.HARMONIES[closest.id].name}</strong> (±${closest.rms.toFixed(1)}°).`;
    }
    return text;
  }

  function describeContrast(hexes) {
    let best = null;
    let passing = 0;
    let pairs = 0;
    for (let i = 0; i < hexes.length; i++) {
      for (let j = i + 1; j < hexes.length; j++) {
        const ratio = C.contrastRatio(hexes[i], hexes[j]);
        pairs++;
        if (ratio >= 4.5) passing++;
        if (!best || ratio > best.ratio) best = { a: hexes[i], b: hexes[j], ratio };
      }
    }
    if (!best) return '';
    const grade = best.ratio >= 7 ? 'AAA' : best.ratio >= 4.5 ? 'AA' : best.ratio >= 3 ? 'AA large text only' : 'too low for text';
    return `Strongest text pairing: ${best.a.toUpperCase()} / ${best.b.toUpperCase()} at ${best.ratio.toFixed(1)}:1 (${grade}). ` +
      `${passing} of ${pairs} pairs meet WCAG AA for body text.`;
  }

  // ---------------------------------------------------------------------------
  // URL hash (shareable palettes): #c=264653-2a9d8f!-e9c46a&h=auto&w=ryb&u=triadic
  // A trailing "!" marks a locked color.
  // ---------------------------------------------------------------------------

  function encodeHash() {
    const c = state.colors.map((col) => col.hex.slice(1) + (col.locked ? '!' : '')).join('-');
    return `c=${c}&h=${state.harmony}&w=${state.wheel}&u=${state.used}`;
  }

  function saveHash() {
    const hash = '#' + encodeHash();
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function loadHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const colors = (params.get('c') || '')
      .split('-')
      .map((token) => {
        const hex = C.parseHex(token.replace('!', ''));
        return hex ? { hex, locked: token.endsWith('!') } : null;
      })
      .filter(Boolean);
    if (colors.length < MIN_COLORS || colors.length > MAX_COLORS) return false;

    const h = params.get('h');
    const w = params.get('w');
    const u = params.get('u');
    state.colors = colors;
    state.harmony = h === 'auto' || H.HARMONIES[h] ? h : 'auto';
    state.wheel = H.WHEELS[w] ? w : 'ryb';
    state.used = H.HARMONIES[u] ? u : state.harmony !== 'auto' ? state.harmony : 'analogous';
    return true;
  }

  // ---------------------------------------------------------------------------
  // Clipboard & toast
  // ---------------------------------------------------------------------------

  let toastTimer = 0;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`Copied ${label}`);
  }

  function exportPalette(kind) {
    const hexes = state.colors.map((c) => c.hex);
    switch (kind) {
      case 'hex':
        return copyText(hexes.join(', '), 'HEX values');
      case 'css':
        return copyText(`:root {\n${hexes.map((h, i) => `  --color-${i + 1}: ${h};`).join('\n')}\n}`, 'CSS variables');
      case 'json':
        return copyText(JSON.stringify(hexes, null, 2), 'JSON');
      case 'link':
        saveHash();
        return copyText(location.href, 'share link');
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const swatchIndex = (el) => Number(el.closest('.swatch').dataset.index);

  els.palette.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const i = swatchIndex(btn);
    switch (btn.dataset.action) {
      case 'remove': return removeColor(i);
      case 'lock': return toggleLock(i);
      case 'lighten': return shiftLightness(i, 1);
      case 'darken': return shiftLightness(i, -1);
      case 'copy': return copyText(state.colors[i].hex.toUpperCase(), state.colors[i].hex.toUpperCase());
      case 'insert': return insertColor(i + Number(btn.dataset.offset));
      case 'edit': return editor.index === i ? closeEditor() : openEditor(i, btn);
    }
  });

  // --- Color editor popover (RGB / HSL) --------------------------------------

  const EDITOR_MODES = {
    rgb: { labels: ['R', 'G', 'B'], names: ['Red', 'Green', 'Blue'], max: [255, 255, 255] },
    hsl: { labels: ['H', 'S', 'L'], names: ['Hue (degrees)', 'Saturation (%)', 'Lightness (%)'], max: [360, 100, 100] },
  };
  const MODE_KEY = 'palette-harmony:editor-mode';

  const editor = {
    el: $('#color-editor'),
    hex: $('#editor-hex'),
    preview: document.querySelector('#color-editor .popover-preview'),
    modeButtons: [...document.querySelectorAll('#color-editor [data-mode]')],
    labels: [...document.querySelectorAll('#color-editor .ch-label')],
    ranges: [...document.querySelectorAll('#color-editor input[type="range"]')],
    numbers: [...document.querySelectorAll('#color-editor input[type="number"]')],
    mode: 'rgb',
    // HSL is kept separately while editing so hue/saturation survive round trips through
    // hex (e.g. dragging lightness to 0% and back doesn't reset the hue to red).
    hsl: [0, 0, 0], // h 0..360, s 0..100, l 0..100
    index: null, // swatch being edited, or null when closed
    anchor: null,
    recorded: false, // whether this editing session has pushed an undo step yet
  };

  const toByte = (v) => Math.round(v * 255);

  function hslFromHex(hex) {
    const [h, s, l] = C.rgbToHsl(C.hexToRgb(hex));
    return [h, s * 100, l * 100];
  }

  const hexFromHsl = ([h, s, l]) => C.rgbToHex(C.hslToRgb(h, s / 100, l / 100));

  function setEditorMode(mode) {
    editor.mode = EDITOR_MODES[mode] ? mode : 'rgb';
    try {
      localStorage.setItem(MODE_KEY, editor.mode);
    } catch {}
    const cfg = EDITOR_MODES[editor.mode];
    editor.modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === editor.mode)));
    for (let ch = 0; ch < 3; ch++) {
      editor.labels[ch].textContent = cfg.labels[ch];
      editor.ranges[ch].max = cfg.max[ch];
      editor.numbers[ch].max = cfg.max[ch];
      editor.ranges[ch].setAttribute('aria-label', cfg.names[ch]);
      editor.numbers[ch].setAttribute('aria-label', `${cfg.names[ch]} value`);
    }
    if (editor.index !== null) syncEditor();
  }

  function openEditor(i, anchor) {
    closeEditor();
    editor.index = i;
    editor.anchor = anchor;
    editor.recorded = false;
    anchor.setAttribute('aria-expanded', 'true');
    editor.el.hidden = false;
    syncEditor();
    positionEditor();
    editor.hex.focus();
    editor.hex.select();
  }

  function closeEditor({ restoreFocus = false } = {}) {
    if (editor.index === null) return;
    editor.el.hidden = true;
    editor.anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) editor.anchor.focus();
    editor.index = null;
    editor.anchor = null;
  }

  /** Each slider's track previews that channel across its range, holding the others fixed. */
  function trackGradient(ch, rgb) {
    if (editor.mode === 'rgb') {
      const lo = rgb.slice();
      const hi = rgb.slice();
      lo[ch] = 0;
      hi[ch] = 255;
      return `linear-gradient(to right, rgb(${lo}), rgb(${hi}))`;
    }
    const [h, s, l] = editor.hsl;
    if (ch === 0) {
      const stops = [0, 60, 120, 180, 240, 300, 360].map((x) => `hsl(${x}, ${s}%, ${l}%)`);
      return `linear-gradient(to right, ${stops.join(', ')})`;
    }
    if (ch === 1) return `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    return `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
  }

  /**
   * Reflect the edited color in every control, except the field the user is typing in.
   * `keepHsl` is set when the change came from an HSL control, so the stored HSL stays exact.
   */
  function syncEditor(skip = null, keepHsl = false) {
    const hex = state.colors[editor.index].hex;
    const rgb = C.hexToRgb(hex).map(toByte);
    if (!keepHsl) editor.hsl = hslFromHex(hex);
    const values = editor.mode === 'rgb' ? rgb : editor.hsl.map(Math.round);
    editor.preview.style.background = hex;
    if (skip !== editor.hex) editor.hex.value = hex.slice(1).toUpperCase();
    values.forEach((v, ch) => {
      editor.ranges[ch].value = v;
      if (skip !== editor.numbers[ch]) editor.numbers[ch].value = v;
      editor.ranges[ch].style.background = trackGradient(ch, rgb);
    });
  }

  function positionEditor() {
    if (editor.index === null) return;
    const gutter = 16;
    const a = editor.anchor.getBoundingClientRect();
    const w = editor.el.offsetWidth;
    const h = editor.el.offsetHeight;
    const left = C.clamp(a.left + a.width / 2 - w / 2, gutter, window.innerWidth - w - gutter);
    const below = a.bottom + 8;
    const top = below + h <= window.innerHeight - gutter ? below : Math.max(gutter, a.top - 8 - h);
    editor.el.style.left = `${left}px`;
    editor.el.style.top = `${top}px`;
  }

  function applyEditorColor(hex, source, keepHsl = false) {
    const i = editor.index;
    if (hex !== state.colors[i].hex || !state.colors[i].locked) {
      if (!editor.recorded) {
        pushHistory();
        editor.recorded = true;
      }
      state.colors[i] = { hex, locked: true };
      commit();
    }
    syncEditor(source, keepHsl);
  }

  editor.el.addEventListener('input', (e) => {
    const t = e.target;
    if (t === editor.hex) {
      const hex = C.parseHex(t.value);
      if (hex) applyEditorColor(hex, t);
      return;
    }
    const ch = Number(t.dataset.channel);
    const v = parseInt(t.value, 10);
    if (Number.isNaN(v)) return;
    const value = C.clamp(v, 0, EDITOR_MODES[editor.mode].max[ch]);
    const source = t.type === 'number' ? t : null;
    if (editor.mode === 'rgb') {
      const rgb = C.hexToRgb(state.colors[editor.index].hex).map(toByte);
      rgb[ch] = value;
      applyEditorColor(C.rgbToHex(rgb.map((x) => x / 255)), source);
    } else {
      editor.hsl[ch] = value;
      applyEditorColor(hexFromHsl(editor.hsl), source, true);
    }
  });

  editor.modeButtons.forEach((b) => b.addEventListener('click', () => setEditorMode(b.dataset.mode)));

  // Tidy up partial input (e.g. an invalid hex or an empty number) when leaving a field.
  editor.el.addEventListener('focusout', (e) => {
    if (editor.index !== null && e.target.matches('input')) syncEditor(null, true);
  });

  try {
    setEditorMode(localStorage.getItem(MODE_KEY) || 'rgb');
  } catch {
    setEditorMode('rgb');
  }

  editor.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target.matches('input'))) {
      e.preventDefault();
      closeEditor({ restoreFocus: true });
    }
  });

  // Click outside closes; the hex button handles its own toggle.
  document.addEventListener('pointerdown', (e) => {
    if (editor.index === null) return;
    if (editor.el.contains(e.target) || editor.anchor.contains(e.target)) return;
    closeEditor();
  });

  window.addEventListener('resize', positionEditor);
  window.addEventListener('scroll', positionEditor, true);

  // Keyboard reordering: arrow keys on the grip, or Alt + arrow keys on any swatch control.
  els.palette.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step || !e.target.closest('.swatch')) return;
    const onHandle = !!e.target.closest('.drag-handle');
    if (!onHandle && !e.altKey) return;
    e.preventDefault();
    const i = swatchIndex(e.target);
    const j = i + step;
    if (j < 0 || j >= state.colors.length) return;
    // Keep focus on the same control, now in the color's new position.
    const selector = onHandle ? '.drag-handle' : `[data-action="${e.target.closest('[data-action]')?.dataset.action}"]`;
    moveColor(i, j);
    els.palette.children[j].querySelector(selector)?.focus();
  });

  // --- Drag to reorder -------------------------------------------------------
  // Mouse: drag the swatch from anywhere that isn't a control. Touch/pen: drag by the grip,
  // so swiping elsewhere still scrolls the page.

  const DRAG_THRESHOLD = 5;
  let pendingDrag = null;
  let drag = null;

  els.palette.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    const onHandle = !!e.target.closest('.drag-handle');
    const onControl = !!e.target.closest('button, input, label');
    if (!onHandle && (e.pointerType !== 'mouse' || onControl)) return;
    if (!onHandle) e.preventDefault(); // no text selection while dragging the background
    pendingDrag = { sw, index: Number(sw.dataset.index), pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  });

  function startDrag() {
    const swatches = [...els.palette.children];
    drag = {
      ...pendingDrag,
      vertical: VERTICAL_LAYOUT.matches,
      swatches,
      rects: swatches.map((s) => s.getBoundingClientRect()),
      target: pendingDrag.index,
    };
    pendingDrag = null;
    els.palette.classList.add('is-dragging');
    drag.sw.classList.add('is-dragged');
  }

  function moveDrag(e) {
    const { vertical, rects, index, swatches } = drag;
    const start = (r) => (vertical ? r.top : r.left);
    const end = (r) => (vertical ? r.bottom : r.right);
    const own = rects[index];
    const size = end(own) - start(own);

    // Keep the dragged swatch within the palette.
    const raw = vertical ? e.clientY - drag.y : e.clientX - drag.x;
    const delta = C.clamp(raw, start(rects[0]) - start(own), end(rects[rects.length - 1]) - end(own));
    // Swatches are equal-sized, so the swap happens once the dragged swatch covers half its neighbour.
    drag.target = C.clamp(index + Math.round(delta / size), 0, rects.length - 1);

    const axis = vertical ? 'translateY' : 'translateX';
    swatches.forEach((s, j) => {
      let shift = 0;
      if (j === index) shift = delta;
      else if (index < drag.target && j > index && j <= drag.target) shift = -size;
      else if (drag.target < index && j >= drag.target && j < index) shift = size;
      s.style.transform = shift ? `${axis}(${shift}px)` : '';
    });
  }

  function endDrag(commitMove) {
    pendingDrag = null;
    if (!drag) return;
    const { index, target, swatches } = drag;
    drag = null;
    // Snap into the final layout instantly: swatch elements stay put and are recolored.
    els.palette.classList.add('no-anim');
    els.palette.classList.remove('is-dragging');
    swatches.forEach((s) => {
      s.style.transform = '';
      s.classList.remove('is-dragged');
    });
    if (commitMove) moveColor(index, target);
    void els.palette.offsetWidth; // flush styles before re-enabling transitions
    els.palette.classList.remove('no-anim');
  }

  window.addEventListener('pointermove', (e) => {
    if (pendingDrag && e.pointerId === pendingDrag.pointerId) {
      if (Math.hypot(e.clientX - pendingDrag.x, e.clientY - pendingDrag.y) < DRAG_THRESHOLD) return;
      startDrag();
    }
    if (drag && e.pointerId === drag.pointerId) moveDrag(e);
  });

  window.addEventListener('pointerup', (e) => {
    if ((drag && e.pointerId === drag.pointerId) || (pendingDrag && e.pointerId === pendingDrag.pointerId)) endDrag(true);
  });
  window.addEventListener('pointercancel', () => endDrag(false));
  window.addEventListener('blur', () => endDrag(false));


  els.generate.addEventListener('click', regenerate);

  els.sizeMinus.addEventListener('click', () => resizePalette(state.colors.length - 1));
  els.sizePlus.addEventListener('click', () => resizePalette(state.colors.length + 1));
  els.sizeInput.addEventListener('change', () => {
    const v = parseInt(els.sizeInput.value, 10);
    if (!Number.isNaN(v)) resizePalette(v);
    els.sizeInput.value = state.colors.length;
  });
  els.sizeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.sizeInput.blur();
    if (e.key === 'Escape') {
      els.sizeInput.value = state.colors.length;
      els.sizeInput.blur();
    }
  });
  els.sizeInput.addEventListener('focus', () => els.sizeInput.select());
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);

  els.harmony.addEventListener('change', () => {
    els.harmony.blur(); // hand focus back so Space generates instead of reopening the dropdown
    state.harmony = els.harmony.value;
    if (state.harmony !== 'auto') state.used = state.harmony;
    regenerate();
    commit(); // reflect the new selection even if every color is locked
  });

  els.wheel.addEventListener('change', () => {
    els.wheel.blur();
    state.wheel = els.wheel.value;
    renderWheelDisc();
    regenerate();
    commit();
  });

  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => exportPalette(btn.dataset.export));
  });

  // --- Theory modal ----------------------------------------------------------

  els.theoryBtn.addEventListener('click', () => els.theoryDialog.showModal());
  els.theoryClose.addEventListener('click', () => els.theoryDialog.close());
  // Clicking the backdrop (the dialog element itself, outside .modal-body) closes it.
  els.theoryDialog.addEventListener('click', (e) => {
    if (e.target === els.theoryDialog) els.theoryDialog.close();
  });

  // --- Keyboard shortcuts ----------------------------------------------------

  /** Text fields keep Space for typing; everything else (buttons, selects, body) generates. */
  function isTyping(el) {
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && el.type !== 'color' && el.type !== 'checkbox' && el.type !== 'radio';
  }

  const isSpace = (e) => e.code === 'Space' || e.key === ' ';

  document.addEventListener('keydown', (e) => {
    const typing = isTyping(e.target);
    if (isSpace(e) && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // preventDefault stops a focused button from clicking and a focused select from opening.
      e.preventDefault();
      if (!e.repeat) regenerate();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      redo();
    }
  });

  // Buttons activate on Space *keyup*, so swallow that too or a focused button would also click.
  document.addEventListener('keyup', (e) => {
    if (isSpace(e) && !isTyping(e.target)) e.preventDefault();
  });

  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === encodeHash()) return;
    closeEditor();
    pushHistory();
    if (loadHash()) {
      renderWheelDisc();
      render();
    }
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  if (!loadHash()) {
    const res = H.generate(Array.from({ length: DEFAULT_COUNT }, () => ({ hex: null, fixed: false })), {
      harmony: state.harmony,
      wheel: state.wheel,
    });
    state.colors = res.hexes.map((hex) => ({ hex, locked: false }));
    state.used = res.harmony;
  }
  renderWheelDisc();
  commit();
})();
