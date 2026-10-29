# Babylon VR Playground

A WebXR-first physics playground built on **Babylon.js 9** and **Havok** physics. Pick a
location from the start screen or the in-VR menu:

- **Sponza Atrium:** the Crytek Sponza courtyard.
- **Deep Forest:** a procedurally grown forest with a clearing and a pond.
- **Desert Island:** a palm-covered island in an open sea with interactive water.

It also hosts **Castaway** (`castaway.html`): a Babylon.js rebuild of the multiplayer island survival
game, with harvesting, inventory, crafting, grid building and online co-op. See
[Castaway](#castaway) below and `CASTAWAY_PORT.md` for the port's task list.

Open it in a VR headset browser and you play it in VR with controllers or your bare hands.
On a phone or tablet you get touch controls. On a desktop it runs as a first-person game with
mouse and keyboard.

## Quick start

```bash
cd BabylonVR
npm install
npm run fetch-assets   # optional: download Sponza + HDR skies (~55 MB) for offline use
npm run dev            # http://localhost:5173
```

Without `fetch-assets`, the app streams the same files from GitHub at runtime.

### Running it on a headset (Quest / Pico / Vision Pro…)

WebXR only works on `https://` or `localhost`.

- **Same network:** `npm run dev:https`, then open `https://<your-pc-ip>:5173` in the
  headset browser and accept the self-signed certificate warning.
- **USB (Quest):** `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` on the headset.
- **Cloudflare (Workers, git-connected):** leave *Root directory* empty, set *Build command* =
  `npm run build` and *Deploy command* = `npx wrangler deploy`. The repo-root `package.json`
  and `wrangler.jsonc` build this folder (with Sponza and the HDR skies bundled) and deploy
  `BabylonVR/dist`.
- **Static hosting:** `npm run build` and upload `dist/` to any HTTPS host (GitHub Pages,
  Netlify, Cloudflare Pages…). The build uses relative paths, so a sub-folder works.

**Entering VR automatically:** browsers only start an immersive session after a user gesture.
On a headset the app tries to enter VR straight away and also answers the `sessiongranted`
event, so you go straight into VR when you arrive from another WebXR page. Otherwise the
first tap anywhere on the start screen enters VR.

## Controls

| Action | VR controllers | Hand tracking | Phone / tablet | Desktop |
| --- | --- | --- | --- | --- |
| Move | Left stick (click = sprint) | Walk around your room | Left thumb: floating joystick (push to the rim to sprint) | WASD (+Shift to sprint) |
| Turn / look | Right stick snap-turn (30°) | Turn your body | Drag with your right thumb | Mouse |
| Jump | **A** | Flick both palms upward | **Jump** button | Space |
| Crouch | Crouch for real, or hold **B** / pull right stick back | Crouch for real | **Crouch** button (toggles) | Hold C or Ctrl |
| Grab | **Grip** an object you're touching | **Pinch** (thumb + index) or **make a fist** around it | **Grab** what's under the centre dot; tap again to drop | Hold left mouse button |
| Throw | Let go mid-swing | Open your hand mid-swing | **Throw** button | Right mouse button while holding |
| Force-grab | **Trigger** at an object up to 15 m away; it flies to your hand | – | – | – |
| Push / poke | Touch objects with the controller | Fingertips and palms are physics colliders | **Push** button | **F** |
| Hold distance | – | – | – | Mouse wheel |
| Menu (graphics, stats, location) | **Y** | Pinch your left hand for about 1 second | Graphics panel at top-right | Panel at top-right |
| Reset blocks | **X** | Button in the menu | **Reset** button | **R** |

On phones the app asks for full screen and landscape where the browser allows it (Android
Chrome and Samsung Internet do).

## Locations

**Sponza Atrium:** the Sponza atrium (Khronos glTF sample asset), with PBR textures and a
triangle-mesh Havok collider. Alpha-tested foliage and chains have no collision. Flickering
torches light the arcades.

**Deep Forest:** generated at load time, with no large downloads:

- **Trees:** oak, ash, pine and aspen trees and bushes, grown procedurally (an algorithm
  ported from [ez-tree](https://github.com/dgreenheck/ez-tree)). They use photo-scanned bark
  (colour, normal, roughness and AO maps) and alpha-tested leaves with subsurface
  translucency, so sunlight glows through the canopy. Each species is drawn with **thin
  instances** at two detail levels (near and far), and every trunk has a Havok collider.
- **Terrain:** a rolling height-field with a flat clearing. A custom PBR shader
  (`PBRCustomMaterial`) blends grass into dirt on slopes, in patches and along the pond shore.
- **Ground cover:** thousands of thin-instanced grass clumps and flowers.
- **Wind:** a custom **material plugin** sways leaves and grass, with each instance on its own
  phase.
- **Pond:** `WaterMaterial` gives it real-time reflection and refraction of the trees and sky.
- **Rocks:** climbable boulders with convex-hull colliders.
- **Fireflies:** a GPU particle system steered by animated noise (CPU particles on low tiers).
- **Atmosphere:** exponential fog, the Poly Haven *Forest Slope* HDR sky lighting the scene,
  cascaded shadows from the canopy, and looping forest ambience (Babylon Audio V2).

**Desert Island:** a beach terrace, a wooden pier and an open ocean.

- **Ocean:** a custom GPU shader with six Gerstner waves (real rolling crests). Waves calm in
  the shallows using a seabed depth texture. The water has Fresnel sky reflection, a sun
  glitter path, depth-based colour (turquoise shallows to deep blue), light scattered through
  crests, lacy shoreline foam, see-through shallows and a seamless horizon.
- **Interactive water:** a wave-equation simulation runs on the GPU in ping-pong render
  targets that follow the player. Your legs, VR hands and controllers, and anything floating
  push ripples into it.
- **Liquid mechanics:**
  - Buoyancy and drag on every prop, sampled from the same wave function as the shader.
    Crates, coconuts, a beach ball and a swim ring bob and drift; gold, chrome and the diamond
    sink.
  - Wading slows you down. In deep water you float and swim, and Jump strokes upward.
  - Fast entries throw splashes.
  - Underwater turns into blue fog.
- **Light:** an atmospheric `SkyMaterial` sky is rendered once into an HDR cube, then
  GGX-prefiltered with `HDRFiltering` and projected to spherical harmonics. That way the
  scene's lighting and the ocean's reflections match the sky exactly. The seabed shows
  animated caustics and depth absorption.
- **Island:** a sand, grass and rock blend shader with a wet-sand line, plus procedurally
  generated palm trees (curved ringed trunks, drooping fronds with per-leaflet colour, coconut
  clusters, wind sway). Shore rocks and grass are thin-instanced.

All locations get the same physics playground:

- **Physics playground:**
  - two block pyramids
  - a brick wall
  - a curving line of dominoes
  - heavy crates you can climb
  - a showcase of glass, gem and metal objects on marble plinths
- **Parkour:**
  - steps that need a jump
  - a high platform
  - a **kinematic moving platform** you can ride (it moves Havok bodies by velocity, so it
    carries you along)
- **Crouch course:** a low steel beam to duck under, and a 1.15 m tunnel you can only get
  through crouched. When you stand up inside it, a head-room raycast stops you clipping
  through the roof.

### Quality tiers

The app picks a tier from the device. You can override it with `?quality=high|medium|mobile`.

| Tier | Used for | Differences |
| --- | --- | --- |
| high | Desktop | Full forest density (about 1.2M triangles), 4 shadow cascades, GPU particles |
| medium | VR headsets | About 550k triangles, 3 shadow cascades |
| mobile | Phones and tablets | About 300k triangles, 2 cascades at 1024 px, render resolution capped at 1.25× pixel ratio, no MSAA, glow/probe/water off by default |

### Rendering features

| Feature | Babylon.js API | Desktop | VR default |
| --- | --- | --- | --- |
| Image-based lighting + skybox | `CubeTexture.CreateFromPrefilteredData` (.env) | ✓ | ✓ |
| Sun with 4-cascade PCF soft shadows | `CascadedShadowGenerator` | ✓ | ✓ |
| HDR bloom, ACES tone mapping, MSAA ×4, FXAA | `DefaultRenderingPipeline` | ✓ | ✓ |
| Depth of field with physics-raycast autofocus | `DefaultRenderingPipeline.depthOfField` | ✓ | toggle |
| SSAO2 ambient occlusion | `SSAO2RenderingPipeline` | ✓ | toggle |
| Screen-space reflections | `SSRRenderingPipeline` | ✓ | toggle |
| Volumetric light shafts | `VolumetricLightScatteringPostProcess` | ✓ | toggle |
| Chromatic aberration, grain, vignette, sharpen | `DefaultRenderingPipeline` | ✓ | toggle |
| Emissive glow for neon trims and circuits | `GlowLayer` | ✓ | ✓ |
| Live scene reflections and refraction | `ReflectionProbe`, a real-time cube map | ✓ | ✓ |
| Water reflections and refraction (forest) | `WaterMaterial` | ✓ | ✓ |
| Wind-animated vegetation (forest) | Custom `MaterialPluginBase` | ✓ | ✓ |
| Fog and fireflies (forest) | `Scene.fogMode`, `GPUParticleSystem` + `NoiseProceduralTexture` | ✓ | ✓ |
| Fixed foveated rendering | `WebXRSessionManager.fixedFoveation` | – | ✓ |

Screen-space passes run once per eye in VR, so they start switched off there. You can turn
any of them on from the in-VR menu to stress-test your headset; it shows live FPS, frame,
render and physics times, and draw calls.

### Materials

All materials are Babylon `PBRMaterial`:

- **Refraction and dispersion:**
  - clear glass with chromatic dispersion
  - amber glass with distance-based absorption
  - frosted glass
  - diamond (IOR 2.42, strong dispersion)

  All of these refract the live reflection probe, so you see the real scene through them.
- **Translucency:**
  - jade, with subsurface translucency under a clear coat
  - wax
  - marble with a procedurally generated vein texture
- **Clear coat:** tinted candy-red car paint and pearl paint
- **Iridescence:** thin-film "oil slick" metal and thin-film chrome
- **Sheen:** velvet, used on the moving platform
- **Anisotropy:** brushed steel
- **Metals:** polished gold, and a chrome mirror that uses the reflection probe
- **Emissive:**
  - neon cyan, magenta and amber
  - procedurally drawn sci-fi crates with glowing circuitry

## Project layout

```
src/
  main.ts         bootstrap: engine, Havok, quality tier, location, start screen, VR/touch/desktop entry
  config.ts       asset URLs, physics layers, player & interaction tuning
  environment.ts  location interface, quality tiers, shared sun/shadows/skybox/probe helpers
  locations/
    atrium.ts     Sponza, torches, playground layout for the corridor
    forest.ts     terrain, trees, grass, flowers, rocks, pond, fireflies, fog, playground layout
    island.ts     island terrain + caustics, ocean, palms, pier, floating toys, playground layout
  forest/
    treeGen.ts    procedural tree geometry (ported from ez-tree)
    wind.ts       wind-sway material plugin
    character.ts  the woman figure (loaded from public/models)
  island/
    ocean.ts      Gerstner ocean shader, buoyancy, splashes, wading/swimming hookup, underwater
    ripples.ts    GPU wave-equation ripple simulation
    sky.ts        atmospheric sky -> prefiltered HDR environment
    palm.ts       procedural palm trees
  materials.ts    showcase material library
  props.ts        dynamic blocks, parkour, crouch tunnel, showcase
  player.ts       Havok PhysicsCharacterController: walk/sprint/jump/crouch, XR head-follow
  interaction.ts  grab/throw manipulators, kinematic finger/controller colliders, force push
  xr.ts           WebXR session, controllers, hand tracking (pinch/fist/poke/jump gesture)
  desktop.ts      keyboard + mouse controls (grab/throw/push shared with touch)
  touch.ts        mobile touch controls: floating joystick, look-drag, action buttons
  graphics.ts     post-processing stack and quality toggles
  ui.ts           desktop HUD and in-VR menu (Babylon GUI on a mesh)
```

**Physics layers:** the static world, dynamic props, the player capsule, hand and controller
colliders, and held objects each have their own Havok collision filter. This means:

- your fingers push blocks but never shove your own body
- an object you're holding can't knock you over

**VR locomotion:**

- The player is a Havok character capsule. Each frame the capsule follows your real head
  position with collision, so room-scale walking stops at walls.
- The thumbstick adds smooth locomotion on top.
- The capsule's height follows your real head height, so physically crouching lets you fit
  under obstacles.

## Debugging

- `?fixedstep` makes the simulation advance a constant 16 ms per frame. This is useful on
  slow GPUs or software rendering.
- `scene`, `engine`, `player`, `props`, `graphics`, `interaction` and `xrSystem` are
  available in the browser console.

## Credits & licences

- **Sponza** © Crytek (released for free use), with PBR textures by Alexandre Pestana.
  The glTF conversion comes from the
  [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Sponza)
  (CC-BY 3.0).
- **San Giuseppe Bridge** HDR environment from the
  [Babylon.js Assets](https://github.com/BabylonJS/Assets) repository (CC0, originally
  from Poly Haven).
- **Forest Slope** HDRI by Poly Haven (CC0), via
  [pmndrs/drei-assets](https://github.com/pmndrs/drei-assets).
- **Tree generator, leaf textures, grass, flowers, rocks, dirt and grass textures, and forest
  ambience** come from [ez-tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck
  (MIT). Its bark textures are CC0, from Poly Haven and TextureCan.
- **Sand and rocky-ground textures** from the [Babylon.js Assets](https://github.com/BabylonJS/Assets)
  repository (CC BY 4.0).
- **Water bump map** from the [Babylon.js Assets](https://github.com/BabylonJS/Assets)
  repository (CC BY 4.0).
- **Draco glTF decoder** from [google/draco](https://github.com/google/draco) (Apache-2.0),
  bundled in `public/draco`.
- The default WebXR hand meshes are loaded at runtime from the Babylon.js CDN.
- [Babylon.js](https://www.babylonjs.com/) (Apache-2.0) and
  [Havok for Babylon.js](https://www.npmjs.com/package/@babylonjs/havok) (MIT).


## Castaway

`castaway.html` is a like-for-like port of **Castaway** (the three.js island survival game) to
Babylon.js. The rules, item and recipe data, island height field, seeds and multiplayer protocol
come from Castaway. Rendering, materials, the ocean and the VR controls are rebuilt on Babylon.

- **Harvesting:** 200 palms, 130 jungle trees, 150 boulders and ore rocks, and 22 berry bushes,
  placed with Castaway's seeds. Trees fall and drop coconuts; rocks wear down and crumble. Things
  grow back when nobody is near.
- **Inventory:** 24 slots with a 6-slot hotbar, armour, tool durability, eating and drinking.
- **Crafting:** Castaway's recipes, with a workbench for advanced ones. Campfires and furnaces
  cook and smelt; storage boxes hold your stuff.
- **Building:** a 3 m grid with foundations on stilts, walls, doorways, opening windows, floors,
  stairs and joined pools, plus upgrading to stone.
- **Homes:** hang doors in doorways, frame pictures on the walls and paint them (everyone sees
  them), put flowers in pots, and plant saplings that grow into trees.
- **Wildlife, fishing and the map:** crabs, boars and jaguars are Castaway's procedurally rigged
  animals and their AI, with meat and hides to collect. You can cast a rod for fish, cook on a
  campfire, and use the explored island map (M).
- **Caves and ruins:** ruined huts and shipwrecks hide chests. Hollow ground hides shafts down to
  a cave network under the island: dig with a pickaxe, climb down with a torch, and mine iron,
  coal and diamonds among glowing crystals.
- **Island life:** footprints in the sand, birds that hop about and scatter when you come close,
  flamingos, sea turtles that come ashore to nest, wild flowers to pick and plant, and island
  cats. At night something watches from the trees.
- **The secret room:** the odd door in one ruined hut opens onto a hall floating high above the
  island, with a glass floor, a mirror and doors to other places. The cloud door lets you jump out
  and skydive down with a parachute; the airstrip door leads to an island of cars to drive, ramps,
  balloons and a spiral tower, and the paw-print door turns you into a cat in a giant house
  (climb the scratching posts, pounce, chase the mouse). The green door opens Hideaway Isle, a
  hide-and-seek round where hiders crouch in boxes and the seeker tags them, and the copper door
  opens the Chamber of Tiles, where a screen shows a symbol and every tile that doesn't match drops into the pit. Survive
  ten rounds to win.
- **Banana or Salmon:** the yellow door in the secret room starts a co-op campaign, voiced by a
  mosquito narrator. Pick the banana to play as a gorilla or the salmon to play as a cat, then
  set off from the cosy room: an odd shopping list at the chemist, and a night locked in the museum
  gift shop, where the cat slips under the sensor beams and the gorilla climbs ropes and turns
  heavy statues. Alone, you can do the other animal's jobs too.
- **Locations, Locations:** another door in the secret room leads to a monitor room of real places.
  Pick Keith Avenue to walk a real street rebuilt from OpenStreetMap data, with houses, gardens,
  parked cars and street lamps, and windows that light up at night.
- **The stone circle:** touch two stones of one colour on the hilltop and something answers. Red
  summons Mario under a cursed pink sky. Lead him to the warp pipe by the old hut and everyone
  jumps into a secret side-scrolling level together. Blue calls an alien invasion that everyone
  fights off from laser cannons round the circle.
- **Sailing:** build a boat, put it in the water and sail it, with friends walking about on deck.
  Go too far past the reef and a storm builds until a giant wave wrecks you and you wake up on the beach.
- **Fun:** a giant water slide winding down the far side of the island, and a guitar to strum
  (other players hear you).
- **Weather:** showers and the odd storm, decided by the host. The sky greys, the palms bend, the
  sea heaves, lightning flashes and thunder rolls, and a rainbow can follow the rain.
- **The sea:** schools of fish swim in the lagoon and scatter when you come close, and on some
  nights the surf glows blue. Whales surface and breach far out, dolphins leap, and now and then
  a ship passes on the horizon.
- **Day and night:** a 25-minute day with a moving sun, stars and moon. Sleep in a bed at night.
- **Characters:** Castaway's player models, outfits and armour, with walk, swim and swing
  animation. **Customise character** on the menu picks your look, which other players see.
- **Multiplayer:** host a room and share the 5-letter code. It is peer to peer over WebRTC
  (PeerJS), with host migration when the host leaves.
- **Desktop and touch:** controls as in Castaway.
- **VR:** hold tools in your right hand and swing your arm to chop or mine. The vitals, hotbar
  and prompts are on your left wrist, and the bag and crafting panel float in front of you.
  Controls:

  | Control | Action |
  | --- | --- |
  | Left stick | Walk (push to the edge, or hold the left grip, to sprint) |
  | Right stick | Snap turn and hotbar |
  | Right trigger | Use or place |
  | Right grip or A | Pick up or open (hold to pick structures up) |
  | B | Jump or swim up |
  | Left trigger | Dive |
  | X | Rotate what you are placing (otherwise opens crafting) |
  | Y | Next building piece |
  | Left stick click | Bag |

Testing tip: `castaway.html?net=local` uses a BroadcastChannel transport, so two tabs of the
same browser can play together without any network.
