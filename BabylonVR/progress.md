# Castaway (Babylon) - progress and hand-off notes

A living summary of where the game is, how it is built and what was decided, so that anyone (another model, another
person) can pick the work up without reading the whole conversation history. **Keep it up to date**: every batch of work
adds to "Recent work" and updates any section it changes. Newest first. No long dashes anywhere (see Rules).

Last updated: 2026-11-12 (islet resources, raft deck, sea storm, wave crest fix)

## The project in one paragraph

Petr's Castaway is a multiplayer island survival game (desktop, touch and VR headsets such as Quest), originally three.js
(`primiq/castaway`, read-only reference), ported to Babylon.js in this repo under `BabylonVR/src/castaway/`. It is the main
page (`BabylonVR/index.html`), built with Vite, deployed to Cloudflare (`wrangler.jsonc`, `npm run build:cf`). Players gather,
craft, build houses, rafts, boats and a submarine, explore an island with caves, levels and secret rooms, and now sail out
through rings of open sea to an Arctic. Multiplayer is peer to peer (PeerJS), the host's world is the truth.

## Rules (from the owner; never break them)

- Never touch the `primiq/castaway` repo. Work only in `primiq/KR`, directly on `master`, push to `origin master`. No PRs.
- **No long dashes ever** (em dash, en dash): not in code, comments, commit messages, game text, What's new, or replies.
- Every player-facing change adds an entry at the TOP of `UPDATES` in `src/castaway/ui/whatsnew.ts` in the same commit
  (its date drives the "new" dot on the menu). Dates so far run ahead of the calendar (latest 2026-12-06): keep going up.
- Commits end with the Co-Authored-By and Claude-Session lines; no model names or IDs in commits.
- Performance changes must be measured (an earlier perf change was rolled back).
- Keep this file (`progress.md`) current.

## How it is built (architecture map)

- `main.ts`: page boot, engine, quality, the render loop (`scene.onBeforeRenderObservable`), loading screen, warm-up,
  menus, saving, multiplayer wiring, many world systems that are Babylon-native (ocean, sky, seabed, arctic view, glow).
- `game/game.ts`: the game rules and per-frame logic (input to actions, building, structures, boats, subs, fishing,
  instruments, survival, wreck sequence, nature updates). Very large; most features hook in here.
- `render/mirror.ts` (ThreeMirror): three.js scene graphs (animals, plants, boats, most world props) are mirrored into
  Babylon as thin instances bucketed by (geometry, material). Supports `userData.babylonTag`, `liveEmissive`, `liveColor`,
  per-object `userData.fade` (colour fade) and per-instance colour/alpha.
- `render/bake.ts`: structures (furniture, stations) are built in three.js, then baked to merged Babylon meshes; parts
  marked `userData.keep` stay separate nodes (flames, compass card, flag cloth).
- `render/materials.ts`: PBR custom materials (rock, planks, masonry). `local` variants work in object space for things
  that move (deck planks, stone on a raft).
- `world/island.ts`: the height field `heightAt` used by everything (walking, boats, placement). It folds in the open
  sea's islets and reefs (`world/seafeatures.ts`) and the far sea's ice and Arctic (`world/arctic.ts`). `deepFloorAt` gives
  the bare floor without those.
- Net: `net/sync.ts` (events, short keys like "sp", "fl", "dp"), `net/world.ts` (snapshot capture/apply, also the save).
- VR: `vr/vr.ts` (controllers, hands, instruments, drum sticks), `vr/panel.ts` (the menu board, also used flat on PC).
- Levels live far away at fixed coordinates and are only drawn while you are in them: airstrip (3000, 0), hide isle
  (-3000, 0), tile trial (-6000, 0), cat room (6000, 0), volcano (0, -14000), desert (z 15000+).

## The world out at sea (radial rings, the same in every direction)

