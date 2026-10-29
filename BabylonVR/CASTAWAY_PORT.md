# Castaway → Babylon.js port

Goal: a like-for-like rebuild of **Castaway** (the Three.js island survival game in `primiq/castaway`)
on Babylon.js, inside this repo, so that it runs faster, looks better and works better in VR.

Rules:

- `primiq/castaway` is **read-only reference**. Nothing in it is ever modified.
- Everything is built here, under `BabylonVR/src/castaway/`, as its own page: `castaway.html`.
- Work lands on `master`.

Engine-agnostic Castaway code (items, recipes, inventory, survival rules, island height field,
multiplayer transport and session protocol, save format) is carried over nearly verbatim.
Everything that renders, animates or simulates is rebuilt on Babylon:

- Havok physics
- the Gerstner ocean with interactive ripples
- the PBR / IBL pipeline
- Babylon GUI, so one UI tree works on desktop, touch and in the headset
- WebXR hands and controllers

## Task list (in order)

| # | Task | Status |
|---|---|---|
| 1 | Game shell: `castaway.html`, menu, engine, quality tiers, desktop/touch/VR entry | done |
| 2 | Island terrain (ported height field, chunked LOD terrain, ocean), vegetation and harvestable resource nodes | done |
| 3 | Items, inventory, hotbar, bag and HUD (Babylon GUI, same UI in VR) | done |
| 4 | Harvesting: swing tools, fell trees, mine rocks, pickups, regrowth, springs, berries | done |
| 5 | Crafting, stations (workbench, campfire, furnace, bed, box) and grid building | done |
| 6 | Multiplayer: PeerJS transport, session, world sync, avatars, chat, pings, host migration | done |
| 7 | Saving and loading worlds | done |
| 8 | Survival loop: vitals, day/night, death, sleep | done |
| 9 | VR-first controls and menus (wrist hotbar, panels, arm-swing hits, hand-held tools) | in progress (controls, held tools, arm swings, wrist HUD, bag/craft panel) |
| 10 | Wildlife, fishing, cooking and map | done |
| 11 | Characters: player models, customisation, procedural animation | done (Castaway's rigs and outfits drawn through ThreeMirror; customise screen; looks sync in multiplayer) |
| 12 | World content: caves, airstrip, cars, balloons, tower, cat house, hide-and-seek, tiles, campaign, narrator, Keith Avenue, paintings, weather, ships | in progress (done: huts and wrecks with chests; caves with digging, ore, crystals and chests) |
| 13 | Audio, polish and performance pass | |

Multiplayer, inventory, harvesting and building come first.
