/*
 * Color harmony engine.
 *
 * Hue relationships (complementary, triadic, ...) are measured on a color wheel —
 * either the traditional artist's RYB wheel or the perceptual OKLCH hue circle.
 * Lightness and chroma are always chosen in OKLCH so the palette stays
 * perceptually balanced, and every color is gamut-mapped into sRGB.
 *
 * Locked colors act as anchors: the harmony is rotated so its ideal hue
 * positions line up with the locked hues, then the free slots are filled with
 * the remaining positions.
 */
(function (global) {
  'use strict';

  const C = global.ColorMath;
  const { clamp, normHue } = C;

  /** Colors below this OKLCH chroma are treated as neutrals: their hue is meaningless. */
  const CHROMA_MIN = 0.035;

  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const circDist = (a, b) => {
    const d = Math.abs(normHue(a - b));
    return Math.min(d, 360 - d);
  };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------------------------------------------------------------------------
  // Harmonies: each defines the ideal hue offsets (degrees on the wheel) from a base hue.
  // ---------------------------------------------------------------------------

  const HARMONIES = {
    analogous: {
      name: 'Analogous',
      weight: 2,
      desc: 'Hues that sit side by side on the wheel. Low hue contrast makes them calm and cohesive — let one hue dominate and the neighbours support it.',
      offsets(n) {
        const k = clamp(n, 2, 5);
        const step = k <= 3 ? 30 : 25;
        return Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * step);
      },
    },
    complementary: {
      name: 'Complementary',
      weight: 1.5,
      desc: 'Two hues directly opposite each other (180°). Maximum hue contrast: vivid and energetic, best when one hue leads and the other accents.',
      offsets: () => [0, 180],
    },
    split: {
      name: 'Split-complementary',
      weight: 1.5,
      desc: 'A base hue plus the two hues flanking its complement (150° and 210°). Strong contrast with less tension than a straight complement.',
      offsets: () => [0, 150, 210],
    },
    triadic: {
      name: 'Triadic',
      weight: 1.5,
      desc: 'Three hues evenly spaced 120° apart. Balanced and lively; works best when one hue leads and the others are softened.',
      offsets: () => [0, 120, 240],
    },
    tetradic: {
      name: 'Tetradic',
      weight: 1,
      desc: 'Two complementary pairs forming a rectangle on the wheel (0°, 60°, 180°, 240°). Rich and varied — keep one hue in charge.',
      offsets: () => [0, 60, 180, 240],
    },
    square: {
      name: 'Square',
      weight: 1,
      desc: 'Four hues evenly spaced 90° apart. The most varied scheme; balance it through differences in lightness and chroma.',
      offsets: () => [0, 90, 180, 270],
    },
    monochromatic: {
      name: 'Monochromatic',
      weight: 0.8,
      desc: 'A single hue explored through lightness and chroma. Harmony comes from the shared hue, contrast from value.',
      offsets: () => [0],
    },
  };

  const HARMONY_ORDER = ['analogous', 'complementary', 'split', 'triadic', 'tetradic', 'square', 'monochromatic'];

  // ---------------------------------------------------------------------------
  // Wheels: map between OKLCH hue and a wheel angle.
  // ---------------------------------------------------------------------------

  // Artist's RYB wheel angle -> HSV hue. Red 0°, orange 60°, yellow 120°, green 180°, blue 240°, purple 300°.
  const RYB_POINTS = [[0, 0], [60, 30], [120, 60], [180, 120], [240, 240], [300, 280], [360, 360]];
  const RYB_STEPS = 720;

  function rybToHsvHue(a) {
    a = normHue(a);
    for (let i = 0; i < RYB_POINTS.length - 1; i++) {
      const [a0, h0] = RYB_POINTS[i];
      const [a1, h1] = RYB_POINTS[i + 1];
      if (a <= a1) return h0 + ((h1 - h0) * (a - a0)) / (a1 - a0);
    }
    return 0;
  }

  // Lookup table: RYB angle (index) -> unwrapped, monotonically increasing OKLCH hue.
  const rybTable = (() => {
    const table = [];
    let offset = 0;
    for (let i = 0; i <= RYB_STEPS; i++) {
      let h = C.rgbToOklch(C.hsvToRgb(rybToHsvHue((i * 360) / RYB_STEPS), 1, 1)).h + offset;
      if (i > 0 && h < table[i - 1] - 180) {
        offset += 360;
        h += 360;
      }
      table.push(h);
    }
    // OKLCH hue plateaus (and dips slightly) around pure blue; flatten the dip, then
    // spread flat runs linearly so the table is strictly increasing and invertible.
    for (let i = 1; i < table.length; i++) table[i] = Math.max(table[i], table[i - 1]);
    for (let i = 1; i < table.length; ) {
      if (table[i] !== table[i - 1]) {
        i++;
        continue;
      }
      const start = i - 1;
      let end = i;
      while (end < table.length && table[end] === table[start]) end++;
      if (start > 0 && end < table.length) {
        const a = table[start - 1];
        const b = table[end];
        for (let k = start; k < end; k++) table[k] = a + ((b - a) * (k - start + 1)) / (end - start + 1);
      }
      i = end;
    }
    return table;
  })();

  function rybFromWheel(angle) {
    const x = (normHue(angle) / 360) * RYB_STEPS;
    const i = Math.min(RYB_STEPS - 1, Math.floor(x));
    return normHue(lerp(rybTable[i], rybTable[i + 1], x - i));
  }

  function rybToWheel(hue) {
    const base = rybTable[0];
    const h = normHue(hue - base) + base;
    let lo = 0;
    let hi = RYB_STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rybTable[mid] <= h) lo = mid;
      else hi = mid;
    }
    const span = rybTable[hi] - rybTable[lo];
    const t = span > 0 ? (h - rybTable[lo]) / span : 0;
    return normHue(((lo + t) * 360) / RYB_STEPS);
  }

  const WHEELS = {
    ryb: {
      name: 'Artist (RYB)',
      note: 'Artist’s RYB wheel: the red–yellow–blue wheel taught in painting and design. Its opposites are red↔green, yellow↔purple and blue↔orange.',
      toWheel: rybToWheel,
      fromWheel: rybFromWheel,
    },
    oklch: {
      name: 'Perceptual (OKLCH)',
      note: 'Perceptual OKLCH wheel: hues spaced by how different they look to the eye, so equal angles look like equal steps. Its opposites are red↔teal, yellow↔violet and blue↔gold.',
      toWheel: normHue,
      fromWheel: normHue,
    },
  };

  // ---------------------------------------------------------------------------
  // Fitting a harmony to existing (locked) hues.
  // ---------------------------------------------------------------------------

  /**
   * Find the base angle that best aligns the harmony's offsets with the given wheel angles
   * (least squares, each angle snapping to its nearest offset).
   * With `randomize`, picks randomly among equally good rotations for variety.
   */
  function fitBase(angles, offsets, randomize) {
    if (!angles.length) return { a0: Math.random() * 360, rms: 0 };
    const STEP = 0.5;
    const costs = [];
    let min = Infinity;
    for (let a0 = 0; a0 < 360; a0 += STEP) {
      let cost = 0;
      for (const ang of angles) {
        let best = Infinity;
        for (const off of offsets) best = Math.min(best, circDist(ang, a0 + off));
        cost += best * best;
      }
      costs.push(cost);
      if (cost < min) min = cost;
    }
    let idx;
    if (randomize) {
      const tol = min + 0.3 * angles.length + 1e-9;
      const good = [];
      costs.forEach((c, i) => c <= tol && good.push(i));
      idx = good[Math.floor(Math.random() * good.length)];
    } else {
      idx = costs.indexOf(min);
    }
    return { a0: idx * STEP, rms: Math.sqrt(costs[idx] / angles.length) };
  }

  function weightedPick(ids) {
    const total = ids.reduce((s, id) => s + HARMONIES[id].weight, 0);
    let r = Math.random() * total;
    for (const id of ids) {
      r -= HARMONIES[id].weight;
      if (r <= 0) return id;
    }
    return ids[ids.length - 1];
  }

  /** For "Auto": choose a harmony at random, restricted to those that fit the locked hues well. */
  function pickHarmony(angles, n) {
    if (angles.length < 2) return weightedPick(HARMONY_ORDER);
    const scored = HARMONY_ORDER.map((id) => ({ id, rms: fitBase(angles, HARMONIES[id].offsets(n), false).rms }));
    const best = Math.min(...scored.map((s) => s.rms));
    return weightedPick(scored.filter((s) => s.rms <= Math.max(best + 4, 6)).map((s) => s.id));
  }

  // ---------------------------------------------------------------------------
  // Candidate generation.
  // ---------------------------------------------------------------------------

  const cuspCache = new Map();

  /** Lightness at which a hue reaches its maximum sRGB chroma (e.g. yellows peak light, blues peak dark). */
  function cuspLightness(h) {
    const key = Math.round(normHue(h));
    if (cuspCache.has(key)) return cuspCache.get(key);
    let bestL = 0.6;
    let bestC = -1;
    for (let L = 0.3; L <= 0.95; L += 0.025) {
      const c = C.maxChroma(L, key);
      if (c > bestC) {
        bestC = c;
        bestL = L;
      }
    }
    cuspCache.set(key, bestL);
    return bestL;
  }

  /** Overall lightness/chroma "mood" for the palette, inherited from locked colors when present. */
  function pickStyle(fixed) {
    const chromatic = fixed.filter((f) => f.chromatic);
    let c;
    if (chromatic.length) {
      c = clamp(avg(chromatic.map((f) => f.lch.c)) * rand(0.9, 1.1), 0.04, 0.24);
    } else {
      const r = Math.random();
      c = r < 0.15 ? rand(0.035, 0.07) : r < 0.85 ? rand(0.08, 0.16) : rand(0.16, 0.22);
    }
    let l = rand(0.55, 0.72);
    if (fixed.length) l = lerp(l, avg(fixed.map((f) => f.lch.l)), 0.5);
    return { l, c };
  }

  function makeCandidate(L, c, angle, wheel, idx, tier) {
    const h = wheel.fromWheel(angle);
    return { hex: C.oklchToHex(L, c, h), l: L, angle: normHue(angle), idx, tier };
  }

  function buildCandidates(n, offsets, a0, style, harmonyId, wheel) {
    const list = [];

    if (harmonyId === 'monochromatic') {
      const lo = clamp(style.l - 0.08 * n, 0.22, 0.6);
      const hi = clamp(style.l + 0.08 * n, 0.7, 0.95);
      for (let j = 0; j < n; j++) {
        const t = n === 1 ? 0.5 : j / (n - 1);
        const L = clamp(lerp(lo, hi, t) + rand(-0.02, 0.02), 0.15, 0.97);
        const c = style.c * (1 - Math.abs(t - 0.5)) * rand(0.9, 1.15);
        list.push(makeCandidate(L, c, a0 + rand(-3, 3), wheel, 0, j));
      }
      return list;
    }

    const k = offsets.length;
    // Spread the base lightness of each hue so the palette has value contrast,
    // then pull each toward the lightness where that hue is most vivid.
    const spread = k >= 3 ? 0.24 : 0.14;
    const levels = shuffle(offsets.map((_, i) => (k === 1 ? style.l : style.l - spread / 2 + (spread * i) / (k - 1))));
    const baseL = offsets.map((off, i) => clamp(lerp(levels[i], cuspLightness(wheel.fromWheel(a0 + off)), 0.35), 0.3, 0.9));

    for (let j = 0; j < n; j++) {
      const idx = j % k;
      const tier = Math.floor(j / k);
      let L = baseL[idx];
      let c = style.c * rand(0.8, 1.1);
      let angle = a0 + offsets[idx];
      if (tier > 0) {
        // Extra colors on the same hue become tints/shades: first toward the side with more room.
        const firstDir = L > 0.58 ? -1 : 1;
        const dir = tier % 2 === 1 ? firstDir : -firstDir;
        const mag = 0.22 + 0.08 * Math.floor((tier - 1) / 2);
        L += dir * mag;
        if (L < 0.18 || L > 0.96) L = baseL[idx] - dir * mag;
        L = clamp(L, 0.18, 0.96);
        c *= 0.85;
        angle += rand(-6, 6);
      }
      list.push(makeCandidate(L, c, angle, wheel, idx, tier));
    }
    // Group tints/shades next to their parent hue.
    return list.sort((a, b) => a.idx - b.idx || a.tier - b.tier);
  }

  function describeColor(hex, wheel) {
    const lch = C.hexToOklch(hex);
    return { hex, lch, angle: wheel.toWheel(lch.h), chromatic: lch.c >= CHROMA_MIN };
  }

  /**
   * Generate a palette.
   * @param {Array<{hex: string|null, fixed: boolean}>} slots  fixed slots keep their color
   * @param {{harmony: string, wheel: string}} opts  harmony may be 'auto'
   * @returns {{hexes: string[], harmony: string}}
   */
  function generate(slots, opts) {
    const wheel = WHEELS[opts.wheel] || WHEELS.ryb;
    const n = slots.length;

    const fixed = [];
    slots.forEach((s, i) => {
      if (s.fixed && s.hex) fixed.push({ i, ...describeColor(s.hex, wheel) });
    });
    const angles = fixed.filter((f) => f.chromatic).map((f) => f.angle);

    const harmonyId = HARMONIES[opts.harmony] ? opts.harmony : pickHarmony(angles, n);
    const offsets = HARMONIES[harmonyId].offsets(n);
    const { a0 } = fitBase(angles, offsets, true);
    const pool = buildCandidates(n, offsets, a0, pickStyle(fixed), harmonyId, wheel);

    // Each locked color claims the candidate nearest to it; the rest fill the free slots in order.
    for (const f of fixed) {
      let bestIdx = 0;
      let bestD = Infinity;
      pool.forEach((cand, idx) => {
        const dl = Math.abs(cand.l - f.lch.l);
        const d = f.chromatic ? (2 * circDist(cand.angle, f.angle)) / 180 + dl : dl;
        if (d < bestD) {
          bestD = d;
          bestIdx = idx;
        }
      });
      pool.splice(bestIdx, 1);
    }

    let p = 0;
    const hexes = slots.map((s) => (s.fixed && s.hex ? s.hex : pool[p++].hex));
    return { hexes, harmony: harmonyId };
  }

  /** Describe how well a palette matches a harmony: per-color wheel positions and the best-fit geometry. */
  function analyze(hexes, harmonyId, wheelId) {
    const wheel = WHEELS[wheelId] || WHEELS.ryb;
    const points = hexes.map((hex) => describeColor(hex, wheel));
    const angles = points.filter((p) => p.chromatic).map((p) => p.angle);
    const n = hexes.length;
    const offsets = HARMONIES[harmonyId].offsets(n);
    const fit = angles.length ? fitBase(angles, offsets, false) : null;

    let closest = null;
    if (angles.length >= 2) {
      for (const id of HARMONY_ORDER) {
        const f = fitBase(angles, HARMONIES[id].offsets(n), false);
        if (!closest || f.rms < closest.rms - 1e-6) closest = { id, rms: f.rms };
      }
    }
    return { points, offsets, fit, closest, chromaticCount: angles.length };
  }

  global.Harmony = {
    HARMONIES,
    HARMONY_ORDER,
    WHEELS,
    generate,
    analyze,
  };
})(window);