| Distance from the island's middle | What |
|---|---|
| 360 to 780 m | Reef storm. Without a compass aboard: giant wave and wreck (wakes you on the beach). With one: full storm 430 to 650 m, eases by 780 m, no wave |
| 820 m to 2.1 km | Islets (sand, real palms to fell, boulders, some ore, coconuts, chest) and shipwrecks on reefs (`seafeatures.ts`, built by `opensea.ts`) |
| from 2.1 km | Drift ice floes (`arctic.ts`) |
| from 3.3 km | Icebergs (pinnacles and tabular), solid incl. underwater bulges; second storm 3.6 to 5.3 km |
| about 7.6 km | The Arctic: a ring of ice land, wandering coast; cliffs, plateau, crevices, melt pools (drinkable), penguin colonies every ~600 m |
| 10.7 km | Edge: a current turns boats and subs back (`keepInSea`) |

Everything out there is deterministic from cell hashes (same for all players, nothing sent). Meshes are streamed near
the player and dropped behind. Chests out there use the deep sea chest system (looted state synced and saved).

## Feature list (what exists, roughly)

Survival, gathering, crafting (Essentials first: hand-craftable recipes), building (walls, floors, windows, doors, pools,
railings), stations (workbench, campfire, furnace with fuel buttons, bed, box), armour slots, fishing, cooking, animals,
night creatures (Stalker, ghost twins), weather (rain, storms, rainbow), day/night with stars and moon, caves, many levels
and a campaign, cars, balloons, helicopter, raft (buildable deck), sailing boat, 4-seat submarine with lights and depth
screen, deep sea abyss with glowing creatures (GlowLayer) and chests, open sea, Arctic with penguins, compass, paintable
pictures and flags, guitar (strings in VR), drum (velocity and rim/centre), flute, butterflies, gulls, whales, dolphins.

## Recent work (newest first)

- **Bora steps 4 and 5**: his own first-person arms and VR hands (see "In progress: Bora"); skin tone fixed.

- **Bora step 3**: Bora wears the full wardrobe (clothes cut from his skin, hat/shades/scarf on bones, packs moved on).

- **Bora step 2**: Bora is a selectable body (Customise > Body) with hair/skin/beard/shorts colours, synced like any
  outfit. See "In progress: Bora".

- **Bora step 1**: the model pipeline (`scripts/build-bora.mjs`, dev deps `@gltf-transform/*`), source in `assets-src/`,
  output `public/models/bora.glb`. Not used by the game yet. See "In progress: Bora".

- **Sky, oar, wake**: the cloud shader (`world/skyDeco.ts`) varies the cover across the sky with two slow big-scale
  noises (banks and clear spells), adds billows, darker thick middles, and a high cirrus layer; `SkyDeco.update` swings
  the overall cover with two slow sines of its own time (fair to cloudy spells, local, not synced). The raft oar's blade
  end is now 2.35 m below the pivot (about 0.8 m under the waterline). `Boats.wake(add)` drops rings into the sea's ripple
  simulation (the 32 m square that follows the player) at the leading corners, sides, stern and oar blade of every boat
  under way; called from main each frame.

