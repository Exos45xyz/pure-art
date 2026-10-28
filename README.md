# Pure Smoke

Particle smoke in a glass cube. Free and open source under the [MIT licence](LICENSE), made with three.js.

![Pure Smoke: blue and white particle smoke inside a wireframe glass cube, under the Pure Art logo](public/og.png)

**Play with it:** https://pure-art-smoke.vercel.app

Most smoke on the web is a video. This one is alive.
A million grains move through a real flow, inside real glass, under one studio lamp.
You can turn it, stir it, give it your colours, and take it home as a 4K image or a loop that never shows its seam.

Drag to turn the cube, hover to stir the smoke, scroll to zoom (the hints at the bottom light up while you do each one, the first few times; on a touch screen only the drag is listed).

## What's in it

- **Seven looks.** Each one a different shape of the same smoke. Randomize only rolls the ones that stay beautiful.
- **Your colours, as data.** A gradient you draw, a palette, or any picture: every pixel colours its share of the smoke.
- **Glass that acts like glass.** The smoke slides along the faces and springs back. The edges take the smoke's own light, or its colours.
- **Rebound.** The smoke as physics, thrown at the glass on every beat.
- **Take it with you.** A 4K image, or a seamless loop in MP4 for your post.
- **Keep your looks.** Save them as chips, download them as a file, share any look with the link.
- **On a phone too.** The panel becomes a sheet and the cube fits the room above it.

## Why it looks like this

Smoke is light. So the studio is black, and there is one lamp.
The colour belongs to the smoke. So the panel is grey on black, and nothing else on the page is coloured.
Most people want a look, a colour, and a way to share. So those come first; everything else waits under Fine-tune.
Motion should explain, not decorate. The panel folds into the corner it comes back from. The hints light up the first few times you do what they say, then step back.
The cube is the hero. On a phone it keeps to the room between the name and the sheet, so nothing covers it.

## Make it yours

Fork it, change it, ship it. Three places to start:

- **A look of your own.** Find it in the panel, press **copy code**, and paste the block into `presets` in `src/settings.js`. It becomes a chip.
- **The colour it opens in.** `DEFAULT_GRADIENT` in `src/settings.js`: a gradient's stops, as the editor writes them.
- **The flow itself.** `src/simulation.js`: the velocity shader that moves every grain.

## Controls

The panel shows the everyday choices first: a look, a colour, then save or share. The icon at its top right hides it (or H): it folds into its corner, the cube glides into the room it leaves, and **parameters** brings it back out of the same corner. Everything else sits under **Fine-tune**, in short groups by what it changes (**Motion**, **Rhythm**, **Glass**, **Light**, **Particles**, **Camera**), each control saying what it does when you hover it; it stays open or closed as you left it.

