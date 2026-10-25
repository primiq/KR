# Babylon VR Playground

A WebXR-first physics playground built on **Babylon.js 9** and **Havok** physics, set in the
**Crytek Sponza** atrium. Open it in a VR headset browser and you play it in VR with
controllers or your bare hands. On a desktop it runs as a first-person game with mouse and
keyboard.

## Quick start

```bash
cd BabylonVR
npm install
npm run fetch-assets   # optional: download Sponza + HDR (~52 MB) for offline use
npm run dev            # http://localhost:5173
```

Without `fetch-assets`, the app streams the same files from GitHub at runtime.

### Running it on a headset (Quest / Pico / Vision Pro…)

WebXR only works on `https://` or `localhost`.

- **Same network:** `npm run dev:https`, then open `https://<your-pc-ip>:5173` in the
  headset browser and accept the self-signed certificate warning.
- **USB (Quest):** `adb reverse tcp:5173 tcp:5173`, then open `http://localhost:5173` on the headset.
- **Static hosting:** `npm run build` and upload `dist/` to any HTTPS host (GitHub Pages,
  Netlify, Cloudflare Pages…). The build uses relative paths, so a sub-folder works.

**Entering VR automatically:** browsers only start an immersive session after a user gesture.
On a headset the app tries to enter VR straight away and also answers the `sessiongranted`
event, so you go straight into VR when you arrive from another WebXR page. Otherwise the
first tap anywhere on the start screen enters VR.

## Controls

| Action | VR controllers | Hand tracking | Desktop |
| --- | --- | --- | --- |
| Move | Left stick (click = sprint) | Walk around your room | WASD (+Shift to sprint) |
| Turn | Right stick snap-turn (30°) | Turn your body | Mouse |
| Jump | **A** | Flick both palms upward | Space |
| Crouch | Crouch for real, or hold **B** / pull right stick back | Crouch for real | Hold C or Ctrl |
| Grab / throw | **Grip** an object you're touching, then let go mid-swing to throw | **Pinch** (thumb + index) or **make a fist** around it | Hold left mouse button |
| Force-grab | **Trigger** at an object up to 15 m away; it flies to your hand | – | – |
| Push / poke | Touch objects with the controller | Fingertips and palms are physics colliders | **F**: force push |
| Throw (desktop) | – | – | Right mouse button while holding |
| Hold distance | – | – | Mouse wheel |
| Menu (graphics toggles + stats) | **Y** | Pinch your left hand for about 1 second | Panel at top-right |
| Reset blocks | **X** | Button in the menu | **R** |

## What's in the scene

- **Environment:** the Sponza atrium (Khronos glTF sample asset), with PBR textures and
  a triangle-mesh Havok collider. Alpha-tested foliage and chains have no collision.
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
  main.ts         bootstrap: engine, Havok, loading flow, start screen, VR entry
  config.ts       asset URLs, physics layers, player & interaction tuning
  environment.ts  Sponza, IBL, sun + cascaded shadows, torches, reflection probe
  materials.ts    showcase material library
  props.ts        dynamic blocks, parkour, crouch tunnel, showcase
  player.ts       Havok PhysicsCharacterController: walk/sprint/jump/crouch, XR head-follow
  interaction.ts  grab/throw manipulators, kinematic finger/controller colliders, force push
  xr.ts           WebXR session, controllers, hand tracking (pinch/fist/poke/jump gesture)
  desktop.ts      keyboard + mouse controls
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
- The default WebXR hand meshes are loaded at runtime from the Babylon.js CDN.
- [Babylon.js](https://www.babylonjs.com/) (Apache-2.0) and
  [Havok for Babylon.js](https://www.npmjs.com/package/@babylonjs/havok) (MIT).