- **Crafting list swipe, FXAA back on phones**: the old drag-to-scroll on the crafting ScrollViewer only worked between
  rows (GUI buttons are pointer blockers). `vr/panel.ts` now listens to page pointer events while the flat board is up:
  a drag starting over the pane scrolls it 1:1 with the finger (bar value by the list's hidden height); past 12 px the
  rows stop taking hits until the lift, so a swipe never crafts. Mobile preset `aa` back to "fxaa" (the owner's phone
  runs fine with it; the freeze was the warm-up's look round). `board` is exposed on `window` for tests.

- **Beeps and the Settings page**: the island birds' day song (`game/nature.ts`, `sfx.chirp`: 2 to 3 short sine beeps
  from birds perched unseen in trees) is removed, and so is the chirp when they take off (the flutter stays). The town
  level's own chirps are untouched. Settings: `.gfx-grid` uses `repeat(auto-fit, minmax(min(100%, 240px), 1fr))`, so it
  drops to one column when two do not fit (a fixed two columns overflowed phones between 420 and ~550 CSS px).

- **Phone freeze found**: the owner's phone froze on the first frame in normal mode but played with `?safe&diag`. Safe
  mode skips the warm-up's 360 degree look round and menu opening and turns edge smoothing off, so on touch devices
  (and the mobile tier) the warm-up now goes straight to waiting for smooth frames, and the mobile preset's `aa` is "off"
  (was FXAA). Which of the two it was is not known; both were new on phones. `?safe` and `?diag` stay for future reports.

- **Diagnostics for phones** (`ui/diag.ts`): `?diag` in the address shows a panel (version, loading stage, page and 3D
  frame counts, canvas size, GPU name, graphics lost count, memory, meshes, last errors); it also appears by itself on an
  uncaught error or a lost context. `?safe` skips the warm-up's spin and menu opening and turns edge smoothing off.
  Used to chase the owner's phone freezing on a black screen (Edge and the built-in browser), still unexplained.

- **Phones froze / went black after Play** (owner report, not reproducible headless): most likely GPU memory, after the
  islet vegetation added ~200 meshes and ~600k vertices at load (every islet is its own cull tile with its own geometry
  copies, near and far). Islet trees and rocks are still nodes from the start (same numbers and order), but their refs
  point at a stand-in until you come within 1 km; `Vegetation.buildIslets` then makes that islet's meshes (one per
  ~30 updates, nearest first) and they stay. One shape each (palm, boulder, ore). At load on mobile quality: 1.51M
  vertices / 1405 meshes (was 2.10M / 1752). Still to confirm on the owner's phone.

- **Deploy fix**: the Cloudflare worker is named `kr`, but both `wrangler.jsonc` files (repo root and `BabylonVR/`) said
  `babylon-vr-playground`, so builds deployed to another worker and the live game never changed. Both now say `kr`.
- **Arctic supplies**: frozen logs (pick up: 4 wood) and a new item `frozen_meat` (poor raw; campfire turns it into
  cooked meat). Streamed by `Resources.arcticLoot` in 48 m cells within 150 m of you on the Arctic land (ids
  `ax<i>_<j>_<k>`, the same on every client, not saved: `net/world.ts` skips them); one taken comes back after 30 min.
  Pickups can now have a look of their own (`spawn(..., look)`, `Pickup.key`): the log is a "frozen_log" look of wood.

- **Islet resources, raft deck, sea storm, wave crests**: the islets' palms, boulders and ore are now real vegetation
  nodes (`planIslets` in `world/vegetation.ts`, from each islet's seed, appended after the oasis so older node numbers
  never shift; bigger islets (r > 17) get 5 to 9 palms, 2 to 3 boulders, often ore). `opensea.ts` only builds the ground
  and the chest now. Coconuts under islet palms are scattered last in `resources.ts` (coconut pickup cap 420, others 140).
  Raft decks: `Boats.raftHoles()` fills 4 oriented boxes (from just under the deck to 4.5 m above) that the ocean shader
  discards (`boxA/boxB` uniforms in `src/island/ocean.ts`), so waves are not drawn over the deck. Sea storm: new
  `Weather.gloom` / `Atmosphere.gloom` (eased from the boat storm, fast) darkens clouds, light, haze, fog and the sea body;
  lightning every 1.5 to 5 s once gloom > 0.3. Wave crest glitch: the ocean shader decided "seen from under water" per
  pixel (camera lower than the pixel), so crests taller than the eye were drawn flipped and see-through; it now uses a
  `camUnder` uniform (surface height at the camera), lakes keep the old test. The planar reflection also fades out on
  water above the horizon.

- **Menu readability, start smoothness, version**: Babylon simple buttons did not pass fontSize/fontWeight to their label
  (all button labels drew at the 18 px default); `vr/panel.ts` now patches Button.prototype to pass them on (affects VR
  too). Flat board cap raised from 1000 to 1400 CSS px. `prewarm` now spins the camera 360 degrees round the spawn, then
  opens the board for 0.9 s, then waits for smooth frames. The version is injected into index.html at build time
  (vite plugin `castaway-version`). Still to confirm on the owner's PC: whether any start stutter remains.
