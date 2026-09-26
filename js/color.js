/*
 * Color math: sRGB <-> OKLab / OKLCH conversions, gamut mapping and WCAG contrast.
 * OKLab by Björn Ottosson: https://bottosson.github.io/posts/oklab/
 */
(function (global) {
  'use strict';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const normHue = (h) => ((h % 360) + 360) % 360;

  /** Returns a normalized "#rrggbb" string, or null if the input is not a valid hex color. */
  function parseHex(input) {
    if (typeof input !== 'string') return null;
    let s = input.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('');
    return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
  }

  /** "#rrggbb" -> [r, g, b] in 0..1 */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** [r, g, b] in 0..1 -> "#rrggbb" */
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    c = clamp(c, 0, 1);
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  function linearToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToLinear([L, a, b]) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  function oklabToOklch([L, a, b]) {
    return { l: L, c: Math.hypot(a, b), h: normHue((Math.atan2(b, a) * 180) / Math.PI) };
  }

  function oklchToOklab(l, c, h) {
    const r = (h * Math.PI) / 180;
    return [l, c * Math.cos(r), c * Math.sin(r)];
  }

  /** [r, g, b] (gamma-encoded, 0..1) -> { l, c, h } */
  function rgbToOklch(rgb) {
    return oklabToOklch(linearToOklab(rgb.map(srgbToLinear)));
  }

  function hexToOklch(hex) {
    return rgbToOklch(hexToRgb(hex));
  }

  function inGamut(lin) {
    const e = 1e-5;
    return lin.every((v) => v >= -e && v <= 1 + e);
  }

  /** Largest OKLCH chroma that stays inside sRGB for the given lightness and hue. */
  function maxChroma(l, h) {
    if (l <= 0 || l >= 1) return 0;
    let lo = 0;
    let hi = 0.4;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(oklchToOklab(l, mid, h)))) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** OKLCH -> "#rrggbb", reducing chroma (keeping lightness and hue) if out of sRGB gamut. */
  function oklchToHex(l, c, h) {
    l = clamp(l, 0, 1);
    const cc = Math.min(Math.max(c, 0), maxChroma(l, h));
    return rgbToHex(oklabToLinear(oklchToOklab(l, cc, h)).map(linearToSrgb));
  }

  function hsvToRgb(h, s, v) {
    h = normHue(h) / 60;
    const c = v * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = v - c;
    const table = [
      [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ];
    const [r, g, b] = table[Math.floor(h) % 6];
    return [r + m, g + m, b + m];
  }

  /** [r, g, b] in 0..1 -> [h 0..360, s 0..1, l 0..1] */
  function rgbToHsl([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [normHue(h * 60), s, l];
  }

  /** h 0..360, s and l 0..1 -> [r, g, b] in 0..1 */
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    return hsvToRgb(h, 1, 1).map((v) => v * c + (l - c / 2));
  }

  /** WCAG 2 relative luminance. */
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(hexA, hexB) {
    const a = luminance(hexA);
    const b = luminance(hexB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  /** Pick white or near-black text, whichever contrasts more with the background. */
  function inkFor(hex) {
    return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#111111') ? '#ffffff' : '#111111';
  }

  global.ColorMath = {
    clamp,
    normHue,
    parseHex,
    hexToRgb,
    rgbToHex,
    rgbToOklch,
    hexToOklch,
    oklchToHex,
    maxChroma,
    hsvToRgb,
    rgbToHsl,
    hslToRgb,
    contrastRatio,
    inkFor,
  };
})(window);
