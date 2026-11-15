# Castaway: production readiness plan

Written 2026-11-15 for hand-off. Read `progress.md` first (rules, architecture, testing notes), then this file.
Work the phases in order; each numbered item is one commit (or a small group), pushed to `master`, with a What's new
entry when players can notice it and a line in `progress.md`. Tick items off here as they land.

## Ground rules for this plan

- All the standing rules in `progress.md` apply (no long dashes, What's new, direct to master, never touch the
  `castaway` repo, no model names in commits).
- **Performance must not get worse.** Before starting, record the baseline below; after every item that touches the
  render loop, loading or assets, measure again and put the numbers in the commit message. If a number gets worse by
  more than 3%, fix it or drop the change.
- Nothing here changes how the game plays unless the item says so. When unsure whether the owner would want a
  behaviour change, leave it and list it under "Questions for the owner" at the end of this file.
- The owner tests on a phone (Edge, Android), a PC (Edge) and a Quest. Headless tests cannot show GPU memory limits or
  real frame times: anything risky for phones needs the owner's check before the next risky item goes in.

## Baseline to record first (item 0)

Add `scripts/perf-baseline.mjs` (Playwright, the pre-installed Chromium, the same flags as the session harness described
in `progress.md` "Testing notes") that loads `?quality=low&go` and `?quality=high&go`, waits 30 s and prints:

- time to the Play screen, time to first frame in the world
- `scene.meshes.length`, total vertices, active meshes, draw calls (`engine._drawCalls.current` via SceneInstrumentation)
- JS heap (`performance.memory`), number of textures, bytes transferred for the main page (from the network log)
- the size of `dist/bundle/main-*.js` and the total of everything the main page loads before Play

Commit the script and a `docs/perf-baseline.md` with the numbers. Known today: `dist` is 84 MB in 462 files; the main
page's own script is 1.57 MB; `Bora.glb` 1.8 MB; Havok wasm 2 MB; ambience 1 MB. At load on low quality: 1.51M
vertices in about 1400 meshes.

## Phase 1: things that can lose a player's work or break a session (do these first)

1. DONE **Saves cannot be lost silently.** `net/save.ts` writes the whole world to one localStorage key and ignores
   failure (`put` returns false, nobody looks). Do:
   - keep the previous good save under a second key before overwriting (`world.bak`), and load it when the main one is
     missing or fails to parse or migrate;
   - when a write fails (quota), tell the player once on the HUD ("Could not save: storage is full") and retry with
     paintings (the largest part) left out, then say what was left out;
   - write `savedAt` and show "Saved" with the time in the menu;
   - add Export save / Import save buttons (a JSON file) on the Settings page.
   Test: fill localStorage in the harness, confirm the message and that the old save still loads.
2. DONE **Bad or hostile network messages cannot break the game.** `net/sync.ts` checks types on some events only. Go
   through every `case` in the event switch and the snapshot apply in `net/world.ts`: every number checked with
   `Number.isFinite` and clamped to a sane range, every id checked against its table (`ITEMS`, structure kinds),
   every string length-capped, every array length-capped. A malformed event is dropped, never thrown. Add a rate
   limit per sender (events per second) on the host. Outfit parsing (`parseOutfit`) is the model to follow.
3. **No HTML injection.** 21 uses of `innerHTML`. Player-supplied text is escaped where I looked (`esc(p.name)`,
   narrator), and the others interpolate constants, but audit all 21: anything from the network or from user input
   must go through `textContent` or `esc`. Chat is preset phrases only: keep it that way.
4. **Errors are visible.** `ui/diag.ts` already catches errors for `?diag`. Add: after an uncaught error in the main
   loop, keep the game running if it can, count errors, and after 3 in 10 s show a small "Something went wrong"
   bar with Reload and "Copy details" (version, device, last errors, no personal data). No outside reporting service
   unless the owner asks for one.
4b. **Anonymous usage reporting** (owner said yes). The Worker serves the static site; give it a tiny script
   (`worker/index.ts`, `main` in `wrangler.jsonc`) with a `POST /api/e` endpoint writing to Workers Analytics Engine
   (binding `EVENTS`), every other path to `env.ASSETS`. The game sends a few events (session start with device class,
   quality and body; Play pressed; level entered; multiplayer joined; errors counted; session length on pagehide via
   `sendBeacon`), batched, no names, no ids beyond a random per-browser id, nothing from chat or paintings. A Settings
   toggle "Send anonymous usage data" (on by default) and a line in the credits page saying what is sent.
5. **Version mismatch in multiplayer is explained.** The outfit change (7 to 9 numbers) already makes old clients show
   a random look. Send the build number in the join handshake; when host and guest differ, show both players "You and
   the host are on different versions: reload the page" rather than failing in odd ways. `PROTOCOL` exists: bump it
   whenever a message changes shape, and make the mismatch message name the fix.
6. **Stale pages.** `index.html` is served `no-cache`, bundles are immutable: good. Add a check every 10 minutes (fetch
   `index.html` head, compare the injected version) and a quiet "New version available: reload when you like" line in
   the menu. Never reload by itself mid-game.