- **Swim anywhere**: the old swimmer limit (never further out than you already are, past 340 m, unless within 30 m of
  a boat) blocked swimming from a wreck back to a raft further out. `world/player.ts` now limits swimmers only at the
  sea's edge (`OUTER`), like boats.
- **Mouse look fix**: auto-fullscreen on Play broke mouse look in Edge (the fullscreen switch dropped the pointer lock
  requested at the same moment). Fullscreen is now an opt-in setting, "Fullscreen while playing" (pref
  `castaway.fullscreen`, Settings page); when on, the pointer lock is requested only after fullscreen has settled.
  Default protection against Ctrl+W is the "Leave site?" question. Verified headless: Play click locks the mouse, mouse
  movement turns the view.
- **Rafts, reefs, freezes** (2026-11-12): raft rowing +50% (5.1 / 6.9 m/s). Wrecks get a reef mesh; the bare deep floor
  is streamed in 400 m squares everywhere out at sea; the Arctic meshes cover the whole underwater shelf. WebGL context
  loss: save, explain on the loading screen, reload when restored; stalled loading (25 s) shows recovery advice. The
  owner's PC freezes after alt-tab/screenshots are most likely GPU driver resets wedging the browser's GPU process.
- **Ctrl+W and smooth start**: PC play goes fullscreen with keyboard lock (Chromium) so Ctrl+W reaches the game; a
  "Leave site?" guard otherwise (`leaving` flag for intentional reloads). `prewarm` runs the world behind the loading
  screen until frames are smooth, only then offers Play. If GPU resets keep happening, consider making auto-fullscreen optional.
- **Raft fixes**: deck structures keep their exact deck spot in sync events and saves; the compass check also counts any
  compass standing on your deck. Deck structures use object-space materials (no sliding textures).
- **Sea in every direction**: the old 620 m boat limit removed; the north corridor became radial rings (table above);
  storm narration removed except the no-compass warning; reef storm lengthened; compass distance measures to the main island.
- **Music**: flute (VR: at the lips, right trigger breath, X/Y/left trigger fingers = 8 notes, left grip octave; PC: hold
  click, keys 1-8), guitar resynthesised (pick position, velocity layers, body + room reverb), drum dynamics and rim.
- **Crafting menu**: Essentials (no workbench) listed first (`CRAFT_LIST`, `craftGroup` in `game/recipes.ts`).
- **Flag**: craftable, paintable like pictures (VR paints on the cloth), waves with the wind, works on decks, synced/saved.
- **Arctic, icebergs, penguins, snowfall**, ice material plugin (snow vs glassy ice, fresnel glow, sparkles).
- **Compass, open sea islets and wrecks, gulls, whales at sea, weather at sea.**
- **Anti-aliasing option** (off, FXAA, MSAA 4x, max), deep sea glow and fades, sub view half in/out of water, sub placement.
- Earlier (summarised): raft and submarine, deep sea, big performance pass (reflection and shadow culling), flat-screen
  menu board, furnace fuel, gear slots, butterflies and flowers, desert digging, sandstorm, many VR fixes.

## In progress: Bora, a second playable character

The owner supplied `assets-src/Bora.glb` (an old castaway: white hair and beard, tattoos, shorts; Blender Rigify export).
Decisions (owner): keep both bodies (a "Body" choice in customisation: Classic or Bora); Bora gets the same customisation
(hair colour, beard, skin, shirts, trousers, shoes, hats, shades, bags) but clothes must fit well; in VR the controllers
are hidden and Bora's hands follow the controllers (fingers react to buttons, items held in them).

Plan and state:
1. DONE: `scripts/build-bora.mjs` makes `public/models/bora.glb` (63 deform bones re-parented to each other, face bones
   folded into the head, palms into the hands, all weights re-mapped; hair/beard welded without UVs and simplified;
   15.9k vertices, 1.8 MB). Posing tested in three.js (arm, leg, head bend cleanly). Note: three.js strips dots from node
   names (`DEF-upper_arm.L` loads as `DEF-upper_armL`). The model is about 9 units tall, A-pose, faces +z, materials
   are unlit in the export (replace with lit ones in game).
