# Castaway (Babylon) - progress and hand-off notes

A living summary of where the game is, how it is built and what was decided, so that anyone (another model, another
person) can pick the work up without reading the whole conversation history. **Keep it up to date**: every batch of work
adds to "Recent work" and updates any section it changes. Newest first. No long dashes anywhere (see Rules).

Last updated: 2026-11-12 (mouse look fix)

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
  (its date drives the "new" dot on the menu). Dates so far run ahead of the calendar (latest 2026-11-23): keep going up.
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
| 820 m to 2.1 km | Islets (sand, palms, rock, chest) and shipwrecks on reefs (`seafeatures.ts`, built by `opensea.ts`) |
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
