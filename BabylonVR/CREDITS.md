# Credits and licences

Everything the published game ships, and under what terms. Keep this list in step with `package.json` and the asset
folders; the same list (without the notes) is in the game under Settings > Credits.

## Code libraries (bundled)

| Library | Licence |
| --- | --- |
| Babylon.js (`@babylonjs/core`, `gui`, `loaders`, `materials`) | Apache-2.0 |
| Havok physics (`@babylonjs/havok`) | MIT |
| three.js | MIT |
| PeerJS | MIT |
| ez-tree (`@dgreenheck/ez-tree`, with its bark and leaf textures) | MIT (textures CC0, as its package says) |
| nipplejs (touch joystick) | MIT |
| Draco decoder (`public/draco`) | Apache-2.0 (licence file shipped beside it) |

## Art, sound and voices

| Asset | Where | Terms |
| --- | --- | --- |
| Bora model | `src/castaway/assets/bora`, source `assets-src/Bora.glb` | The owner's own (owner to confirm) |
| The song | `src/castaway/assets/song.mp3` | Petr and Stewart's own song |
| The sky room photo | `src/castaway/assets/photo.jpg` | The owner's own |
| Narration clips | `src/castaway/assets/narration` | Made for this game (owner to confirm how, if a voice service's terms apply) |
| Sky environment | `public/assets/env/sanGiuseppeBridge.env` | From the Babylon.js assets (licence to confirm) |
| Forest HDR | `public/assets/env/forest_slope_1k.hdr` | Poly Haven via pmndrs drei-assets, CC0 |
| Sand, rocky ground, water bump textures | `public/assets/island`, `public/assets/forest` | From the Babylon.js assets repository (licence to confirm) |
| Everything else (sounds, models, terrain, characters) | made in code | The game's own |

Removed for release: the Mario model and its two sound clips (replaced by Bob the plumber, made in code), the VR
playground's Sponza scene and woman model (development only, not published).
