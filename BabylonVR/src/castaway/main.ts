import {
    Color3,
    Color4,
    DefaultRenderingPipeline,
    Engine,
    ColorCurves,
    ImageProcessingConfiguration,
    type Mesh,
    Quaternion,
    Scene,
    SSAO2RenderingPipeline,
    UniversalCamera,
    Vector3,
    type WebXRDefaultExperience,
} from "@babylonjs/core";
import { createSun } from "../environment";
import { Ocean } from "../island/ocean";
import { createSky } from "../island/sky";
import type { SkyMaterial } from "@babylonjs/materials";
import { Input } from "./core/input";
import { Chat } from "./net/chat";
import * as THREE from "three";
import { planSites, SurfaceSites } from "./world/sites";
import { CaveView } from "./world/caveView";
import { Weather } from "./world/weather";
import { BIO } from "./world/sealife";
import { Cats } from "./world/cats";
import { SkyRoom } from "./world/skyroom";
import { Skydive } from "./world/skydive";
import { Airstrip } from "./world/airstrip";
import { CatHome } from "./world/catroom";
import { HideIsle } from "./world/hideisle";
import { TileTrial } from "./world/tiletrial";
import { FPPaws, PLAYER_COATS } from "./world/cats";
import { HUMAN, CAT, GORILLA } from "./world/player";
import { Narrator } from "./game/narrator";
import { LocationsRoom } from "./world/locationsroom";
import { Town } from "./world/town";
import { LOCATIONS } from "./world/locations";
import { F_LEVEL } from "./world/warp";
import { Campaign } from "./campaign/campaign";
import { Shop } from "./campaign/shop";
import { Museum } from "./campaign/museum";
import { FPGorilla } from "./campaign/gorilla";
import { Mosquito, setListener } from "./campaign/mosquito";
import { ThreeMirror } from "./render/mirror";
import { Dolphins } from "./world/dolphins";
import { SEA } from "./world/waves";
import { getOutfit, onOutfitChange, setPlayerOutfit } from "./net/outfit";
import { SKINS } from "./net/playerModel";
import { setupCustomise, setNameLocked } from "./ui/customise";
import { setViewSkin } from "./game/viewmodel";
import { Avatars, playerColor } from "./net/avatars";
import { eraseSaves, guestKey, LAYOUT, loadChar, loadWorld, migrateWorld, newWorldId, saveChar, saveWorld } from "./net/save";
import { Session } from "./net/session";
import { WorldSync } from "./net/sync";
import { cleanCode, setTurn, type TransportKind } from "./net/transport";
import { applyChar, applyWorld, captureChar, captureWorld } from "./net/world";
import { getPref, setPref } from "./core/prefs";
import { pickQuality } from "./core/quality";
import { Game } from "./game/game";
import { planSprings } from "./game/resources";
import { driveWind, Wind } from "./render/foliage";
import { shadowCasters } from "./render/inst";
import { CLASSIC, cutBounds, findSpawn, heightAt, SPAWN_THETA, TERRAIN_SIZE } from "./world/island";
import { Waterfall } from "./world/waterfall";
import { Seabed } from "./world/seabed";
import { Player } from "./world/player";
import { Terrain } from "./world/terrain";
import { Atmosphere } from "./world/atmosphere";
import { Vegetation } from "./world/vegetation";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
function progress(f: number, text: string) {
    $("loading-bar").style.width = `${Math.round(f * 100)}%`;
    $("loading-text").textContent = text;
}

/** The sun stands over the sea ahead of the spawn beach and a little to the side, mid-morning. */
function sunDirection(): Vector3 {
    const az = SPAWN_THETA + 0.85, el = 0.62;
    // direction the light travels (from the sun towards the island)
    return new Vector3(-Math.cos(az) * Math.cos(el), -Math.sin(el), -Math.sin(az) * Math.cos(el)).normalize();
}