## Phase 2: what ships and how fast it loads (no change to what is drawn)

7. **The playground's assets should not ship with the game.** `public/assets` is 58 MB, 51 MB of it Sponza, which only
   `playground.html` uses. Options, in order of preference: (a) drop the playground page from the production build
   (keep it in dev), or (b) leave Sponza streaming from its source and not copy it. Ask the owner which (question 1).
8. **Main bundle.** `main-*.js` is 1.57 MB and the page also pulls shared chunks. Use dynamic `import()` for what is not
   needed to reach the island: the levels (`world/tiletrial`, `volcano`, `desert*`, `warp`, `town`, `locations*`,
   `catroom`, `airstrip`, `skydive`, `invaders`), the painter, the customise screen, the VR modules when no headset is
   present, the Bora model and code (only when someone in the room uses that body). Each becomes its own chunk loaded
   on entry with the existing loading screen. Check for a hitch on first entry and prewarm where there is one.
   Measure: main page bytes before Play should drop by at least a third.
9. **Audio.** `ambience` 1 MB, `song` 612 KB, `summon` 428 KB as mp3: load after first frame, not before Play; consider
   re-encoding at a lower bitrate (question 2). The narrator clips: confirm they are fetched on demand.
10. **Bora model.** 1.8 MB, 15.9k vertices. Add meshopt compression in `scripts/build-bora.mjs` (the loader supports it),
    and make the skin texture 1024 px (it is recoloured at 512 px anyway). Target under 700 KB.
11. **PWA basics.** Add a web manifest (name, icons in PNG at 192 and 512, `display: fullscreen`, landscape) so the game
    can be installed on phones and opens without browser bars. No service worker yet (stale-cache risk); note it as a
    later option.
