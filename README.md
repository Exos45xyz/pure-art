# Pure Smoke

Particle smoke in a glass cube. Free, open source and made with three.js.

![Pure Smoke: white particle smoke inside a wireframe glass cube](public/og.png)

**Play with it:** https://pure-smoke.vercel.app

Drag to turn the cube, hover to stir the smoke, scroll to zoom. Change the look with the panel on the side, then save a 4K image or record an 8-second video for your post.

## Controls

| Group | Control | What it does |
| --- | --- | --- |
| Look | smoke, storm, silk, plume, core | Starting points. **Shuffle** picks a random look that still reads well. |
| Smoke | source | Where the smoke is born: wandering clouds, a plume at the bottom, or a core in the middle. |
| | flow | How fast the current moves. |
| | turbulence | How many small eddies ride on the big swirls. |
| | escape | How much smoke finds its way out through the glass. |
| Light | brightness, shadows, glow, film grain | Exposure, how much the smoke shades itself, the soft glow around it, and grain. |
| Form | grain size, spin, edges, particles | Grain size, how fast the cube turns, the edge colour, and 65k / 262k / 1M particles. |

Double-click a slider to reset it. Hold Shift while dragging for fine steps. Every change goes into the address bar, so **copy link** shares the exact look.

Keys: `Space` pause · `R` shuffle · `S` save image · `H` hide the panel.

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
- **Image:** grains are drawn as soft dots into a half-float buffer. Below 1.6 px they keep their size and lose brightness instead, so nothing shimmers. Bloom, a film-like highlight roll-off, grain and dithering finish the image.
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