2. DONE: `net/bora.ts` (loadBora / makeBora). The classic rig stays as an invisible puppet; Bora's bones copy its
   joints each frame (limbs first swung from his A-pose to hang straight, then the puppet joint's rig-space rotation);
   hips follow the puppet's hips; the puppet's wrists are moved onto his hands so held items sit in his grip. First
   person shrinks his head bone (and arm bones on a flat screen). Skin tone: his texture recoloured per tone (512 px,
   shared). The GLB must use separate (not interleaved) vertex buffers: the mirror's CPU skinning reads plain arrays.
   Tested: customise preview, walking with a hatchet next to a classic player.
3. PARTLY: Body and Beard slots added (outfit is 9 numbers; 7-number outfits from older clients get Classic/full beard).
   Hair colour, skin, trouser colour (his shorts), beard style work; Head "Buzz cut" hides his hair. Clothes DONE: `garments()`
   in `net/bora.ts` cuts shirts (T, sleeveless, camp), trousers, boots and sandals from his body mesh (triangles chosen
   by bone weights and height, pushed out along normals, his skin weights) as SkinnedMeshes bound to his skeleton; the
   shorts mesh shows only with shorts. Hat, shades and scarf are small meshes on his head/neck bones (`onBone`); the
   puppet's rucksack/satchel is moved onto his chest bone, squeezed to his size; the name plate sits on his chest.
   Still to do: armour on Bora, skin tint a bit red, a few ragged edges at sleeve holes. Clothes for Bora are made from his own body mesh (vertices of the shirt/trouser/boot regions by bone
   weight, pushed out along the normal, coloured, same skin weights), hats/shades/bags rigid on head/spine bones.
4. DONE (screen): `makeBoraArm` in `net/bora.ts` cuts his forearm and hand (18 bones) from the body; `HandRig.syncBora`
   in `game/hands.ts` poses it from the first-person rig's elbow, wrist, finger and thumb groups (each bone's "hand
   frame", y along the bone and z out of the palm, lined up with the rig joint's; the palm sign was found by testing).
   `setViewLook` (main applyOutfit) tells the hands which body you play. Mirror: textured materials can glow
   (emissiveMap). Skin recolouring now by brightness from the swatch's sRGB value (three's Color is linear: was red).
5. DONE, NOT TESTED ON A HEADSET: `VRHand.sync()` (called in vr.ts after the hand holder's matrices) poses Bora's hand
   on the controller rig, so the existing finger curl (grip/trigger) and held items carry over; its forearm folds into
   the wrist. Your own body in VR (`fpSelf`) tucks its hands away (`firstPerson(head, arms, hands)`). Other players: the
   puppet's VR arms reach the controllers and Bora follows; his fingers close when the puppet's hand is a fist.

## Known issues and open ideas

- Freezes on the owner's PC after alt-tab or screenshots (see above): handled now, root cause is outside the game.
  Auto-fullscreen is off by default now (opt-in setting).
- Not yet verified on a real device: the new sounds (guitar, drum, flute), the flute's VR lip distance (0.33 m), the
  second storm in play, Ctrl+W keyboard lock in Edge.
- The far Arctic coast reads as a thin dark line on the horizon from the berg zone.
- Penguin huddles are a bit loose.
- Map does not show the open sea or the Arctic.

## Testing notes (for whoever continues)

- Build: `cd BabylonVR && npx tsc --noEmit -p . && npx vite build`; preview `npx vite preview --port 4173`.
- Headless Playwright harness used during this work (session scratchpad, not in the repo): load
  `index.html?quality=low&go` (`go` skips the menu), run JS steps against the page globals `game`, `player`, `scene`,
  `engine`, `clock`, `heightAt`, take canvas screenshots. Headless runs at 1 to 2 fps, so frame-time judgements need a real
  machine. `window.__castawayStart = 'play'` (init script) exercises the real Play flow including the warm-up.
- Useful debug hooks: `game.openSea.find('wreck'|'islet', x, z)`, `game.boats.add(...)`, `game.structures.place(...)`,
  `game.subs.add(...)`, `clock.hour = 12`.
