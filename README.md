# Kare · Sand garden

A React Native / Expo sand tray, inspired by a physical rotary zen garden. A walnut rim, brass rake, and granular sand are rendered in real time with `expo-gl` on iOS, Android, and the web.

## Run

```sh
npm install
npm start
```

Open with an SDK 58-compatible Expo Go app, or use `npm run web` for a browser preview. Native development builds must include `expo-gl`.

## Controls

- **Play / pause** the rotating rake.
- **Drag around the tray** to turn it manually. Dragging pauses automatic rotation.
- **Fresh sand** smooths the tray. The teeth settle into the new surface where they stand.
- **Speed** cycles through 0.5×, 1×, and 2×.
- **Sound** enables a soft metal-through-sand scrape. It follows actual rod movement, including dragging, and fades to silence when the rod stops. Sound starts off; tap its control to enable playback.

Reduced-motion preferences start the garden paused. Backgrounding the app suspends updates.

The sound is an original synthesized 12-second loop of filtered friction, fine grain contacts, and a faint damped metallic resonance. `expo-audio` varies its level and playback rate with motion and pauses it in the background. It uses a bundled asset, requires no recording permissions, and mixes with other audio. Regenerate the asset with `python3 scripts/generate-sand-audio.py`. Native development builds must also include `expo-audio`.

## Rendering

The scene is procedural: no static tray image, web view, or remote assets. The sand is a height field simulated on the GPU, and the renderer ray-marches it directly. Its furrows, raised edges, heaps, slumps, and the seams where one pass meets another are all produced by the simulation rather than drawn on. Arbitrary finger-drawn marks are not supported yet, but the height field could accept them.

The field has 512 × 512 cells, about 0.6 mm each on a 30 cm tray. Heights are 16-bit integers split across two bytes of an RGBA8 texture, because byte textures are renderable on every WebGL device. Two textures alternate: each pass reads one and writes the other. Bilinear filtering is linear, so the split height interpolates exactly when rendered.

Each pass moves the rake a short step:

- **Plowing.** The 24 teeth are 2.5 mm pins. Sand above a tooth's tip is pushed away from it, ahead and to the sides; sand behind a moving tooth stays where it is. Teeth are solid across their whole width, so a heap leans on its tooth with a supported back and a free face, and sand cannot slip through. Material shoved aside builds the raised edges beside each furrow. Reversing leaves the old leading piles behind.
- **Slipping.** Neighbouring cells, including diagonals, exchange sand when the slope between them exceeds 36°. Once flowing, a cell keeps flowing down to 29°, and flowing cells lower the threshold for their neighbours, so slips spread as small avalanches and then stop. Each cell has a fixed friction variation of ±15%, so walls fail unevenly.
- **Imperfections.** The rake has a little play in its hub, so its path is slightly eccentric and the two arms track a fraction of a millimetre apart. Individual teeth are slightly bent and uneven in length. Grooves are therefore not perfect circles, and repeated passes blur them slightly.

The rake can carry toothed arms or a scalloped blade; set `tool` in the initial state in `src/app/index.tsx`. The app currently starts with the blade.

- **Blade.** Each arm carries a thin brass plate whose lower edge is cut into 9 V-shaped lobes with rounded tips, each about 1.4 cm wide and 3 mm deep. The edge averages 0.03 mm below the tray's mean sand level. It acts as a continuous row of teeth that scrapes cleanly: the lobes carve smooth troughs about 1.4 mm below the original surface and push the sand into a berm leaning on the plate. The berm drops sand under the notches between lobes, building ridges about 1.7 mm above it. The lobes' flanks rise at about 25°, just under the angle where flowing sand stops, so the ridges mostly stand. Where the sand's friction is lower, they slump a little. Depth is bounded by width: dry sand can't hold a narrower groove this deep. A straight edge (set `BLADE_SCALLOP_DEPTH` to 0) leaves a level, smooth plain instead.
- **Berm behaviour.** The berm spills around the blade's ends, building a low ridge near the rim and hub. Reversing leaves it behind as a radial ridge.
- **Berm relaxation.** The berm is far larger than a tooth's heap, and its face avalanches much faster than the blade advances. Six extra relaxation passes per step are therefore drawn over a strip around the bar. Cells outside the strip keep their values, and an even number of passes leaves the texture complete.
- **Ceiling.** Sand can't be piled above 0.04 units, just under the bar; beyond that it spills back over the tool and is left behind it.