async function main() {
    const q = pickQuality(getPref("castaway.quality") ?? "auto");
    const qSel = $<HTMLSelectElement>("quality");
    qSel.value = getPref("castaway.quality") ?? "auto";
    qSel.addEventListener("change", () => { setPref("castaway.quality", qSel.value); location.reload(); });

    const canvas = $<HTMLCanvasElement>("game");
    const engine = new Engine(canvas, true, { xrCompatible: true, stencil: true, antialias: true, powerPreference: "high-performance" }, true);
    engine.enableOfflineSupport = false;
    engine.setHardwareScalingLevel(q.scale / Math.min(window.devicePixelRatio || 1, q.name === "high" ? 2 : 1.5));
    window.addEventListener("resize", () => engine.resize());

    const scene = new Scene(engine);
    // Castaway's maths is right-handed (three.js); Babylon runs the same way here so every formula ports unchanged
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.55, 0.75, 0.95, 1);
    scene.skipPointerMovePicking = true;
    scene.autoClear = false;
    driveWind(scene);

    // ---- the menu comes first: nothing of the island is built until you start a game (single player or a room)
    setupCustomise();
    $("mp-open").addEventListener("click", () => $("mp-panel").classList.toggle("hidden"));
    const tab = (host: boolean) => {
        $("mp-tab-host").classList.toggle("on", host);
        $("mp-tab-join").classList.toggle("on", !host);
        $("mp-pane-host").classList.toggle("hidden", !host);
        $("mp-pane-join").classList.toggle("hidden", host);
    };
    $("mp-tab-host").addEventListener("click", () => tab(true));
    $("mp-tab-join").addEventListener("click", () => tab(false));
    $<HTMLInputElement>("mp-name").value = getPref("name") ?? "";
    // an invite link: ?join=CODE opens the join tab with the code filled in
    if (params.get("join")) { $("mp-panel").classList.remove("hidden"); tab(false); $<HTMLInputElement>("mp-code").value = cleanCode(params.get("join")!); }
    const saved = loadWorld();
    {
        const cb = $("continue"), pb = $("play");
        if (saved) {
            cb.classList.remove("hidden");
            cb.textContent = `Continue · ${new Date(saved.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
            pb.textContent = "New island";
        }
        // (the headset check is cheap; the XR session itself is set up with the island)
        void navigator.xr?.isSessionSupported("immersive-vr").then((ok) => { if (ok) { $("play-vr").classList.remove("hidden"); $("mp-vr-opt").classList.remove("hidden"); } }).catch(() => {});
    }
    $("loading").classList.add("hidden");
    $("menu").classList.remove("hidden");
    /** which start button was pressed (its action runs once the island is built) */
    let startWith = params.has("go") || params.has("auto") ? "auto" : "";
    if (!startWith) {
        await new Promise<void>((res) => {
            const ids = ["continue", "play", "play-vr", "mp-host", "mp-join"];
            let armed = 0;
            const h = (e: Event) => {
                const id = (e.currentTarget as HTMLElement).id;
                e.stopImmediatePropagation(); e.preventDefault();
                if (id === "mp-join" && cleanCode($<HTMLInputElement>("mp-code").value).length < 5) { $("mp-status").textContent = "Enter the 5-letter room code"; $("mp-status").classList.add("err"); return; }
                // a new island over a saved one: a second press confirms, as in Castaway
                if (id === "play" && saved && Date.now() > armed) {
                    armed = Date.now() + 4000;
                    const pb = $("play"); pb.textContent = "Tap again: erase saved island";
                    setTimeout(() => { if (Date.now() >= armed) pb.textContent = "New island"; }, 4100);
                    return;
                }
                startWith = id;
                for (const b of ids) $(b).removeEventListener("click", h, true);
                res();
            };
            for (const b of ids) $(b).addEventListener("click", h, true);
        });
    }
    $("menu").classList.add("hidden");
    $("loading").classList.remove("hidden");
    progress(0.05, "Painting the sky…");
    await nextFrame();
    const SUN = sunDirection();
    const { skybox, env } = await createSky(scene, SUN, q.tier);
    {
        // Castaway's clear tropical sky: little haze and glare, so the blue overhead is deep and the clouds stand out against it
        const sm = skybox.material as SkyMaterial;
        sm.turbidity = 2.2;
        sm.rayleigh = 1.6;
        sm.mieCoefficient = 0.0032;
        sm.mieDirectionalG = 0.82;
    }
    const { sun, shadows, sunMesh } = createSun(scene, SUN.clone(), 6.5, q.tier, q.name === "high" ? 90 : 60);
    sun.diffuse = new Color3(1, 0.9, 0.76);
    if (!q.shadows) shadows.getShadowMap()!.refreshRate = 0;
    scene.environmentIntensity = 1;

    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.0;
    ip.contrast = 1.15;
    // richer colour: a tropical island should be saturated (the sea, the greens, the sunsets)
    ip.colorCurvesEnabled = true;
    const curves = new ColorCurves();
    curves.globalSaturation = 32;
    ip.colorCurves = curves;

    progress(0.2, "Raising the island…");
    await nextFrame();
    const terrain = new Terrain(scene, q, SUN);
    void terrain.loadTextures();

    progress(0.35, "Filling the lagoon…");
    await nextFrame();
    const ocean = new Ocean(scene, {
        quality: q.tier,
        seabedAt: heightAt,
        seabed: { minX: -TERRAIN_SIZE / 2, minZ: -TERRAIN_SIZE / 2, size: TERRAIN_SIZE },
        sunDirection: SUN,
        sunColor: new Color3(1, 0.86, 0.68).scale(5),
        env,
    });

    progress(0.5, "Planting palms…");
    await nextFrame();
    const spawn = findSpawn();
    const springSpots = planSprings(spawn);
    const sitePlan = planSites(spawn, springSpots);
    const vegetation = new Vegetation(scene, q, [{ x: spawn.x, z: spawn.z, r: 7 }, ...springSpots, ...sitePlan.map((p) => ({ x: p.x, z: p.z, r: p.r }))]);

    progress(0.8, "Waking the wind…");
    await nextFrame();
    const player = new Player(spawn.x, spawn.z, spawn.yaw, vegetation.colliders);
    player.surfaceAt = (x, z) => ocean.surfaceAt(x, z);
    ocean.bindPlayer(player);

    const camera = new UniversalCamera("cam", player.eye.clone(), scene);
    camera.inputs.clear();
    // (Castaway's 10 cm near plane: depth precision goes with it, and a closer one let the door plates and trims of the secret
    //  rooms, a centimetre or two apart, flicker on GPUs with a shallower depth buffer)
    camera.minZ = 0.1;
    camera.maxZ = 1600;
    camera.fov = 1.2;
    scene.activeCamera = camera;

    let started = false;
    const input = new Input(canvas, (locked) => {
        if (locked) { $("menu").classList.add("hidden"); $("hud").classList.remove("hidden"); }
        else if (input.enabled && !game.uiBlocking && !vrActive()) { $("menu").classList.remove("hidden"); $("hud").classList.add("hidden"); input.enabled = false; inGameMenu(); }
    });
    const clock = new Atmosphere(scene, sun, skybox, env, ocean, sunMesh, q.name === "low");
    if (params.has("hour")) clock.hour = parseFloat(params.get("hour")!);
    progress(0.82, "Washing the castaway ashore…");
    await nextFrame();
    const game = new Game({ scene, camera, player, vegetation, input, spawn, springSpots, shadows: q.shadows, clock });
    // ruined huts and shipwrecks with chests, and the caves under the island
    const sites = new SurfaceSites(game.ugRoot as unknown as THREE.Scene, sitePlan, vegetation.colliders, q.shadows);
    game.under.sites = sites;
    const caves = new CaveView(scene, game, clock, q.shadows);
    // the mountain stream and its waterfall (the new island only)
    // the sea floor: rocks, kelp, seagrass, corals and shells (only near the sea; nothing of it exists inland)
    const seabed = new Seabed(scene, clock, () => sun.diffuse, q);
    const waterfall = CLASSIC ? null : new Waterfall(scene, game.natureRoot, clock, q.name === "low");
    // the sea's own surface for things far out (whales, ships, dolphins)
    SEA.surface = (x, z) => ocean.surfaceAt(x, z);
    const dolphins = new Dolphins(game.natureRoot, (x, z) => ocean.surfaceAt(x, z));
    if (params.has("nodolphins")) dolphins.enabled = false;
    if (params.has("dolphintest")) { dolphins.wait = 1; dolphins.rate = 0.08; }
    // the secret room behind the odd door in the hut, and the skydive from its cloud door
    progress(0.85, "Hiding the secret room…");
    await nextFrame();
    const sky = new SkyRoom(game.natureRoot as unknown as THREE.Scene);
    game.under.sky = sky;
    sky.muted = () => game.sfx.muted;
    const dive = new Skydive(game.natureRoot as unknown as THREE.Scene);
    game.dive = dive;
    dive.say = (t) => game.hud.message(t);
    dive.wind = (v) => game.sfx.setWind(v);
    dive.onChute = () => game.sfx.boing(0.25);
    sky.skydiving = () => dive.active;
    sky.onDoorOpen = () => { game.sfx.creak(); game.sfx.setWind(0.5); game.hud.message("The door swings open onto the open sky..."); };
    sky.onJump = () => { sky.depart(); dive.start(player, spawn.x, spawn.z, Math.PI); };
    { const e = sites.doorExit(); sky.exitTo = { x: e.x, y: heightAt(e.x, e.z), z: e.z, yaw: e.yaw }; }
    // the airstrip island (through the secret room's west door): cars, balloons and the spiral tower
    const air = new Airstrip(game.natureRoot as unknown as THREE.Scene, q.shadows, q.name === "low" ? 0 : 1);
    game.under.air = air;
    air.sfx = { engine: (v) => game.sfx.engine(v), boing: (v) => game.sfx.boing(v), crash: (v) => game.sfx.crash(v) };
    const carCam = new THREE.PerspectiveCamera();
    // the cat house (the paw-print door): everyone who goes through it is a cat
    const camProxy = { set near(v: number) { camera.minZ = v; }, get near() { return camera.minZ; }, updateProjectionMatrix() { /* (Babylon reads minZ every frame) */ } };
    const cat = new CatHome(game.natureRoot as unknown as THREE.Scene, q.shadows, camProxy as unknown as THREE.PerspectiveCamera);
    game.under.cat = cat;
    // the cat's own paws in front of the camera: a three.js rig that follows the Babylon camera, drawn by its own mirror
    const pawHolder = new THREE.Scene(), pawRig = new THREE.Group();
    pawRig.matrixAutoUpdate = false;
    pawHolder.add(pawRig);
    let paws = new FPPaws(PLAYER_COATS[0], q.shadows);
    pawRig.add(paws.root);
    const pawMirror = new ThreeMirror(scene, pawHolder, null, false, { tag: { keepUnderground: true } });
    const catMode = (on: boolean) => {
        pawRig.remove(paws.root);
        paws = new FPPaws(PLAYER_COATS[game.netId % PLAYER_COATS.length], q.shadows);
        pawRig.add(paws.root);
        paws.root.visible = on && !vrActive();
    };
    game.under.onCat = catMode;
    progress(0.87, "Stocking the shop and the museum…");
    await nextFrame();
    // ---- Banana or Salmon: the narrator and the co-op campaign behind the yellow door in the secret room
    const narrator = new Narrator();
    narrator.ctx = () => game.sfx.context; narrator.duck = (k) => game.sfx.setDuck(k); narrator.muted = () => game.sfx.muted;
    const camp = new Campaign(game.natureRoot as unknown as THREE.Scene, narrator, game.sfx, player); game.under.camp = camp;
    camp.addMission(new Shop(game.natureRoot as unknown as THREE.Scene)); camp.addMission(new Museum(game.natureRoot as unknown as THREE.Scene));
    // the gorilla's own arms ride on the camera, like the cat's paws
    const fpGor = new FPGorilla(); fpGor.root.visible = false; pawRig.add(fpGor.root);
    // the narrator is a mosquito that flies around you (its voice comes from where it is)
    const mozzie = new Mosquito(game.natureRoot as unknown as THREE.Scene);
    mozzie.group.userData.babylonTag = { keepUnderground: true };
    narrator.source = () => (mozzie.group.visible ? mozzie.pos : null);
    mozzie.clamp = (p) => {
        const sp = player.cave as any; if (!sp?.push) return;
        const o = { x: 0, z: 0, nx: 0, nz: 0 };
        sp.push(p.x - sp.ox, p.z - sp.oz, 0.08, p.y - sp.oy, 0.05, o); p.x = o.x + sp.ox; p.z = o.z + sp.oz;
        p.y = Math.max(p.y, sp.floor(p.x, p.z, p.y) + 0.1); p.y = Math.min(p.y, sp.ceiling(p.x, p.z, p.y) - 0.1);
    };
    // the WebAudio listener follows the Babylon camera (through a three.js stand-in)
    const earCam = new THREE.PerspectiveCamera(); earCam.matrixAutoUpdate = false;
    const eyeT = new THREE.Vector3();
    camp.send = (e) => sync?.session.sendEvent(e);
    camp.myId = () => sync?.session.myId ?? 0;
    camp.owner = () => !sync || sync.session.isHost;
    camp.others = () => {
        const out: { id: number; name: string; x: number; y: number; z: number; yaw: number; flags: number; hand: THREE.Vector3 | null }[] = [];
        if (sync) for (const a of sync.avatars.positions) {
            const st = sync.session.states.get(a.id); if (!st) continue;
            const r = st.v && st.v.r ? st.v.r : null;
            out.push({ id: a.id, name: a.name, x: a.x, y: a.y, z: a.z, yaw: st.yaw, flags: st.flags, hand: r ? new THREE.Vector3(a.x + r[0], a.y + r[1], a.z + r[2]) : null });
        }
        return out;
    };
    camp.say = (t) => game.hud.message(t);
    camp.fade = (on, text) => game.hud.fade(on, text ?? "");
    camp.haptic = (v) => game.vr.haptic?.(v);
    camp.inVR = () => vrActive();
    camp.carryAt = (out) => {
        if (vrMode?.handPos(out)) return;
        const d = player.look, dy = Math.max(-0.4, Math.min(0.4, d.y));
        if (camp.species === "c") out.set(player.pos.x + d.x * 0.3, player.pos.y + 0.05, player.pos.z + d.z * 0.3);
        else out.set(player.eye.x + d.x * 0.85, player.eye.y - 0.55 + dy * 0.5, player.eye.z + d.z * 0.85);
    };
    camp.onEmote = () => { game.swings++; if (camp.species === "c") paws.swing(); };
    camp.onBeat = () => fpGor.thump();
    camp.onBody = (sp) => {
        player.body = sp === "g" ? GORILLA : sp === "c" ? CAT : HUMAN; player.climbing = false;
        camera.minZ = sp === "c" ? 0.04 : 0.1;
        catMode(sp === "c");
        fpGor.root.visible = sp === "g" && !vrActive();
        vrMode?.setGorilla(sp === "g");
    };
    progress(0.89, "Tuning the monitors…");
    await nextFrame();
    // Locations, Locations: the monitor room (the levels themselves come with the baked map data)
    const locs = new LocationsRoom(game.natureRoot as unknown as THREE.Scene); game.under.locs = locs;
    locs.say = (t) => game.hud.message(t);
    game.under.onLocs = () => narrator.say("loc_choose", { interrupt: true });
    // each real place is built the first time somebody goes there; while you are in one the island is switched off
    const towns = LOCATIONS.map((l, i) => (l.status === "ready" ? new Town(game.natureRoot as unknown as THREE.Scene, l, i, q.shadows, q.name === "low") : null));
    for (const t of towns) if (t) { t.group.userData.babylonTag = { town: true }; t.sfx = { chirp: (v) => game.sfx.chirp(v), cricket: (v) => game.sfx.cricket(v), setHum: (v) => game.sfx.setHum(v) }; }
    locs.onVisit = (_l, i) => {
        const t = towns[i]; if (!t) return;
        narrator.stop(); game.hud.fade(true, LOCATIONS[i].name);
        setTimeout(() => { locs.leave(player); t.enter(player); game.under.town = t; caves.hideWorld(true); game.hud.fade(false); game.sfx.creak(); }, 450);
    };
    game.under.onTownExit = () => {
        const t = game.under.town; if (!t) return;
        t.leave(player); game.under.town = null; caves.hideWorld(false); locs.enter(player, t.index);
    };
    /** which special place a player is in, from their state flags ('' = none of these) */
    const placeOf = (f: number) => (f & 131072 ? `L${(f >> 18) & 15}` : f & 65536 ? "R" : "");
    /** a campaign cat (not the cat house) */
    const campCat = () => camp.active && (camp.flags & 32768) !== 0;
    let mouseSend = 0;
    // Hideaway Isle (hide and seek, the green door) and the Chamber of Tiles (the copper door)
    const hide = new HideIsle(game.natureRoot as unknown as THREE.Scene, q.shadows);
    game.under.hide = hide;
    hide.say = (t) => game.hud.message(t);
    hide.myId = () => sync?.session.myId ?? 0;
    hide.send = (e) => sync?.session.sendEvent(e);
    hide.others = () => {
        const out: { id: number; name: string; x: number; y: number; z: number; flags: number }[] = [];
        if (sync) for (const a of sync.avatars.positions) { const st = sync.session.states.get(a.id); if (st) out.push({ id: a.id, name: a.name, x: a.x, y: a.y, z: a.z, flags: st.flags }); }
        return out;
    };
    const trial = new TileTrial(game.natureRoot as unknown as THREE.Scene);
    game.under.trial = trial;
    trial.say = (t) => game.hud.message(t);
    trial.myId = () => sync?.session.myId ?? 0;
    trial.myName = () => sync?.session.name || "You";
    trial.send = (e) => sync?.session.sendEvent(e);
    trial.others = () => hide.others();
    trial.die = () => { game.stats.hurt(9999, "fall"); if (game.stats.dead) { game.stats.deathCause = "You fell into the pit."; return true; } return false; };
    trial.sfx = { tick: (f: boolean) => game.sfx.tileTick(f), go: () => game.sfx.tileGo(), seal: () => game.sfx.tileSeal(), drop: () => game.sfx.tileDrop(), fall: () => game.sfx.tileFall(), win: () => game.sfx.tileWin(), lose: () => game.sfx.tileLose(), press: () => game.sfx.tilePress(), crack: () => game.sfx.tileCrack() };
    cat.onSqueak = () => game.sfx.meow(0.35);
    cat.onCatch = () => { game.hud.message(`You caught the mouse! (${cat.caught})`); sync?.session.sendEvent({ k: "mc", n: sync.session.name }); };
    cat.onBonk = (id) => {
        game.sfx.meow(0.35); game.vr.haptic?.(0.7);
        if (id !== null && id !== (sync?.session.myId ?? 0)) sync?.session.sendEvent({ k: "mh", t: id, n: sync.session.name });
        else game.hud.message("Bonk!");
    };
    game.onPounce = () => paws.swing();
    game.onMeow = () => { sync?.session.sendEvent({ k: "mw", x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1) }); };
    progress(0.9, "Waking the cats…");
    await nextFrame();
    // the island's cats
    const cats = params.has("nocats") ? null : new Cats(game.natureRoot, vegetation.colliders, q.shadows, () => game.fauna.animals);
    if (cats) {
        cats.onMeow = (v) => game.sfx.meow(v);
        cats.beds = () => game.structures.list.filter((s) => s.kind === "cat_bed");
    }
    // showers and storms
    const weather = new Weather(scene, q.name, clock, ocean);
    game.weather = weather;
    weather.onLightning = (d) => { setTimeout(() => game.sfx.thunder(d), (d / 343) * 1000); };
    if (params.has("weather")) {
        const k = ["clear", "rain", "storm"].indexOf(params.get("weather")!) as 0 | 1 | 2;
        if (k >= 0) {
            weather.set(k, 1e6);
            if (params.has("instant")) { weather.overcast = [0, 0.72, 1][k]; weather.rain = [0, 0.55, 1][k]; weather.wind = [1, 1.9, 4.2][k]; weather.rough = [0, 0.25, 1][k]; weather.wet = k ? 1 : 0; weather.apply(); }
        }
    }
    game.building.onTerrain = (x0, z0, x1, z1) => {
        terrain.refresh(x0, z0, x1, z1);
        vegetation.reseat(x0, z0, x1, z1);
        game.resources.pickups.reseat(x0, z0, x1, z1, game.building.ground);
        game.structures.reseat(x0, z0, x1, z1, game.building.ground);
        vegetation.update(player.pos.x, player.pos.z, true);
    };
    for (const p of game.building.pieces) if (p.cut) { const b = cutBounds(p.cut); terrain.refresh(b.x0, b.z0, b.x1, b.z1); }
    vegetation.update(spawn.x, spawn.z, true);

    // ---- shadows follow the set of casters (trees felled, pieces built)
    let casterCount = -1;
    const syncCasters = () => {
        if (!q.shadows || casterCount === shadowCasters.size) return;
        casterCount = shadowCasters.size;
        const list = shadows.getShadowMap()!.renderList!;
        list.length = 0;
        for (const m of shadowCasters) list.push(m as Mesh);
    };

    // ---- the sea mirrors the island, the trees, the clouds, the moon and the stars (medium and high quality; off in a headset)
    const seaRefl = q.name === "low" ? null : ocean.enableReflection(q.name === "high" ? 0.5 : 0.35, q.name === "high" ? 1 : 2, (m) => {
        const n = m.name;
        if (n === "grass" || n.startsWith("sea_") || n === "seaShafts" || n === "seaSnow" || n === "rain" || n === "fallsPool" || n === "falls") return false;
        const md = m.metadata as { viewModel?: boolean; mirrorSelf?: boolean } | null;
        return !md?.viewModel && !md?.mirrorSelf;
    });
    let seaReflOn = !!seaRefl;
    // ---- post processing (flat screens; the headset gets a lighter chain)
    const pipeline = new DefaultRenderingPipeline("castawayPipeline", true, scene, [camera]);
    pipeline.samples = q.name === "low" ? 1 : 4;
    pipeline.fxaaEnabled = q.name === "low";
    pipeline.bloomEnabled = q.name !== "low";
    pipeline.bloomThreshold = 0.9;
    pipeline.bloomWeight = 0.25;
    pipeline.bloomKernel = 64;
    pipeline.sharpenEnabled = q.name === "high";
    if (pipeline.sharpenEnabled) pipeline.sharpen.edgeAmount = 0.2;
    pipeline.imageProcessing.vignetteEnabled = true;
    pipeline.imageProcessing.vignetteWeight = 1.4;
    if (q.name === "high" && !params.has("nossao")) {
        const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera]);
        ssao.radius = 1.6;
        ssao.totalStrength = 1.0;
        ssao.samples = 16;
        ssao.maxZ = 120;
    }

    progress(0.91, "Looking for a headset…");
    await nextFrame();
    // ---- VR
    let xr: WebXRDefaultExperience | null = null;
    let vrMode: import("./vr/vr").CastawayVR | null = null;
    const vrActive = () => !!vrMode?.active;
    if (navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr").catch(() => false))) {
        try {
            xr = await scene.createDefaultXRExperienceAsync({ disableDefaultUI: true, disableTeleportation: true, optionalFeatures: true });
            const { CastawayVR } = await import("./vr/vr");
            vrMode = new CastawayVR(scene, xr, game, player, input, pipeline);
            $("play-vr").classList.remove("hidden");
        } catch (e) {
            console.warn("VR unavailable", e);
        }
    }

    /** draws your reflection in the sky room's mirror (the room's avatars when in a room, a private set when solo) */
    let mirrorAv: Avatars | null = null;
    // ---- frame loop
    let last = performance.now();
    scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (started) {
            input.poll();
            if (input.timeDelta) { clock.addHours(input.timeDelta); input.timeDelta = 0; }
            clock.update(dt);
            vrMode?.beforePlayer(dt);
            game.preUpdate();
            // the airstrip: keep people from being stranded there, then drive the cars
            if (!air.active && air.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (air.active && !air.contains(player.pos.x, player.pos.z)) { air.leave(player); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            if (!cat.active && cat.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (cat.active && !cat.contains(player.pos.x, player.pos.z)) { cat.leave(player, HUMAN); catMode(false); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            if (!hide.active && hide.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (hide.active && !hide.contains(player.pos.x, player.pos.z)) { hide.leave(player); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            if (!trial.active && trial.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (trial.active && !trial.contains(player.pos.x, player.pos.z)) { trial.leave(player); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            if (!camp.active && camp.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (camp.active && !camp.contains(player.pos.x, player.pos.z)) { camp.leave(); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            for (const t of towns) {
                if (!t) continue;
                if (!t.active && t.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
                if (t.active && !t.contains(player.pos.x, player.pos.z)) { t.leave(player); if (game.under.town === t) game.under.town = null; caves.hideWorld(false); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            }
            if (!locs.active && locs.contains(player.pos.x, player.pos.z) && sky.exitTo) { const e = sky.exitTo; player.teleport(e.x, e.y, e.z, e.yaw); }
            if (locs.active && !locs.contains(player.pos.x, player.pos.z)) { locs.leave(player); player.teleport(player.pos.x, heightAt(player.pos.x, player.pos.z), player.pos.z, player.yaw); }
            if (air.driving && game.stats.dead) air.exitCar(player);
            if (air.active) air.pre(dt, { gas: Math.max(-1, Math.min(1, input.move.y)), steer: Math.max(-1, Math.min(1, input.move.x)), hand: input.jumpHeld, boost: input.wantsSprint }, player, vrActive());
            if (!game.uiBlocking) player.update(dt, input);
            else input.consumeLook();
            vrMode?.afterPlayer(dt);
            if (air.driving && !vrActive()) {
                // the third-person chase camera behind the car
                air.post(dt, carCam, player);
                camera.position.set(carCam.position.x, carCam.position.y, carCam.position.z);
                camera.rotationQuaternion = new Quaternion(carCam.quaternion.x, carCam.quaternion.y, carCam.quaternion.z, carCam.quaternion.w);
            } else if (!vrActive()) {
                camera.rotationQuaternion = null;
                camera.position.set(player.eye.x, player.eye.y + player.shakeY, player.eye.z);
                camera.rotation.set(player.pitch + player.shakeRot.x, player.yaw + player.shakeRot.y, player.shakeRot.z);
                const cp = Math.cos(player.pitch);
                player.look.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
            }
            game.update(dt, true);
            game.under.sites?.update(dt);
            hide.update(dt, player, now / 1000);
            if (sync) sync.avatars.three.labelsOff = hide.active;
            game.sfx.setDeaf(hide.deaf);
            trial.update(dt, player, now / 1000);
            camp.update(dt, now / 1000);
            locs.update(dt);
            game.under.town?.update(dt, now / 1000, clock.sunDir.y, player);
            if (sync) { const mine = placeOf((locs.active ? 65536 : 0) | (game.under.town?.active ? 131072 | (game.under.town.index << 18) : 0)); sync.avatars.three.hideIf = (f) => { if ((f & F_LEVEL) !== 0) return true; const p = placeOf(f); return p !== mine && (p !== "" || mine !== ""); }; }
            mozzie.group.visible = camp.active || locs.active;
            narrator.update(dt);
            {
                const ctx = game.sfx.context;
                earCam.matrix.fromArray(camera.getWorldMatrix().m as unknown as number[]); earCam.matrixWorldNeedsUpdate = true;
                if (ctx && mozzie.group.visible) setListener(ctx, earCam);
                eyeT.set(player.eye.x, player.eye.y, player.eye.z);
                mozzie.update(dt, eyeT, player.yaw, narrator.narrating, camp.species === "c" && camp.where !== "choice", ctx, game.sfx.muted || !narrator.voiceOn);
            }
            fpGor.root.visible = camp.active && camp.species === "g" && camp.where !== "choice" && !vrActive();
            if (fpGor.root.visible) fpGor.update(dt, Math.hypot(player.vel.x, player.vel.z));
            if (cats && !game.under.active) cats.update(dt, player.pos.x, player.pos.z, player.pos.y);
            dive.update(dt, player, input.move, game.stats.dead);
            const sy = sync;
            if (sy) dive.updateRemote(sy.avatars.positions.map((a) => { const st = sy.session.states.get(a.id); return { id: a.id, x: a.x, y: a.y, z: a.z, yaw: st?.yaw ?? 0, flags: st?.flags ?? 0 }; }));
            sky.update(dt, player, (x, z) => heightAt(x, z));
            // the secret room's mirror: you (a private copy only the mirror draws) and everybody else in it
            if (sky.active || mirrorAv) {
                mirrorAv ??= sync?.avatars ?? new Avatars(scene, false);
                const held = game.equipped;
                mirrorAv.mirrorSelf(sky.active, { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, spd: Math.hypot(player.vel.x, player.vel.z), item: held ? held.id : "", swing: game.swings, flags: (player.sprinting ? 1 : 0) | (game.isSleeping ? 8 : 0), hp: game.stats.health, arm: game.armorCode }, sync?.session.myId ?? 0, dt, sync?.session.players.get(sync.session.myId)?.name);
            }
            {
                // the cat house: the host keeps the mouse and the ball going; everybody in it simulates the same toys
                const host = !sync || sync.session.isHost;
                if (cat.active || (host && sync)) {
                    const list: { id: number; x: number; z: number; y: number }[] = [];
                    if (cat.active) list.push({ id: sync?.session.myId ?? 0, x: player.pos.x, y: player.pos.y, z: player.pos.z });
                    if (sync) for (const a of sync.avatars.positions) { const st = sync.session.states.get(a.id); if (st && (st.flags & 16)) list.push({ id: a.id, x: a.x, y: a.y, z: a.z }); }
                    cat.update(dt, list, host);
                    // the mouse in my paws (or flying after a throw): tell the others where it is
                    mouseSend -= dt;
                    if (sync && (cat.landed || (cat.mouseMine && mouseSend <= 0))) { sync.session.sendEvent({ k: "mt", r: cat.exportThrow() }); mouseSend = 0.08; }
                    cat.landed = false;
                }
                const wantCat = cat.active || campCat();
                if (vrMode && vrMode.catOn !== wantCat) vrMode.setCat(wantCat, PLAYER_COATS[game.netId % PLAYER_COATS.length]);
                cat.ghost = cat.active && player.climbing;
                paws.root.visible = (cat.active || campCat()) && !vrActive();
                if (cat.active || campCat()) paws.update(dt, Math.hypot(player.vel.x, player.vel.z), player.vel.y, player.sprinting);
            }
            waterfall?.update(dt, player.pos.x, player.pos.z, game.under.active);
            {
                const onIsland = !game.under.active && Math.abs(player.pos.x) < 600 && Math.abs(player.pos.z) < 600 && player.pos.y < 120;
                seabed.update(dt, player.pos.x, player.pos.z, camera.position, player.underwater, onIsland && (player.underwater || heightAt(player.pos.x, player.pos.z) < 8));
            }
            dolphins.update(dt, player.pos.x, player.pos.z, player.yaw, game.under.active);
            ocean.bio = BIO.value;
            if (seaRefl) {
                // (paused, not drawn at all, where the sea cannot be seen: in a headset, underground, out in the far places)
                const want = !vrActive() && !game.under.active && Math.abs(player.pos.x) < 2000 && Math.abs(player.pos.z) < 2000;
                if (want !== seaReflOn) {
                    seaReflOn = want; ocean.reflectOn = want;
                    const list = scene.customRenderTargets, i = list.indexOf(seaRefl);
                    if (want && i < 0) list.push(seaRefl); else if (!want && i >= 0) list.splice(i, 1);
                }
            }
            clock.curse = game.druids.curse;
            // waking up on the beach after the wreck: the world swims into focus
            canvas.style.filter = (camp.nightVision && !vrActive() ? "brightness(1.45) contrast(1.08) saturate(0.6) sepia(0.25) hue-rotate(55deg)" : "") + (game.eyeBlur > 0.05 ? ` blur(${game.eyeBlur.toFixed(1)}px)` : "");
            Wind.push[0].set(player.pos.x, player.pos.y, player.pos.z, 0.9);
        } else {
            // the menu: a slow look along the beach
            const t = now / 1000;
            camera.position.set(spawn.x, heightAt(spawn.x, spawn.z) + 2.2, spawn.z);
            camera.rotation.set(-0.05, spawn.yaw + Math.sin(t * 0.05) * 0.6, 0);
        }
        caves.update();
        // the paws ride on the camera
        pawRig.matrix.fromArray(camera.getWorldMatrix().m as unknown as number[]);
        pawRig.matrixWorldNeedsUpdate = true;
        pawMirror.sync();
        vegetation.update(player.pos.x, player.pos.z);
        syncCasters();
    });
    engine.runRenderLoop(() => scene.render());

    // ---- shaders: the first frames compile hundreds of them (a long freeze with nothing on screen): it happens here instead,
    //      behind the loading bar, while the render loop draws under it and the bar follows how many meshes are ready
    {
        const t0 = performance.now();
        for (;;) {
            const ms = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.subMeshes?.length && m.material);
            const ok = ms.filter((m) => m.isReady(true)).length;
            progress(0.92 + 0.08 * (ok / Math.max(1, ms.length)), `Preparing the island… ${Math.round((100 * ok) / Math.max(1, ms.length))}%`);
            if (ok >= ms.length * 0.995 || performance.now() - t0 > 45000) break;
            await new Promise((r) => setTimeout(r, 100));
        }
        progress(1, "Ready");
    }

    // ---- saving: the world belongs to the host (or the solo player); each player's character is saved per world
    let wid = newWorldId();
    let sync: WorldSync | null = null;
    let noSave = false;
    const nameEl = $<HTMLInputElement>("mp-name");
    const myName = () => { const n = nameEl.value.trim().slice(0, 14) || `Castaway ${Math.floor(10 + Math.random() * 90)}`; setPref("name", nameEl.value.trim()); return n; };
    const charId = () => (sync && !sync.session.isHost ? guestKey(wid, myName()) : wid);
    /** your look changed (customise screen): the first-person hands and everybody else in the room */
    const applyOutfit = () => {
        const o = getOutfit();
        setViewSkin(SKINS[o[2]]);
        if (!sync) { setPlayerOutfit(0, o); return; }
        const id = sync.session.myId, me = sync.session.players.get(id);
        setPlayerOutfit(id, o);
        if (me) me.look = o;
        sync.session.sendEvent({ k: "lk", l: o });
    };
    onOutfitChange(applyOutfit);
    applyOutfit();
    const doSave = () => {
        if (!started || game.stats.dead || noSave) return;
        if (!sync || sync.session.isHost) saveWorld({ v: 1, layout: LAYOUT, wid, hour: clock.hour, world: captureWorld(game), savedAt: Date.now() });
        saveChar(charId(), captureChar(game));
    };
    setInterval(doSave, 30000);
    window.addEventListener("pagehide", doSave);
    document.addEventListener("visibilitychange", () => { if (document.hidden) doSave(); });
    const freshChar = () => { game.stats.reset(); game.inv.clear(); game.worn.clear(); game.inv.add("rock", 1); game.setBedByNid(null); game.hud.select(0); };
    const loadSaved = (): boolean => {
        if (!saved) return false;
        try {
            wid = saved.wid;
            clock.hour = saved.hour;
            applyWorld(game, migrateWorld(saved));
            const ch = loadChar(wid);
            if (ch) applyChar(game, ch);
            return true;
        } catch (e) {
            // a damaged save must never lock the player out: keep a copy, then start fresh
            console.error("Could not load the saved island", e);
            try { localStorage.setItem("castaway.bjs.broken", JSON.stringify(saved)); } catch { /* full */ }
            eraseSaves();
            location.reload();
            return false;
        }
    };

    // ---- menus
    $("loading").classList.add("hidden");
    document.body.classList.remove("prestart");
    const contBtn = $("continue"), playBtn = $("play");
    let armed = 0;
    const begin = () => {
        started = true;
        setNameLocked(true);
        input.enabled = true;
        game.sfx.init();
        $("menu").classList.add("hidden");
        $("ready").classList.add("hidden");
        $("hud").classList.remove("hidden");
        if (!vrActive()) input.requestLock();
        if (input.touch && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    };
    const inGameMenu = () => {
        contBtn.classList.remove("hidden");
        contBtn.textContent = "Resume";
        $("quit-menu").classList.remove("hidden");
        if (armed < Date.now()) playBtn.textContent = "New island";
    };
    if (saved) {
        contBtn.classList.remove("hidden");
        contBtn.textContent = `Continue · ${new Date(saved.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
        playBtn.textContent = "New island";
    }
    contBtn.addEventListener("click", () => {
        if (started) { begin(); return; }
        if (loadSaved()) begin();
    });
    playBtn.addEventListener("click", () => {
        if (started || saved) {
            // starting over: confirm with a second press, then wipe the saves
            if (Date.now() > armed) {
                armed = Date.now() + 4000;
                playBtn.textContent = started ? "Tap again: erase this island" : "Tap again: erase saved island";
                setTimeout(() => { if (Date.now() >= armed) playBtn.textContent = "New island"; }, 4100);
                return;
            }
            noSave = true;
            eraseSaves();
            if (started) { location.reload(); return; }
            noSave = false;
        }
        begin();
    });
    // the island is built: one more click starts it (pointer lock, fullscreen, audio and VR all need a click)
    const ready = (wantVR: boolean, text = "Your island is ready.") => {
        if (params.has("go")) { begin(); return; }
        $("ready-text").textContent = text;
        $("ready-vr").classList.toggle("hidden", !(wantVR && vrMode));
        $("ready-play").textContent = wantVR && vrMode ? "Play on this screen" : "Play";
        $("menu").classList.add("hidden");
        $("ready").classList.remove("hidden");
    };
    $("ready-play").addEventListener("click", () => begin());
    $("ready-vr").addEventListener("click", async () => { begin(); await vrMode?.enter(); });
    $("play-vr").addEventListener("click", async () => {
        if (!started && saved) loadSaved();
        begin();
        try { await vrMode?.enter(); } catch (e) { game.hud.message(`Could not start VR: ${(e as Error)?.message ?? e}`); }
    });
    $("btn-menu")?.addEventListener("click", () => {
        inGameMenu();
        input.enabled = false;
        $("menu").classList.remove("hidden");
        $("hud").classList.add("hidden");
        if (document.pointerLockElement) document.exitPointerLock();
    });
    $("quit-menu").addEventListener("click", () => {
        doSave();
        noSave = true;
        try { sync?.session.close(); } catch { /* already gone */ }
        const u = new URL(location.href);
        for (const k of ["join", "go"]) u.searchParams.delete(k);
        location.assign(u.toString());
    });

    // ---- multiplayer
    const netKind: TransportKind = params.get("net") === "local" ? "local" : "peer";
    const codeEl = $<HTMLInputElement>("mp-code"), statusEl = $("mp-status");
    const say = (html: string, err = false) => { statusEl.innerHTML = html; statusEl.classList.toggle("err", err); };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const chat = new Chat((text) => { sync?.sendChat(text); chat.add("You", "#ffffff", text); }, () => sync?.sendPing(game.vr.active ? game.vr.eye : player.eye, game.vr.active ? game.vr.dir : player.look));
    const chip = $("mp-chip");
    const pingDot = (ms?: number) => (ms === undefined ? "#888" : ms < 90 ? "#6fd36f" : ms < 200 ? "#e8c34a" : "#e85d4a");
    const renderChip = () => {
        if (!sync) return;
        const s = sync.session;
        const others = s.others.map((p) => p.name).join(", ");
        const ms = s.isHost ? undefined : s.pings.get(s.myId);
        const dot = ms === undefined ? "" : ` <span style="color:${pingDot(ms)}">●</span> ${ms} ms`;
        chip.innerHTML = `<b>${s.code}</b> · ${s.players.size} player${s.players.size === 1 ? "" : "s"}${dot}${others ? `<br>${esc(others)}` : "<br>tap for players &amp; invite"}`;
    };
    const panel = document.createElement("div");
    panel.id = "mp-players";
    panel.className = "hidden";
    $("hud").appendChild(panel);
    const renderPanel = () => {
        if (!sync || panel.classList.contains("hidden")) return;
        const s = sync.session;
        const rows = [...s.players.values()].map((p) => {
            const ms = p.id === 0 && s.isHost ? 0 : s.pings.get(p.id);
            const you = p.id === s.myId;
            const kick = s.isHost && !you ? `<button data-kick="${p.id}">Kick</button>` : "";
            return `<div class="pl"><i style="background:${playerColor(p.id)}"></i><span>${esc(p.name)}${you ? " (you)" : ""}${p.id === 0 ? " · host" : ""}</span><em style="color:${pingDot(ms)}">${ms === undefined ? "…" : ms + " ms"}</em>${kick}</div>`;
        }).join("");
        panel.innerHTML = `<div class="pt">Room <b>${s.code}</b></div>${rows}<div class="pb"><button data-act="copy">Copy invite link</button><button data-act="leave">Leave</button></div>`;
    };
    const inviteUrl = (code: string) => `${location.origin}${location.pathname}?join=${code}${netKind === "local" ? "&net=local" : ""}`;
    const copyInvite = () => {
        if (!sync) return;
        const code = sync.session.code;
        navigator.clipboard?.writeText(inviteUrl(code)).then(() => game.hud.message("Invite link copied"), () => game.hud.message(`Room code ${code}: tell your friend to choose Join and type it`));
    };
    panel.addEventListener("click", (ev) => {
        const b = (ev.target as HTMLElement).closest("button");
        if (!b || !sync) return;
        ev.stopPropagation();
        if (b.dataset.kick) { sync.session.kick(+b.dataset.kick); renderPanel(); renderChip(); }
        else if (b.dataset.act === "copy") copyInvite();
        else if (b.dataset.act === "leave") leave();
    });
    setInterval(() => { renderPanel(); renderChip(); }, 1000);
    chip.addEventListener("click", () => { if (!sync) return; panel.classList.toggle("hidden"); renderPanel(); });
    const mpIdle = () => {
        chip.classList.add("hidden");
        panel.classList.add("hidden");
        chat.setActive(false);
        $("mp-open").textContent = "Multiplayer";
        $<HTMLButtonElement>("mp-host").disabled = false;
        $<HTMLButtonElement>("mp-join").disabled = false;
    };
    const leave = () => {
        if (!sync) return;
        const s = sync.session, w = sync;
        w.onLost = null;
        s.close();
        w.detach();
        w.avatars.clear();
        sync = null;
        mpIdle();
        game.hud.message("You left the room. You are playing solo now.");
    };
    const attach = (session: Session, snap?: unknown) => {
        if (sync) { sync.detach(); sync.avatars.clear(); }
        sync = new WorldSync(game, session, scene, q.shadows, clock, (x, z) => ocean.surfaceAt(x, z));
        sync.onChat = (name, id, text) => chat.add(name, playerColor(id), text);
        sync.vrPose = () => vrMode?.pose() ?? null;
        sync.onLost = (why, fatal) => { void lostHost(session, why, fatal); };
        if (snap) sync.applySnapshot(snap);
        chip.classList.remove("hidden");
        chat.setActive(true);
        const j = session.onJoin, l = session.onLeave;
        session.onJoin = (p) => { j?.(p); renderChip(); };
        session.onLeave = (p) => { l?.(p); renderChip(); };
        renderChip();
        $("mp-open").textContent = session.isHost ? `Hosting · ${session.code}` : `In room ${session.code}`;
        $<HTMLButtonElement>("mp-host").disabled = true;
        $<HTMLButtonElement>("mp-join").disabled = true;
        return sync;
    };
    /** The host vanished (or we dropped). First try the same room again, then the lowest-numbered remaining player takes over under the same code. */
    const lostHost = async (old: Session, why: string, fatal = false) => {
        mpIdle();
        if (fatal || old.kicked) { game.hud.message(why); sync = null; return; }
        const ids = [...old.players.keys()].filter((i) => i !== 0).sort((a, b) => a - b);
        game.hud.message("Connection lost. Trying to reconnect…");
        for (let i = 0; i < 2; i++) {
            try {
                const { session, snap, hour } = await Session.join(netKind, old.code, old.name, true);
                clock.hour = hour;
                attach(session, snap);
                game.hud.message("Reconnected.");
                return;
            } catch (e) {
                if (/different version|full/i.test((e as Error)?.message ?? "")) break;
                await sleep(800);
            }
        }
        if (ids.length <= 1) { game.hud.message(`${why}. You are playing solo now.`); sync = null; return; }
        if (ids[0] === old.myId) {
            game.hud.message("The host left. You are the new host…");
            for (let i = 0; i < 10; i++) {
                try {
                    attach(await Session.host(netKind, old.name, old.pvp, old.wid, old.code));
                    game.hud.message("You are now hosting. Friends are reconnecting.");
                    return;
                } catch { await sleep(1500); }
            }
        } else {
            game.hud.message("The host left. Reconnecting…");
            await sleep(2200 + Math.random() * 600);
            for (let i = 0; i < 8; i++) {
                try {
                    const { session, snap } = await Session.join(netKind, old.code, old.name);
                    attach(session, snap);
                    game.hud.message("Reconnected.");
                    return;
                } catch { await sleep(1500); }
            }
        }
        game.hud.message("Could not reconnect. You are playing solo now.");
        sync = null;
    };
    const doHost = async (wantVR = false) => {
        const b = $<HTMLButtonElement>("mp-host");
        b.disabled = true;
        say("Opening a room…");
        try {
            if (!started && saved) loadSaved();
            const session = await Session.host(netKind, myName(), $<HTMLInputElement>("mp-pvp").checked, wid);
            attach(session);
            say(`Room code <b>${session.code}</b><br>Friends open this page, tap Multiplayer, and enter it.`);
            if (!started) ready(wantVR, `Room ${session.code} is open. Friends tap Multiplayer and enter this code.`);
            return null;
        } catch (e) {
            const m = `${(e as Error)?.message ?? e}`;
            say(m, true);
            b.disabled = false;
            return m;
        }
    };
    const doJoin = async (raw: string, wantVR = false) => {
        const code = cleanCode(raw);
        if (code.length < 5) { say("Enter the 5-letter room code", true); return "Enter the 5-letter room code"; }
        const b = $<HTMLButtonElement>("mp-join");
        b.disabled = true;
        say("Joining…");
        try {
            const { session, snap, hour } = await Session.join(netKind, code, myName());
            clock.hour = hour;
            wid = session.wid || wid;
            const s = attach(session, snap);
            const ch = loadChar(guestKey(wid, myName()));
            if (ch) applyChar(game, ch);
            else { freshChar(); s.spawnOffset(spawn); }
            say("Connected!");
            if (!started) ready(wantVR, `Connected to room ${session.code}.`);
            return null;
        } catch (e) {
            const m = `${(e as Error)?.message ?? e}`;
            say(m, true);
            b.disabled = false;
            return m;
        }
    };
    if (vrMode) {
        const vm = vrMode;
        vm.panel.menuActions = {
            status: () => (sync ? `${sync.session.isHost ? "Hosting" : "In"} room ${sync.session.code} · ${[...sync.session.players.values()].map((p) => p.name).join(", ")}` : "Playing solo. Host a room and share its code, or type a friend's code and join."),
            host: async () => (sync ? "You are already in a room" : (await doHost()) ?? `Room ${sync!.session.code} is open`),
            join: async (code) => (sync ? "Leave this room first" : (await doJoin(code)) ?? "Connected!"),
            leave: () => leave(),
            save: () => doSave(),
            exitVR: () => void vm.exit(),
            chat: (t) => { if (sync) { sync.sendChat(t); chat.add("You", "#ffffff", t); } else game.hud.message("Host or join a room to chat"); },
            pingAt: (x, z) => { if (sync) sync.pingAt(x, z); else game.hud.message("Pings are for rooms with friends"); },
            players: () => {
                if (!sync) return null;
                const s = sync.session;
                return `Room ${s.code}\n\n` + [...s.players.values()].map((p) => `${p.name}${p.id === s.myId ? " (you)" : ""}${p.id === 0 ? "  · host" : ""}  —  ${Math.round(s.states.get(p.id)?.hp ?? (p.id === s.myId ? game.stats.health : 0))} hp`).join("\n");
            },
        };
    }
    if (vrMode) $("mp-vr-opt").classList.remove("hidden");
    $("mp-host").addEventListener("click", () => void doHost($<HTMLInputElement>("mp-vr").checked));
    $("mp-join").addEventListener("click", () => void doJoin(codeEl.value, $<HTMLInputElement>("mp-vr").checked));
    {
        const turn = (getPref("castaway.turn") ?? "").split("|");
        const [tu, tn, tp] = [$<HTMLInputElement>("mp-turn"), $<HTMLInputElement>("mp-turn-user"), $<HTMLInputElement>("mp-turn-pass")];
        [tu.value, tn.value, tp.value] = [turn[0] ?? "", turn[1] ?? "", turn[2] ?? ""];
        const apply = () => { setTurn({ urls: tu.value.trim(), username: tn.value.trim(), credential: tp.value }); setPref("castaway.turn", [tu.value.trim(), tn.value.trim(), tp.value].join("|")); };
        apply();
        for (const el of [tu, tn, tp]) el.addEventListener("change", apply);
    }
    if (params.get("join") && params.has("auto")) void doJoin(codeEl.value);
    if (params.has("host") && params.has("auto")) void doHost();
    if (params.has("go") && !params.has("auto")) begin();
    // the start button that was pressed in the menu: the island is built now, carry it out
    const vrBox = () => $<HTMLInputElement>("mp-vr").checked;
    switch (startWith) {
        case "continue": if (loadSaved()) ready(false, "Your island is ready."); break;
        case "play": if (saved) eraseSaves(); ready(false); break;
        case "play-vr": if (saved) loadSaved(); ready(true); break;
        case "mp-host": void doHost(vrBox()); break;
        case "mp-join": void doJoin(codeEl.value, vrBox()); break;
    }

    // multiplayer runs every frame (also while a menu is open)
    scene.onAfterRenderObservable.add(() => sync?.update(Math.min(0.05, engine.getDeltaTime() / 1000)));
    // a hidden tab stops rendering: keep the room in step anyway (a host who alt-tabs must not freeze everyone else)
    setInterval(() => { if (document.hidden) sync?.update(0.1); }, 100);

    Object.assign(window as unknown as Record<string, unknown>, { Wind, scene, engine, game, player, sites, caves, heightAt, weather, cats, sky, dive, air, cat, vegetation, terrain, ocean, input, clock, camera, getSync: () => sync, doSave, camp, narrator, mozzie, locs, towns, waterfall, seabed });
}

main().catch((e) => {
    console.error(e);
    const el = document.getElementById("loading-text");
    if (el) el.textContent = `Something went wrong: ${e?.message ?? e}`;
});
