import {
    Color3,
    Color4,
    DefaultRenderingPipeline,
    Engine,
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
import { Dolphins } from "./world/dolphins";
import { SEA } from "./world/waves";
import { getOutfit, onOutfitChange, setPlayerOutfit } from "./net/outfit";
import { SKINS } from "./net/playerModel";
import { setupCustomise, setNameLocked } from "./ui/customise";
import { setViewSkin } from "./game/viewmodel";
import { playerColor } from "./net/avatars";
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
import { cutBounds, findSpawn, heightAt, SPAWN_THETA, TERRAIN_SIZE } from "./world/island";
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

    $("loading").classList.remove("hidden");
    progress(0.05, "Painting the sky…");
    await nextFrame();
    const SUN = sunDirection();
    const { skybox, env } = await createSky(scene, SUN, q.tier);
    const { sun, shadows, sunMesh } = createSun(scene, SUN.clone(), 6.5, q.tier, q.name === "high" ? 90 : 60);
    sun.diffuse = new Color3(1, 0.9, 0.76);
    if (!q.shadows) shadows.getShadowMap()!.refreshRate = 0;
    scene.environmentIntensity = 1;

    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.0;
    ip.contrast = 1.15;

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
    camera.minZ = 0.08;
    camera.maxZ = 1600;
    camera.fov = 1.2;
    scene.activeCamera = camera;

    let started = false;
    const input = new Input(canvas, (locked) => {
        if (locked) { $("menu").classList.add("hidden"); $("hud").classList.remove("hidden"); }
        else if (input.enabled && !game.uiBlocking && !vrActive()) { $("menu").classList.remove("hidden"); $("hud").classList.add("hidden"); input.enabled = false; inGameMenu(); }
    });
    const clock = new Atmosphere(scene, sun, skybox, env, ocean, sunMesh);
    if (params.has("hour")) clock.hour = parseFloat(params.get("hour")!);
    const game = new Game({ scene, camera, player, vegetation, input, spawn, springSpots, shadows: q.shadows, clock });
    // ruined huts and shipwrecks with chests, and the caves under the island
    const sites = new SurfaceSites(game.ugRoot as unknown as THREE.Scene, sitePlan, vegetation.colliders, q.shadows);
    game.under.sites = sites;
    const caves = new CaveView(scene, game, clock, q.shadows);
    // the sea's own surface for things far out (whales, ships, dolphins)
    SEA.surface = (x, z) => ocean.surfaceAt(x, z);
    const dolphins = new Dolphins(game.natureRoot, (x, z) => ocean.surfaceAt(x, z));
    if (params.has("nodolphins")) dolphins.enabled = false;
    if (params.has("dolphintest")) { dolphins.wait = 1; dolphins.rate = 0.08; }
    // the secret room behind the odd door in the hut, and the skydive from its cloud door
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
            if (cats && !game.under.active) cats.update(dt, player.pos.x, player.pos.z, player.pos.y);
            dive.update(dt, player, input.move, game.stats.dead);
            const sy = sync;
            if (sy) dive.updateRemote(sy.avatars.positions.map((a) => { const st = sy.session.states.get(a.id); return { id: a.id, x: a.x, y: a.y, z: a.z, yaw: st?.yaw ?? 0, flags: st?.flags ?? 0 }; }));
            sky.update(dt, player, (x, z) => heightAt(x, z));
            dolphins.update(dt, player.pos.x, player.pos.z, player.yaw, game.under.active);
            ocean.bio = BIO.value;
            clock.curse = game.druids.curse;
            // waking up on the beach after the wreck: the world swims into focus
            canvas.style.filter = game.eyeBlur > 0.05 ? `blur(${game.eyeBlur.toFixed(1)}px)` : "";
            Wind.push[0].set(player.pos.x, player.pos.y, player.pos.z, 0.9);
        } else {
            // the menu: a slow look along the beach
            const t = now / 1000;
            camera.position.set(spawn.x, heightAt(spawn.x, spawn.z) + 2.2, spawn.z);
            camera.rotation.set(-0.05, spawn.yaw + Math.sin(t * 0.05) * 0.6, 0);
        }
        caves.update();
        vegetation.update(player.pos.x, player.pos.z);
        syncCasters();
    });
    engine.runRenderLoop(() => scene.render());

    // ---- saving: the world belongs to the host (or the solo player); each player's character is saved per world
    const saved = loadWorld();
    let wid = newWorldId();
    let sync: WorldSync | null = null;
    let noSave = false;
    const nameEl = $<HTMLInputElement>("mp-name");
    nameEl.value = getPref("name") ?? "";
    const myName = () => { const n = nameEl.value.trim().slice(0, 14) || `Castaway ${Math.floor(10 + Math.random() * 90)}`; setPref("name", nameEl.value.trim()); return n; };
    const charId = () => (sync && !sync.session.isHost ? guestKey(wid, myName()) : wid);
    setupCustomise();
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
    $("menu").classList.remove("hidden");
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
        };
    }
    $("mp-open").addEventListener("click", () => $("mp-panel").classList.toggle("hidden"));
    const tab = (host: boolean) => {
        $("mp-tab-host").classList.toggle("on", host);
        $("mp-tab-join").classList.toggle("on", !host);
        $("mp-pane-host").classList.toggle("hidden", !host);
        $("mp-pane-join").classList.toggle("hidden", host);
    };
    $("mp-tab-host").addEventListener("click", () => tab(true));
    $("mp-tab-join").addEventListener("click", () => tab(false));
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
    // an invite link: ?join=CODE opens the join tab with the code filled in
    const inv = params.get("join");
    if (inv) {
        $("mp-panel").classList.remove("hidden");
        tab(false);
        codeEl.value = cleanCode(inv);
        if (params.has("auto")) void doJoin(codeEl.value);
    }
    if (params.has("host") && params.has("auto")) void doHost();
    if (params.has("go") && !params.has("auto")) begin();

    // multiplayer runs every frame (also while a menu is open)
    scene.onAfterRenderObservable.add(() => sync?.update(Math.min(0.05, engine.getDeltaTime() / 1000)));
    // a hidden tab stops rendering: keep the room in step anyway (a host who alt-tabs must not freeze everyone else)
    setInterval(() => { if (document.hidden) sync?.update(0.1); }, 100);

    Object.assign(window as unknown as Record<string, unknown>, { Wind, scene, engine, game, player, sites, caves, heightAt, weather, cats, sky, dive, air, vegetation, terrain, ocean, input, clock, camera, getSync: () => sync, doSave });
}

main().catch((e) => {
    console.error(e);
    const el = document.getElementById("loading-text");
    if (el) el.textContent = `Something went wrong: ${e?.message ?? e}`;
});