| Group | Control | What it does |
| --- | --- | --- |
| Look | pure, aura, original, ribbon, veil, rebound, smoke | Starting points. **Pure** is the default: the clip's breath through a depth lens, with fine filaments, sharp grains and sealed glass. **Aura** is pure's breath a little softer and brighter, a rounder glowing body that suits a colour. No look changes the colour: it stays whatever you chose. **Original** is the reference clip's camera and breath; **ribbon** (bright bands around a breathing body) and **veil** (slow sheets that fill the glass) are two other shapes for the same camera, each chosen by rendering it over 30 s. **Rebound** is the clip as physics, on its camera: the smoke keeps its momentum, the clip's breath throws it at the glass on every beat, and the glass sends it back at the speed it came, so it slams into the faces, presses flat and slides over them, then springs back into a compact mass with strands, beat after beat for as long as it runs (the rebound slider sets how hard it is thrown). Measured on the clip's camera and clock frame by frame, its share of the frame swells and falls with the clip's over each beat (about 20% to 55%, the clip 26% to 52%). **Smoke** is the plain studio look. Changes you make by hand are never lost by surprise: when a look, reset or randomize replaces them before you kept them, the toast offers **undo**. Each look has a small line icon of its shape. **save** appears when the look on screen is new (so it also tells you it isn't kept yet) and keeps it as your own chip (mine 1, mine 2…, up to six, kept in this browser; like the presets, it leaves the colour as it is); the one on screen carries a **download** arrow joined to it (that look alone, as a file **upload** takes back) and shows **×** beside it to remove it (the toast offers **undo** for a few seconds), and clicking it again (or double-clicking one of yours) lets you type its name. **Download** (the arrow into a tray by the Look title) keeps all of yours as a small file, and **upload** (the arrow out of it, or dropping that file on the page) brings them back, here or in another browser; uploading only adds, a look you already have is kept once, and six at most. To share a look, send the link in the address bar; **copy code** turns it into a preset for `src/settings.js`. **Randomize** rolls one of the smoke's three beautiful families (breathing **masses** like pure, slow crisp **silk** sheets, crisp **ribbons** around a breathing body) and varies it only inside the ranges where it stays beautiful. Those ranges were found by rendering rolls and scoring each frame: crisp strands rather than fog, shapes with air around them, the glass touched, no glare or gloom, coherent motion; 34 of 40 rolls pass that strict test (the rest are borderline), against 10 of 40 before. No roll adds spread, opens the glass or blurs the grains. **Reset** goes back to pure. |
| Colour | white, dusk, pearl, yours, image | Two colours ship with the app, both by Pure Studio: **dusk**, a grain gradient (orange, pink, lilac, pale mint), and **pearl**, pearl orbs on black (pearl white, lilac, violet grey, with a blue and blush sheen). **Yours** is a plain colour or a gradient of your own, and the app opens in it: at first the gradient it ships with, white that holds most of the way into the glacier blues, deep blue and charcoal of a picture of ice on dark rock (the plain colour starts as its glacier blue); once you make your own, it opens in yours. Its disc wears it and opens an editor beside it, like Paper's: two tabs choose **plain** or **gradient**, and each keeps its own, so switching never loses the other. As in Paper, the gradient's bar has a pin under it for each colour (two to eight) and a diamond above it for each blend: press the bar to add a colour there (in the colour already there, so nothing changes until you change it), drag a pin along, or drag it well off the bar to take it away; drag a diamond to move where its blend is half done (double-click puts it back in the middle); arrows move the chosen pin and Delete takes it away. **−** at the top puts the editor away (as do Escape and a click outside). The colour (or the chosen pin's) is set with the same square, hue bar, eyedropper and hex as the edges' colour. The smoke follows as you go, and each stretch of the bar colours its share of the smoke. Yours is kept in this browser; saved looks and copy code leave it out like any colour. Each colour is a flat disc of its picture's colours where the picture has them (dusk top to bottom, pearl along its light from the top left); the one worn has a ring and its name by the title. **image** (+) brings your own (or drop or paste one anywhere on the page), which joins as a disc of its own picture in its place (press that disc again while it's worn to choose another), and the smoke takes its colours like pigment in a fluid: every pixel becomes part of the smoke, each region of the cube wears one neighbourhood of the picture's colours, the flow folds the regions into strands, and a colour that covers 30% of the picture colours 30% of the smoke at every moment. Black (under 8% brightness) is left out: the smoke is light on a black studio, so the black around a picture is the studio itself. Under the orbs, the image's main shades show at their real shares. Switching between two colours turns every grain from its old colour to its new one. |
| Motion | speed | How fast the smoke's time runs, breath and all: 1.00× as it is, from 0.25× (slow motion) to 2×. The camera and the panel keep the clock. |
| | flow | How fast the current moves. |
| | turbulence | How many small eddies ride on the big swirls. Calm smoke also turns in bigger rolls. |
| | twist | Each layer of smoke turns about the cube's upright axis, faster the higher it is and the other way below the middle, so the strands wind into a helix. It fades out by the side glass, where the bounce takes over. Every look keeps it at 0, where nothing changes; randomize keeps yours. |
| | spread | How much each grain wanders on its own, which puffs thin sheets out into soft volumes. |
| | source | Not in the panel: where the smoke is born (wandering clouds, a plume at the bottom, or a core in the middle). With gather on, as in pure, the smoke is born at the gather centres and the source changes nothing you see; randomize sets it where it shows. Copy code includes it. |
| Rhythm | breath | The breath: every 1.994 s the masses swell until they fill the cube, then pull back in. |
| | beat | The time between breaths, and in the rebound look between rebounds: 2.0 s is the clip's, from 0.7 s to 6 s. The breath's pushes scale with it, so a slower beat goes as far with more time between. Loops still last whole beats. |
| | gather | Pulls the smoke into bodies that chase two centres racing around the cube, so it moves as whole masses. |
| Glass | rebound | How hard the smoke bounces off the glass. At 0 it settles against the faces; 50, every look's setting, springs back with 90% of its speed; 100 throws it back hard and far. |
| | escape | How much smoke finds its way out through the glass. Every look and randomize keep it at 0, so the smoke stays in the cube unless you open it yourself. |
| | edges | The cube's edges: white, **the smoke's colours** (the gradient the grains wear, running down the cube from its first colour at the top; its disc shows it, and appears once the smoke has colours), **your colour**, or off. Your colour opens a picker beside its disc, like Figma's: a square for saturation and brightness, a hue bar, an eyedropper (in browsers that have one) and the hex. A press puts the knob where it lands and a drag follows the hand; the cube follows live, the colour is remembered, and Escape, a click outside or the disc again closes it. The edges are lit by the same lamp as the smoke, and smoke in front of them hides them.  |
| Light | brightness, shadows, glow, film grain | Exposure, how dense the smoke is to the light (how deep its shadows fall, and how much thick smoke hides what is behind it), the soft glow around it, and grain. |
| Particles | count | 65k, 262k, 500k, 1M or 2M grains. Computers start at 1M and step down to 500k if they can't keep 45 fps. |
| | size | How big each grain is. |
| | blur, focus | Depth of field: away from the focus plane grains open into soft discs with the same total light. Focus 0.5 is the middle of the cube; it rests (dimmed) while blur is 0, where it would do nothing. Every look and randomize keep blur at 0, so the grains stay sharp. |
| Camera | spin, lens | How fast the cube turns, a flat (orthographic) or depth lens (a change of lens crossfades from the last frame). |
| Share | record, copy code | **Record** opens the record window in the panel's place. **Frame**: screen, 16:9, 9:16, 4:5 or 1:1; the canvas becomes that frame, fitted in the free space, so what you see is what is saved; **save image** saves it (4K on the long side). **Video**: 4, 8 or 16 s, a seamless **loop** or a single take (**once**), 30 or 60 fps, then **start recording** (1080 on the short side; see below). **Copy code** copies the current look as code, a preset ready to paste into `presets` in `src/settings.js`. The address bar always holds a link that opens with your settings. The S key saves the screen as you see it. |

Double-click a slider to reset it. Hold Shift while dragging for fine steps; arrow keys step by 1, Shift or Page Up/Down by 10. On a phone, a sideways drag sets a slider and a swipe up or down scrolls the panel; the panel is a sheet, so dragging its head down (or a flick) puts it away, and **parameters** brings it back. With reduced transparency the panels are solid, and with more contrast their words and edges stand out more. Every change goes into the address bar, so the link shares the exact look.

Keys: `Space` pause · `R` randomize · `S` save image · `H` hide the panel · `⌘Z` undo what the toast on screen offers (the letters work wherever focus is; Space presses a focused button instead). Opening a link opens the look it holds; reloading the page starts again from pure.

Measured on an Apple M5 at 2560 × 1600: 1M grains take about 8 ms a frame, 2M about 23 ms. The lamp's two opacity maps add about 3 ms a frame at 1M (measured in a 560 × 1238 window).

### The loop

**Record** renders the video frame by frame instead of filming the screen, so every computer gets every frame (about 12 s for an 8 s loop at 60 fps and 1M grains on an M5; 30 fps takes half). The smoke always steps at 60 a second, as it does live; 30 fps keeps every other step. While it renders, the record window shows its progress and a cancel (or Escape); the frame shows the frames as they are made. A loop lasts whole breaths (the length asked for rounded to 1.994 s breaths: 8 s → 7.98 s; exactly the length when the smoke doesn't breathe), and the camera turns by whole quarter turns, because the glass looks the same every quarter turn: the original look's 501° become 540°, and a slow spin like pure's holds still for the loop. The last second crossfades into the first: a second simulation, started from the first frame's grains, replays that second under the end, so the last frame leads straight into the first. A single take keeps the length and the spin as they are. Rendering needs a browser with a video encoder (WebCodecs: Chrome, Edge, Safari 16.4+, Firefox 130+); others film the length in real time instead, without the loop. The MP4 is written by [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT), loaded only when you record.

## The original look

The original look takes its camera and its breath from a reference clip (734 frames, 720 × 1280) of particle smoke in a turning wireframe cube, and its smoke and particles from pure.

- **Camera, exact.** Measured on every frame: an orthographic view looking 16.85° down, turning at 62.66° a second, with the cube's half-edge at 203 px on a 1280 px frame. When the look starts, its edges land on the clip's edges frame for frame.
- **Movement, measured frame by frame.** Every one of the clip's 734 frames was analysed at full resolution with optical flow, with the camera's own motion taken out. Each frame's vertical motion splits into a swell (spreading apart or squeezing together), a drift, a swirl in the picture's plane, and turbulence. Folded over its 12 beats (one every 1.994 s), the breath goes: a burst right after the smallest point, easing out into the glass; a float at the fullest, when the smoke is calmest; then a collapse that gets faster and twists, sinking as it swells and rising as it collapses, and a bounce straight back. The pulse plays those measured curves on the clip's clock, and gather holds the mass together only while it collapses. Measured inside the simulation, its swell follows the clip's through the beat at a correlation of +0.88; on the picture, the cube fills and empties on the clip's beats.
- **Always inside.** With escape at zero the glass is sealed: no grain ever leaves the cube.
- **Particles, pure's.** Fine strands of sharp grains, a soft glow and film grain, not the clip's. The smoke moves at pure's pace: at the clip's own speed the strands wash out into an even fog.

Use **9:16** to export in the clip's own frame.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:5321. `npm run build` writes a static site to `dist/` that any host can serve.

On the dev server, `?data=worst` puts hard test looks in place of yours: the longest name allowed, one letter, an emoji first, right to left, one long word, and markup that must show as text. `?data=empty`, `one` and `full` (six) are the other cases. With one of them in the address, a small switch at the bottom of the page flips between them; without, the dev server looks like the real page. None of it is in the build.

## How it works

Every grain is one texel in two float textures (position and age, velocity and seed), updated on the GPU each frame with `GPUComputationRenderer`.

- **Flow:** curl noise built from the cross product of two simplex-noise gradients, in three octaves. It has no divergence, so the smoke folds and stretches without bunching up.
- **The glass:** the noise is multiplied by a ramp that reaches zero at the cube's faces (Bridson et al., *Curl-Noise for Procedural Fluid Flow*, 2007). Near a wall the flow can only run along it. Smoke that reaches the glass bounces straight back (with 90% of its speed at the default rebound) and splashes sideways along it, then rolls back inward instead of lying flat on the faces. Rebound sets the bounce, the kick and how long it carries: measured right at the glass, smoke leaves at 0.18 units a second at 0, 0.85 at 50 and 1.67 at 100. On screen, nothing is drawn past the cube's outline: each grain keeps its shape, and only the part of a dot beyond the glass is trimmed. Slow-moving holes let some smoke escape when escape is turned up.
- **Light:** one studio lamp, a point light up and to the left of the camera and a little in front of the cube, like the reference clip's key light. It turns with the camera, as if the cube turned under it. The light is physical: it falls off with the square of the distance, smoke between a grain and the lamp shades it, and smoke between a grain and the camera hides it. Both come from opacity maps (Kim & Neumann, *Opacity Shadow Maps*, 2001): every frame the grains are splatted into 16 depth slices of 64 × 64 seen from the lamp, and again seen from the camera, and each slice is summed with every slice in front of it. A grain reads how much smoke lies towards the lamp and towards the camera. On the reference clip's camera, the smoke comes out brighter on its top and left, as in the clip.
- **Image:** grains are drawn as soft dots into a float buffer (full floats where the GPU can blend them, so millions of faint grains add up without banding). Below 1.6 px they keep their size and lose brightness instead, so nothing shimmers. Bloom, a film-like highlight roll-off, grain and dithering finish the image.
- **Colours from an image, as data:** like Refik Anadol's data paintings, the picture's pixels are laid out on a 512 × 512 colour map where near means alike: hue across (starting at the hue the image has least of, greys last), light up within each hue. Each grain carries a place on the map like pigment, in a third simulation texture: two large, slowly drifting fields (hue and light) give each region of the cube its own neighbourhood of the map, and a grain eases toward its region's colour over about three seconds, so the flow drags colours into strands and folds. Every step, a sample of the grains (1 in 16) is sorted into a histogram of those fields on the GPU and its running sum evens them out, so every part of the map, and so every pixel, colours exactly its share of the smoke at every moment, wherever the smoke happens to be. Colour regions are large on purpose: a line of sight crosses few of them, so colours stay saturated instead of averaging to grey through the smoke. The film roll-off follows each pixel's brightest channel, so dense coloured smoke keeps its colour instead of bleaching to white.
- **Edges:** a plain stroke, one width end to end, drawn as anti-aliased screen-space strips after the grade, with round joins at the corners. Each point of an edge reads the same opacity maps as the grains and takes the light a grain would take there, through the same exposure and film roll-off: brightest nearest the lamp, darker away from it and where smoke shades it, and hidden by smoke in front of it.

All of it is in `src/`. Start with `settings.js` for the controls and looks, and `simulation.js` for the flow.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it is short, and it says how to check that a change keeps the smoke as it is.

## Credits

- [three.js](https://threejs.org) (MIT)
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) by Vanilagy, for the loop's MP4 (MIT)
- Simplex noise with gradients from [webgl-noise](https://github.com/stegu/webgl-noise) by Ian McEwan and Stefan Gustavson (MIT)
- Hash without Sine by Dave Hoskins (MIT)
- [Archivo](https://fonts.google.com/specimen/Archivo) (SIL Open Font License)

## License

[MIT](LICENSE): use it, change it, ship it. That covers the code and the two bundled colours, dusk and pearl. The Pure Studio name and logo, and the Pure Art logo (the dragon, also the tab's icon), are the studio's own and aren't part of the licence. The libraries, the noise code and the fonts keep their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

Designed by [Pure Studio](https://www.purestudio.art/), a design studio for tech startups that need a brand and a landing page in a week.