12. **Headers.** In `public/_headers` add `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, and a
    Content-Security-Policy that allows what the game uses (self, blob:, data:, the PeerJS broker, STUN/TURN). Test
    multiplayer and VR after adding it; a wrong CSP breaks things silently.

## Phase 3: performance headroom (measured, no visual change)

13. **Bora skinning on the GPU.** Every Bora is skinned on the CPU each frame in `render/mirror.ts` (about 16k vertices
    times up to 4 bones, positions and now normals). One is fine; eight on a phone is not. Give the mirror a path that
    builds a Babylon `Skeleton` from the three.js one and lets the GPU skin (bone matrices copied per frame), used for
    meshes over a vertex threshold. Keep the CPU path for small ones. Measure with 8 Boras on low quality.
14. **Bora at a distance.** Beyond about 25 m draw a simplified body (build a second, 3k vertex mesh in
    `build-bora.mjs`) and skip finger bones; beyond the avatar fade distance skip posing entirely.
15. **Avatar cost audit.** With 8 players (4 classic, 4 Bora) on screen record draw calls and frame time; the classic
    body is about 25 draws each. Confirm thin-instance batching still holds with mixed outfits.
16. **Garbage per frame.** `net/bora.ts` `pose()` and `makeBoraArm.pose()` allocate quaternions and vectors every frame
    (`clone()`, `new`). Hoist them. Do the same sweep over the hot paths named in `progress.md` (`game.update`,
    `avatars.update`, `vegetation.update`, `boats`): no `new` or array literals per frame per object.
17. **Long session check.** Run the harness for 30 minutes of scripted play (walk, chop, build, sail, enter and leave a
    level twice, open menus) and record heap, textures, geometries, meshes at 5 minute marks. Anything that grows
    without bound is a leak: fix it. Known suspects: materials cached by colour key in `net/bora.ts` (`mats`,
    `skinTex`) and in the mirror, never freed; the customise preview's engine.
18. **Phone memory.** The owner's phone froze once from memory. After 8 to 10, re-measure load-time vertices and
    textures on low quality and record them; set a budget in `docs/perf-baseline.md` (for example 1.6M vertices at
    load on low) that later work has to stay under.

## Phase 4: polish players will notice

19. **Bora: finish him.** Armour is not drawn on Bora; sleeve and arm holes are ragged (add a hem ring of geometry at
    each cut edge in `garments()`); check every pose (sitting, lying on the lounger, swimming, dead, sleeping,
    driving, in the sub) against the classic body in screenshots and fix what looks wrong; his fist for other
    players uses fixed finger angles: check against a held hatchet, spear and torch. VR hands are untested on a
    headset: ask the owner for a session (question 3) and fix what they report.
20. **Customise screen.** Nine rows now. Group them (Body, Head, Clothes), hide rows that do not apply (Beard only for
    Bora), make sure it fits a phone in landscape and portrait (the Settings grid fix is the model), and add a
    front/side toggle or keep the drag to turn.
21. **Settings a released game needs.** Master volume and separate music/narrator sliders (today: mute only, master
    gain 0.7 in `game/audio.ts`); mouse sensitivity and touch look sensitivity; invert Y; field of view (PC); a
    "reduce camera motion" toggle that turns off view bob and screen shake; left-handed VR (check what exists). All
    stored in prefs, all applied live.
22. **First minutes.** Play the first 10 minutes as a new player on PC, phone and (owner) VR and write down every
    moment where it is unclear what to do. Fix with the existing prompt and narrator systems, not new UI: what to
    pick up first, how to craft, how to open the menu on each device, how to save (it is automatic: say so once).
23. **Touch controls pass.** On a phone: every action reachable (the flute's 8 notes, the drum, painting, the sub's
    controls, the raft helm, the compass), buttons not under the thumbs' resting places, safe-area insets respected,
    the crafting swipe (done) repeated for every other scrolling list (inventory, map legend, What's new).
24. **Text pass.** Read every string in the game once (`ITEMS` names and descriptions, prompts, messages, What's new,
    the menus): consistent capitals, British spelling as used so far, no placeholder text, no developer words
    (dev mode stays hidden unless enabled).
25. **Sound pass.** With the bird beeps gone, the island by day is quiet. Add a soft, non-tonal daytime ambience layer
    (wind in palms, distant surf already exists: check levels) and make sure every action has a sound and none
    clips: craft, place, pick up, eat, drink, hurt, level up tools, door, raft oar, sub. Synthesised like the rest;
    no new audio files unless small.
26. **Map.** `progress.md` lists "Map does not show the open sea or the Arctic". Add a zoomed-out page: the rings, the
    islets you have visited, the Arctic coast, your boats and the compass's home bearing.
27. **Known rough edges from `progress.md`.** The far Arctic coast reads as a thin dark line from the berg zone; penguin
    huddles are loose; the raft's deck cut-out is a rectangle (an L-shaped raft shows a gap in a wave): replace the
    box with up to 4 boxes per raft, one per row of tiles, within the shader's existing 4 slots or by raising them to
    8 (measure the shader cost).

## Phase 5: confidence (tests and release routine)

28. **Unit tests for the pure parts.** Add Vitest. Cover: `world/island.ts heightAt` (fixed points do not move: this is
    what saves and multiplayer depend on), `seafeatures`, `arctic`, `planIslets` node order and count (832 nodes
    today: a test that fails if the count or the first/last positions change), `net/outfit.ts` parse and migrate,
    `net/save.ts` migrate, recipes (every recipe's inputs and outputs exist in `ITEMS`), `GRIPS` covers every item.
29. **Smoke tests in the browser.** Turn the session's ad hoc harness into `tests/smoke/*.mjs` run by one npm script:
    boots to Play on low and high; real Play flow with the warm-up; a save and reload round trip; two pages in one
    room (host and guest: join, see each other, chop a tree, see it fall on both, place a structure, leave); customise
    with each body; an emulated phone boots and the Settings and crafting pages fit. Each fails on any page error.
30. **CI.** A GitHub Actions workflow on push: typecheck, unit tests, build, and the smoke tests that run in under
    10 minutes headless. Cloudflare builds only what is on master, so a red check should be seen quickly.
31. **Release checklist** in `docs/RELEASE.md`: bump What's new, run smoke tests, check the Cloudflare build went green
    and the menu shows the new version, test join between an old and a new tab, test the phone. Keep a short
    "last known good" commit noted there for rolling back.
32. **Licences and credits.** List every third-party asset and library with its licence in `CREDITS.md` and link it from
    the menu: Babylon.js, three.js, PeerJS, Havok, ez-tree, nipplejs, the Bora model (owner's own: confirm), the Mario
    model in `assets/mario` (question 4: this is a Nintendo character and should not ship in a public release), the
    song and narration, the HDR environments. Remove anything whose licence does not allow redistribution.

## Order and size

Phase 1 is about a day of work and should go first without waiting for answers. Phase 2 items 7 to 10 give the
largest loading win. Phase 3 items 13 and 16 matter most for phones. Phases 4 and 5 can be interleaved; 28 and 29
should land before large refactors (8, 13) so they are protected.

## Owner's answers (2026-11-15)

1. Remove the playground page from the public build: YES.
2. Re-encode music and ambience at slightly lower quality: YES.
3. Quest check of Bora's hands: the owner will do it later.
4. Replace Mario with an original character: a plumber called Bob.
5. Usage reporting: YES, wanted (anonymous; see item 4b).
6. Paid TURN / own broker: not yet.

## Questions for the owner (as asked)

1. The VR playground page and its 51 MB Sponza scene ship with the game. Remove the playground from the public
   build, or keep it?
2. May the music and ambience be re-encoded smaller (slightly lower quality)?
3. A short Quest session to check Bora's hands (grip on the controller, the join at the wrist, tools in hand).
4. The druids level uses a Mario model and an "it's me" sound clip. For a public release these should be replaced
   with an original character. Replace, or is the game staying private among friends?
5. Is any kind of error or usage reporting wanted (none is planned)?
6. Multiplayer relies on the public PeerJS broker and public STUN servers: fine for friends, not guaranteed for a
   public release. Is a paid TURN service or an own broker wanted?
