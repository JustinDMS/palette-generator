# Palette Harmony

A color palette generator that runs entirely in the browser. It uses color theory: every palette follows a named hue harmony, and lightness and chroma are balanced in the perceptual OKLCH color space.

It's a plain static site with no build step and no dependencies, so it can be hosted on GitHub Pages as-is.

## Features

- **Harmonies:** analogous, complementary, split-complementary, triadic, tetradic, square and monochromatic. **Auto** picks one at random, but only from the harmonies that fit your locked colors.
- **Two color wheels** (chosen in the color theory panel). The wheel decides which hues count as "opposite" or "evenly spaced". Lightness and chroma are handled the same way with either wheel.
  - **Artist (RYB)** is the red–yellow–blue wheel taught in painting and design. Its opposites are red↔green, yellow↔purple and blue↔orange. Pick this when you want the classic color-theory relationships.
  - **Perceptual (OKLCH)** spaces hues by how different they actually look, so a 120° step always looks like the same amount of change. Its opposites are red↔teal, yellow↔violet and blue↔gold. Pick this for evenly balanced palettes, like chart or UI colors.
- **Lock colors:** locked colors never change. When you generate, the harmony is rotated to fit the locked hues, and only the unlocked slots are filled.
- **Specify colors:** click a hex code to open the color editor. It has a hex field (`2A9D8F`, `#f4a`, …) and sliders with number fields in either **RGB** or **HSL** mode. The editor remembers your last mode. A color you edit locks automatically, and one undo reverts a whole editing session.
- **Lighten / darken** (☀ / ☾ on each swatch): steps to the nearest color with the same hue and chroma, 0.05 lighter or darker in OKLCH lightness. Chroma is reduced only where the color would otherwise leave the sRGB gamut, near white or black. Repeated steps remember the starting hue and chroma, so going to white and back returns the exact original color. Like other edits, this locks the color.
- **Palette size** (2–10 colors). Use the **[ − ] [ n ] [ + ]** stepper in the top bar, or type a number. New colors are added at the end. Shrinking removes unlocked colors from the end first, and removes locked colors only when nothing else is left. The **+** buttons between swatches and at both ends of the palette insert a color at that spot. The × on a swatch removes that specific color. New colors always fit the current harmony.
- **Reorder colors:** with a mouse, drag a swatch from anywhere that isn't a button. On touch screens, drag by the grip (⋮⋮); the grip is hidden on desktop. With the keyboard, press Alt + arrow keys while any control on a swatch is focused.
- **Color theory details:** the mini color wheel in the top bar, next to the Harmony field, is a live preview of the palette. Click it to open a panel with:
  - a full wheel showing the ideal harmony shape and where each color sits (angle = hue, distance from center = chroma)
  - how closely the palette fits the harmony
  - the color wheel choice (Artist or Perceptual)
  - the best text-contrast pairing (WCAG)
  - export buttons
- **Export:** HEX list, CSS custom properties, JSON, or a share link (the whole palette, including locks, is stored in the URL hash).
- **Undo/redo** and keyboard shortcuts: `Space` generates, `Ctrl/⌘+Z` undoes, `Ctrl/⌘+Shift+Z` or `Ctrl+Y` redoes.

## How generation works

1. Each harmony is a set of ideal hue offsets on the chosen wheel (for example, triadic = 0°, 120°, 240°).
2. Locked colors with a clear hue are anchors. The harmony is rotated to the angle that best fits them (least squares). Near-neutral colors are ignored here, because their hue is meaningless.
3. Each harmony hue gets a base lightness. Base lightnesses are spread apart for value contrast, and each one is pulled toward the lightness where that hue is most vivid (yellows light, blues deeper). If a palette has more colors than the harmony has hues, the extras become tints and shades of those hues.
4. Chroma comes from a random "mood" (muted, balanced or vivid), or from the average chroma of your locked colors, so a muted palette stays muted.
5. Every color is gamut-mapped into sRGB by reducing chroma while keeping lightness and hue.

## Files

```
index.html       page markup
css/styles.css   styles (light and dark mode, responsive)
js/color.js      sRGB ↔ OKLab/OKLCH conversion, gamut mapping, WCAG contrast
js/harmony.js    harmonies, RYB/OKLCH wheels, palette generation and analysis
js/app.js        UI, state, undo/redo, URL sharing, export
.nojekyll        tells GitHub Pages to serve files as-is
```

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python -m http.server 8000
```

## Deploy to GitHub Pages

1. Create a repository and push these files to the root of the `main` branch.
2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. The site will be published at `https://<username>.github.io/<repository>/`.