Relaxation runs at 240 passes per second at any frame rate. Fast rake motion adds passes so each tooth advances less than 0.8 cells per pass, up to 40 passes per frame; drags faster than that cut shallower furrows. Millimetre-scale slips finish within a fraction of a second. The simulation keeps running for 1.5 s after the rake stops, so abandoned heaps can collapse, then the sand is fully at rest and frames are skipped.

The texture also records whether each cell has been disturbed since the tray was smoothed. Raked sand renders lumpier than the compacted fresh surface.

Materials:

- **Grains.** Fine grains dominate, with sparse larger grains at twice their scale. Most share one tone with slight variation; dark mineral grains are sparse and clear quartz grains rarer still. Both scales use spatial filtering and fade toward a matte average below pixel resolution. Grains in the heap ahead of a tooth travel with it.
- **Glints.** A few quartz grains have a facet turned toward the light. They are fixed to the sand: they stay put on resting sand and change only as the surface under them moves. There is no time-randomized sparkle.
- **Lighting.** Unresolved grain-scale roughness uses Oren–Nayar diffuse reflection. A warm key light and cooler studio fill light the tray. Troughs see less fill and pick up sand-tinted light reflected between grains, so shaded furrows are slightly warmer and more saturated. Highlights on the sand, wood, and brass roll off smoothly instead of clipping; the background colour still matches the page.

## Physical basis and limits

- [Sumner, O'Brien & Hodgins (1999), *Animating Sand, Mud, and Snow*](https://doi.org/10.1111/1467-8659.00299): a height field displaced by moving objects and relaxed toward a stable slope. This is the overall approach here.
- [Percier et al. (2011), *Lift and drag forces on an inclined plow moving over a granular surface*](https://doi.org/10.1103/PhysRevE.84.051302): a moving plow carries a wedge with a supported back and a free sloping face, rather than a rounded, liquid-like bulge. Applying a broad-blade result to thin rake teeth is a qualitative approximation.
- [Edwards et al. (2019), *Frictional hysteresis and particle deposition in granular free-surface flows*](https://www.cambridge.org/core/journals/journal-of-fluid-mechanics/article/frictional-hysteresis-and-particle-deposition-in-granular-freesurface-flows/48758AE4E4BE2C41458F240451158274): static and flowing material coexist, and starting and stopping have different thresholds. The 36° start and 29° stop angles are illustrative tuning choices, not measured constants for the pictured sand.
- [Oren & Nayar (1994), *Generalization of Lambert's reflectance model*](https://doi.org/10.1145/192161.192213): diffuse reflection from rough surfaces, with roughness σ = 0.4 rad.

Every transfer between two cells is an integer computed by the same function from both sides, so one cell's loss is exactly its neighbour's gain. Total volume is therefore conserved exactly, including reversals and fast drags. `scripts/check-sand-gpu.mjs` verifies this for both tools on the GPU it runs on. It also checks that unswept sand is untouched, free slopes stay within the stopping angle, and the sand comes fully to rest.

This is not a calibrated granular solver. It does not resolve individual grains, contacts, force chains, compaction, or moisture; looseness affects only shading. Tooth size, depth, hub play, blade level, and the relaxation rates are tuning choices, and slip timing comes from the pass rate rather than from dynamics.

The simulation and renderer have been checked in Chrome's WebGL 2, in the app's web build and in a headless harness. The native `expo-gl` render-to-texture path and physical-device performance still need to be profiled before shipping. Each active frame costs 8 or more simulation passes over the 512² field plus the scene. The blade adds six strip passes per pass, each covering about an eighth of the field.

- `src/app/index.tsx`: native UI and controls
- `src/components/sand/sand-tray.tsx`: gestures and animation lifecycle
- `src/components/sand/renderer.ts`: rake state and tool, simulation timing, and scene drawing
- `src/components/sand/geometry.ts`: tray, teeth, and blade dimensions, hub play, and pass planning shared by CPU and shaders
- `src/components/sand/height-field.ts`: GPU height-field textures, pass scheduling, and berm strips
- `src/components/sand/sim-shaders.ts`: plowing, slipping, and the fresh tray
- `src/components/sand/shaders.ts`: camera, sand materials and lighting, wood, and brass
- `src/components/sand/program.ts`: shader compilation

## Check

```sh
npx expo lint
npx tsc --noEmit
node --test scripts/sand-geometry.test.mjs # Node 22.18+ (TypeScript stripping)
node scripts/check-sand-gpu.mjs            # needs Chrome; set CHROME to its path if it isn't found
npx expo export --platform all
```
