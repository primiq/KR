# Castaway → Babylon.js port

Goal: a like-for-like rebuild of **Castaway** (the Three.js island survival game in `primiq/castaway`)
on Babylon.js, inside this repo, so that it runs faster, looks better and works better in VR.

Rules:

- `primiq/castaway` is **read-only reference**. Nothing in it is ever modified.
- Everything is built here, under `BabylonVR/src/castaway/`, as the main page: `index.html` (the VR playground moved to `playground.html`).
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
| 1 | Game shell: `index.html`, menu, engine, quality tiers, desktop/touch/VR entry | done |
| 2 | Island terrain (ported height field, chunked LOD terrain, ocean), vegetation and harvestable resource nodes | done |
| 3 | Items, inventory, hotbar, bag and HUD (Babylon GUI, same UI in VR) | done |
| 4 | Harvesting: swing tools, fell trees, mine rocks, pickups, regrowth, springs, berries | done |
| 5 | Crafting, stations (workbench, campfire, furnace, bed, box) and grid building | done |
| 6 | Multiplayer: PeerJS transport, session, world sync, avatars, chat, pings, host migration | done |
| 7 | Saving and loading worlds | done |
| 8 | Survival loop: vitals, day/night, death, sleep | done |
| 9 | VR-first controls and menus (wrist hotbar, panels, arm-swing hits, hand-held tools) | in progress (done: controls, held tools, arm swings, wrist HUD, bag/craft panel; head pose for the game; warp-level, invasion-cannon, car and boat-helm controls; the guitar held in the left hand with real strumming and chord fingers; campaign grabbing and throwing; cat-house claws, climbing pulls and the mouse; cat and gorilla body scale, paws and gorilla hands; comfort vignette. VR map (right stick click; trigger on it pings), quick chat and players tabs; painting straight onto the picture with a hand-held palette. Not yet tested in a headset) |
| 10 | Wildlife, fishing, cooking and map | done |
| 11 | Characters: player models, customisation, procedural animation | done (Castaway's rigs and outfits drawn through ThreeMirror; customise screen; looks sync in multiplayer) |
| 12 | World content: caves, airstrip, cars, balloons, tower, cat house, hide-and-seek, tiles, campaign, narrator, Keith Avenue, paintings, weather, ships | in progress (done: huts and wrecks with chests; caves with digging, ore, crystals and chests; footprints, birds, flamingos, nesting sea turtles, wild and planted flowers; weather: showers, storms with lightning and thunder, rainbows; schools of fish and glowing seas; whales, passing ships and dolphins; saplings, doors, pictures with the paint editor; island cats, the Stalker and the twins at night; the stone circle and Mario; the warp pipe and secret level; the alien invasion; the water slide; the guitar; sailing boats, the storm at sea and the shipwreck; the secret sky room with its mirror and the cloud-door skydive; the airstrip with cars, balloons and the spiral tower; the cat house; Hideaway Isle hide and seek; the Chamber of Tiles; Banana or Salmon, the campaign with its narrator, the shop and the museum; Locations, Locations and Keith Avenue; the sea floor with kelp, seagrass, corals, light shafts and marine snow; the mountain stream and waterfall on the new island) |
| 13 | Audio, polish and performance pass | |

Multiplayer, inventory, harvesting and building come first.
