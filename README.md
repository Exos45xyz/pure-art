# Pure Smoke

Particle smoke in a glass cube. Free, open source and made with three.js.

![Pure Smoke: white particle smoke inside a wireframe glass cube](public/og.png)

**Play with it:** https://pure-smoke.vercel.app

Drag to turn the cube, hover to stir the smoke, scroll to zoom. Change the look with the panel on the side, then save a 4K image or record an 8-second video for your post.

## Controls

| Group | Control | What it does |
| --- | --- | --- |
| Look | original, smoke, storm, silk, plume, core | Starting points. **Randomize** picks a random look that still reads well; **reset** goes back to the original. |
| Smoke | source | Where the smoke is born: wandering clouds, a plume at the bottom, or a core in the middle. |
| | flow | How fast the current moves. |
| | turbulence | How many small eddies ride on the big swirls. Calm smoke also turns in bigger rolls. |
| | spread | How much each grain wanders on its own, which puffs thin sheets out into soft volumes. |
| | gather | Pulls the smoke into bodies that chase two centres racing around the cube, so it moves as whole masses. |
| | pulse | The breath: every 1.994 s the masses swell until they fill the cube, then pull back in. |
| | escape | How much smoke finds its way out through the glass. |
| Light | brightness, shadows, glow, film grain | Exposure, how much the smoke shades itself, the soft glow around it, and grain. |
| Particles | count | 65k, 262k, 1M, 2M or 4M grains. Computers start at 1M and step down to 262k if they can't keep 45 fps. |
| | size | How big each grain is. |
| | blur, focus | Depth of field: away from the focus plane grains open into soft discs with the same total light. Focus 0.5 is the middle of the cube. |
| Form | spin, lens, edges | How fast the cube turns, a flat (orthographic) or depth lens, and the edge colour. |
| Output | format | screen, 9:16, 4:5 or 1:1. A frame on screen shows what the file will hold. Images are 4K on the long side, videos 1080 wide. |

Double-click a slider to reset it. Hold Shift while dragging for fine steps. Every change goes into the address bar, so **copy link** shares the exact look.

Keys: `Space` pause · `R` randomize · `S` save image · `H` hide the panel.

Measured on an Apple M5 at 2560 × 1600: 1M grains take about 8 ms a frame, 2M about 23 ms, 4M about 36 ms (50 ms with blur). Recording films in real time, so 4M videos come out at the frame rate your machine reaches.

## The original look

The default look takes its camera and its movement from a reference clip (734 frames, 720 × 1280) of particle smoke in a turning wireframe cube, and keeps the studio's own particle texture.

- **Camera, exact.** Measured on every frame: an orthographic view looking 16.85° down, turning at 62.66° a second, with the cube's half-edge at 203 px on a 1280 px frame. When the look starts, its edges land on the clip's edges frame for frame.
- **Movement, measured frame by frame.** Every one of the clip's 734 frames was analysed at full resolution with optical flow, with the camera's own motion taken out. Each frame's vertical motion splits into a swell (spreading apart or squeezing together), a drift, a swirl in the picture's plane, and turbulence. Folded over its 12 beats (one every 1.994 s), the breath goes: a burst right after the smallest point, easing out into the glass; a float at the fullest, when the smoke is calmest; then a collapse that gets faster and twists, sinking as it swells and rising as it collapses, and a bounce straight back. The pulse plays those measured curves on the clip's clock, and gather holds the mass together only while it collapses. Measured inside the simulation, its swell follows the clip's through the beat at a correlation of +0.88; on the picture, the cube fills and empties on the clip's beats.
- **Always inside.** With escape at zero the glass is sealed: no grain ever leaves the cube.
- **Texture, the studio's own.** Fine grains, a soft glow and film grain, not the clip's.

Use **9:16** to export in the clip's own frame.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5321. `npm run build` writes a static site to `dist/` that any host can serve.

## How it works

Every grain is one texel in two float textures (position and age, velocity and seed), updated on the GPU each frame with `GPUComputationRenderer`.

- **Flow:** curl noise built from the cross product of two simplex-noise gradients, in three octaves. It has no divergence, so the smoke folds and stretches without bunching up.
- **The glass:** the noise is multiplied by a ramp that reaches zero at the cube's faces (Bridson et al., *Curl-Noise for Procedural Fluid Flow*, 2007). Near a wall the flow can only run along it. Slow-moving holes in that ramp let some smoke escape.
- **Light:** the grains are also splatted into 16 horizontal density slices, summed from the top down. Each grain reads how much smoke sits above it and dims to match, so the smoke shades itself.
- **Image:** grains are drawn as soft dots into a float buffer (full floats where the GPU can blend them, so millions of faint grains add up without banding). Below 1.6 px they keep their size and lose brightness instead, so nothing shimmers. Bloom, a film-like highlight roll-off, grain and dithering finish the image.
- **Edges:** the cube is drawn with `LineSegments2` after the grade, so its lines stay crisp. Edges at the back are drawn fainter.

All of it is in `src/`. Start with `settings.js` for the controls and looks, and `simulation.js` for the flow.

## Credits

- [three.js](https://threejs.org) (MIT)
- Simplex noise with gradients from [webgl-noise](https://github.com/stegu/webgl-noise) by Ian McEwan and Stefan Gustavson (MIT)
- Hash without Sine by Dave Hoskins (MIT)
- [Archivo](https://fonts.google.com/specimen/Archivo) and [Inter](https://rsms.me/inter/) (SIL Open Font License)

## License

MIT. Use it, change it, ship it.

---

Made by [Pure Studio](https://purestudio.art), a design studio for tech startups that need a brand and a landing page in a week.
