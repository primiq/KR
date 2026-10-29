import { type Node, type Scene, Vector3 } from "@babylonjs/core";
import type { Input } from "../core/input";
import { clamp } from "../core/noise";
import { Hud } from "../ui/hud";
import { heightAt } from "../world/island";
import type { Player } from "../world/player";
import type { Vegetation, Zone } from "../world/vegetation";
import { Sfx } from "./audio";
import { BuildingSystem, PIECE_INFO, PIECES, type Piece, STONE_COST } from "./building";
import { Inventory } from "./inventory";
import { ARMOR_SLOTS, type GatherKind, GATHER_ITEM, GATHER_LABEL, ITEMS, type ItemId, type PlaceKind } from "./items";
import { BENCH_REACH, COAL_BURN, MAX_FUEL, type Recipe, craft } from "./recipes";
import { type HitFx, Resources, type Target } from "./resources";
import { Stats } from "./survival";
import { type PlaceAim, STRUCT_NAME, type Structure, StructureManager } from "./structures";
import { ViewModel } from "./viewmodel";
import { Fishing } from "./fishing";
import { type Animal, Fauna, type FaunaTarget } from "./fauna";
import * as THREE from "three";
import { ThreeMirror } from "../render/mirror";
import { PBRMaterial, Color3 } from "@babylonjs/core";
import { MapView, type MapMarkers } from "../ui/map";
import { Underground, type UgTarget } from "./underground";
import { Birds, Flamingos, Footprints, type Walker } from "./nature";
import { Turtles } from "./turtles";
import { Saplings } from "./saplings";
import { Stalkers } from "./stalker";
import { Offshore } from "../world/offshore";
import { Druids } from "../world/druids";
import { druidMaterial } from "../world/druidView";
import { Warp } from "../world/warp";
import { Invaders } from "../world/invaders";
import { CHORDS, Guitar } from "./guitar";
import { Slide } from "../world/slide";
import { type Boat, Boats } from "../world/boat";
import { skyMirrorMaterial } from "../world/skyView";
import type { Skydive } from "../world/skydive";
import { Twins } from "./twins";
import { type Door, Doors } from "./doors";
import { type FrameAim, type Painting, Paintings } from "./paintings";
import { Painter } from "../ui/painter";
import type { Weather } from "../world/weather";
import { FISH_WIGGLE, SeaLife } from "../world/sealife";
import { fishMaterial, glassMaterial, woodMaterials } from "../render/materials";
import { Flowers } from "../world/flowers";
import { isProbablyHeadset } from "../../config";
import { FLOWERS } from "../world/flowerKinds";

export interface GameOpts {
    scene: Scene;
    /** the node the first-person hands hang from (the flat-screen camera) */
    camera: Node;
    player: Player;
    vegetation: Vegetation;
    input: Input;
    spawn: { x: number; z: number; yaw: number };
    springSpots: Zone[];
    shadows: boolean;
    /** day / night: the hour now (0..24) and a way to set it (sleeping) */
    clock: { hour: number; day?: number; dawn?: number };
}

const HOLD_TIME = 0.9;
const STEP = Math.PI / 8;

/** Survival gameplay, ported from Castaway: gathering, crafting, building, stations, eating, drinking, inventory, death. */
export class Game {
    readonly inv = new Inventory();
    readonly stats = new Stats();
    readonly sfx = new Sfx();
    readonly hud: Hud;
    readonly resources: Resources;
    readonly view: ViewModel;
    readonly structures: StructureManager;
    readonly building: BuildingSystem;
    readonly player: Player;
    /** armor worn: head, chest, legs */
    readonly worn = new Inventory(3, 0);
    readonly fishing: Fishing;
    readonly fauna: Fauna;
    /** the caves (and the chests in the huts and wrecks on the surface); three.js graphs under `ugRoot`, drawn by main */
    readonly under: Underground;
    readonly ugRoot = new THREE.Group();
    /** footprints in the sand, birds, flamingos and nesting turtles (three.js, drawn by natureMirror) */
    readonly prints = new Footprints();
    readonly birds: Birds;
    readonly flamingos = new Flamingos();
    readonly turtles: Turtles;
    /** three.js things drawn by natureMirror (main adds the island cats here too) */
    readonly natureRoot = new THREE.Scene();
    /** wild flowers to pick, and the ones people plant */
    readonly flowers: Flowers;
    private natureMirror: ThreeMirror;
    private walkers: Walker[] = [];
    /** saplings people plant, growing into trees */
    readonly saplings: Saplings;
    /** night things: the Stalker in the trees, and the twins on the beach */
    readonly stalkers: Stalkers;
    readonly twins: Twins;
    /** whales and passing ships far out at sea (the host decides when) */
    readonly offshore: Offshore;
    /** the stone circle on the hilltop, and Mario */
    readonly druids: Druids;
    /** Mario's warp pipe and the secret level */
    readonly warp: Warp;
    private pipeHinted = false;
    /** the blue stones' call: the alien invasion, fought from laser cannons round the circle */
    readonly invaders: Invaders;
    private ivEye = new THREE.Vector3();
    /** the guitar: a click strums the chord (R changes it); in VR the strings are real */
    readonly guitar: Guitar;
    private guitarHinted = false;
    /** the giant water slide on the far side */
    readonly slide: Slide;
    /** the cloud door's skydive (set by main) */
    dive: Skydive | null = null;
    /** boats on the sea, and the storm out past the reef */
    readonly boats: Boats;
    private boatAim: { ok: boolean; why: string; x: number; z: number; yaw: number } | null = null;
    private boatTurn = 0;
    /** seconds since the giant wave hit (-1: not happening) */
    wreckT = -1;
    /** how blurred the view is while your eyes open (px; main puts it on the canvas) */
    eyeBlur = 0;
    private wreckStage = 0;
    private wakeAt = { x: 0, z: 0, yaw: 0 };
    private lidsEl: HTMLElement | null = null;
    private ivDir = new THREE.Vector3();
    /** doors hung in doorways, and pictures on the walls (with the paint editor) */
    readonly doors: Doors;
    readonly paintings: Paintings;
    readonly painter = new Painter();
    /** the picture this player is painting (multiplayer: nobody else can open it meanwhile) */
    paintingNid: string | null = null;
    private frameAim: FrameAim | null = null;
    /** showers and storms (the host decides; see world/weather). Set by main. */
    weather: Weather | null = null;
    /** schools of fish, and the glowing sea on some nights (the host decides at dusk) */
    readonly sealife: SeaLife;
    bioTonight = false;
    private bioHour = -1;
    private roofT = 0;
    private roofed = false;
    /** switch the presentation between the island and the caves (set by main) */
    onUnderground: ((on: boolean) => void) | null = null;
    private faunaMirror: ThreeMirror;
    readonly map: MapView;
    private fishPrompt: string | null = null;
    private deathMark: { x: number; z: number } | null = null;
    /** multiplayer: friends and pings for the map (set by net/sync) */
    mapExtras: { friends?: () => { x: number; z: number; name: string; color: string }[]; pings?: () => { x: number; z: number; name: string; color: string; age: number }[] } = {};
    /** VR: aim comes from the hand, not the head; the VR rig fills this in every frame */
    readonly vr = { active: false, eye: new Vector3(), dir: new Vector3(0, 0, -1), head: null as Vector3 | null, headDir: null as Vector3 | null, haptic: null as null | ((strength: number) => void) };
    /** multiplayer glue (set by net/sync) */
    netId = 0;
    net: {
        hitPlayer?: (id: number, dmg: number) => void;
        hitAnimal?: (idx: number, dmg: number, px: number, pz: number) => void;
        hurtRemote?: (target: number, dmg: number, fx: number, fz: number, by: string) => void;
        /** everyone the animals might go after (multiplayer host) */
        targets?: () => FaunaTarget[];
        rayPlayer?: (eye: Vector3, dir: Vector3, reach: number) => { id: number; name: string; dist: number } | null;
        inUse?: (s: Structure) => string | null;
        slept?: () => void;
        died?: () => void;
        /** the host tells everybody whether the sea glows tonight; clients just follow */
        bio?: (on: boolean) => void;
        bioRemote?: boolean;
        hitStalker?: (idx: number, px: number, pz: number) => void;
        /** washed up after the wreck: ask the host for fine weather */
        calm?: () => void;
    } = {};
    /** bumps on every swing so other players can animate it */
    swings = 0;

    private input: Input;
    private spawn: GameOpts["spawn"];
    private clock: GameOpts["clock"];
    private dir = new Vector3();
    private eye = new Vector3();
    private eatCd = 0;
    private vrCd = 0;
    private seaCd = 0;
    private drinkCd = 0;
    private hurtCd = 0;
    private stepDist = 0;
    private airVy = 0;
    private wasGround = true;
    private wasSwim = false;
    private wasUnder = false;
    private airWarned = false;
    private deathHandled = false;
    private assist: number;
    private placeYaw = 0;
    private lastHeld: ItemId | null = null;
    private pieceIdx = 0;
    private hold: { target: object; t: number } | null = null;
    private openS: Structure | null = null;
    private bed: Structure | null = null;
    private sleeping = false;
    /** drinking at a spring this frame (avatars show it) */
    drinking = false;
    private torchPlace = false;
    /** a torch out in placing mode (not carried) */
    get torchPlacing() { return this.torchPlace; }

    get armorPct() { let t = 0; for (const s of this.worn.slots) if (s) t += ITEMS[s.id].armor?.def ?? 0; return Math.min(75, t); }
    get armorCode() { let c = 0; for (const s of this.worn.slots) c = c * 10 + (s ? ITEMS[s.id].armor?.tier ?? 0 : 0); return c; }
    get equipped() { return this.under?.cat?.active ? undefined : this.inv.slots[this.hud.selected]; }
    get equippedDef() { const e = this.equipped; return e ? ITEMS[e.id] : null; }
    get uiBlocking() { return this.hud.inventoryOpen || this.map.open || this.stats.dead || this.sleeping || this.painter.open; }
    get isSleeping() { return this.sleeping; }
    get openStruct() { return this.openS; }
    get bedNid() { return this.hasBed ? this.bed!.nid : null; }
    setBedByNid(nid: string | null) { this.bed = nid ? this.structures.list.find((q) => q.nid === nid) ?? null : null; }
    private get hasBed() { return !!this.bed && this.structures.list.includes(this.bed); }

    constructor(o: GameOpts) {
        this.player = o.player;
        this.input = o.input;
        this.spawn = o.spawn;
        this.clock = o.clock;
        this.assist = o.input.touch ? 1.4 : 1;
        this.inv.add("rock", 1);
        this.worn.accepts = (slot, id) => ITEMS[id].armor?.slot === ARMOR_SLOTS[slot];
        this.hud = new Hud(this.inv, this.worn);
        this.resources = new Resources(o.scene, o.vegetation, o.springSpots, o.shadows);
        this.view = new ViewModel(o.scene, o.camera);
        this.structures = new StructureManager(o.scene, o.vegetation.colliders, o.shadows);
        this.building = new BuildingSystem(o.scene, o.vegetation.colliders, o.shadows);
        this.structures.ceilingAt = (x, y, z) => {
            const e = new Vector3(x, y + 0.4, z), hit = this.building.findPiece(e, new Vector3(0, 1, 0), 4.5);
            return hit && (hit.piece.kind === "roof" || hit.piece.kind === "floor" || hit.piece.kind === "foundation") ? e.y + hit.dist : null;
        };
        this.structures.ground = this.building.ground;
        this.structures.touchesBuilding = (x, z, r, y) => this.building.touches(x, z, r, y);
        this.building.blockedByStructures = this.structures.blockedBox;
        this.structures.onEmber = (x, y, z) => this.resources.burst(new Vector3(x, y, z), "ember", 1, 1.5);
        this.view.onHit = () => this.swingHit();
        {
            // Castaway's wildlife runs on three.js objects; ThreeMirror draws them with Babylon
            const holder = new THREE.Scene();
            this.fauna = new Fauna(holder, o.vegetation.colliders, o.shadows, o.spawn, o.shadows ? 1 : 0.7);
            const fur = new PBRMaterial("fur", o.scene);
            fur.albedoColor = Color3.White();
            fur.roughness = 0.86;
            fur.metallic = 0;
            this.faunaMirror = new ThreeMirror(o.scene, this.fauna.group, fur, o.shadows);
            const f = this.fauna;
            f.onSound = (w, x, z) => {
                const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
                this.sfx.animal(w, 1 - d / (w === "gull" ? 90 : w === "roar" || w === "growl" ? 60 : w === "creep" || w === "hiss" ? 34 : w === "sing" ? 42 : 38));
            };
            f.onDrop = (id, n, x, y, z) => { this.resources.pickups.spawn(id, n, x, y, z); };
            f.onBlood = (x, y, z, n) => this.resources.burst(new Vector3(x, y, z), "flesh", n, 3);
            f.blocked = (x, z, r, y) => this.building.touches(x, z, r, y + 0.3);
            f.nearFire = (x, z, r) => this.structures.list.some((q) => q.lit && Math.hypot(q.x - x, q.z - z) < r);
            f.onHurtPlayer = (dmg, fx, fz, by, target) => {
                if (target !== this.netId) { this.net.hurtRemote?.(target, dmg, fx, fz, by); return; }
                this.hurtPlayer(dmg, fx, fz, by);
            };
        }
        this.turtles = new Turtles(this.natureRoot, o.shadows);
        this.saplings = new Saplings(o.vegetation, this.resources);
        this.stalkers = new Stalkers(this.natureRoot, o.vegetation.colliders);
        this.twins = new Twins(this.natureRoot);
        this.offshore = new Offshore(this.natureRoot);
        this.druids = new Druids(this.natureRoot, o.vegetation.colliders, o.shadows);
        this.druids.say = (t) => this.hud.message(t);
        this.warp = new Warp(this.natureRoot, o.vegetation.colliders, !!o.shadows);
        this.warp.say = (t) => this.hud.message(t);
        this.warp.sfx = this.sfx;
        this.warp.voice = (line) => {
            if (line === "start") this.druids.sayItsMe(1);
            else {
                // (no recording of this one: the browser's own voice, pitched up, if it has one)
                try { const u = new SpeechSynthesisUtterance("Thank you so much for-a playing my game!"); u.pitch = 1.6; u.rate = 1.05; window.speechSynthesis?.speak(u); } catch { /* */ }
            }
        };
        this.warp.onExit = () => {
            // out of the pipe, next to it, facing it
            const P = this.warp.pipeAt, p = this.player;
            p.ride = null;
            if (P) {
                const a = (this.netId % 6) * 1.05, x = P.x + Math.sin(a) * 2.6, z = P.z + Math.cos(a) * 2.6;
                p.teleport(x, this.building.ground(x, z, P.y + 2), z, Math.atan2(x - P.x, z - P.z));
            }
            this.sfx.pipe8();
            this.hud.message("You pop out of the pipe, back on the island.");
        };
        this.guitar = new Guitar(this.sfx);
        this.slide = new Slide(this.natureRoot, o.vegetation.colliders, o.shadows);
        this.slide.say = (t) => this.hud.message(t);
        this.slide.sound = (k, v) => { if (k === "splash") this.sfx.splash(v); else if (k === "land") this.sfx.splash(0.6); else this.sfx.whoosh(); };
        this.boats = new Boats(this.natureRoot, !!o.shadows);
        this.boats.surface = (x, z) => this.player.surfaceAt(x, z);
        this.boats.say = (t) => this.hud.message(t);
        this.boats.sfx = this.sfx as never;
        this.boats.shake = (a) => this.player.shake(a);
        this.boats.onWreck = () => this.startWreck();
        // (the slide's tower platform and boats' decks are ground too)
        this.player.world = {
            ground: (x, z, y) => Math.max(this.building.ground(x, z, y), this.slide.ground(x, z, y ?? -1e9), this.boats.ground(x, z, y ?? 1e9)),
            resolve: (x, z, r, feetY, out) => { this.building.resolve(x, z, r, feetY, out); this.boats.resolve(out.x, out.z, r, feetY, out); },
        };
        this.invaders = new Invaders(this.natureRoot);
        {
            const C = this.druids.centre, a0 = 0.26; // (the ring's gap: the entrance, towards the sunrise)
            this.invaders.setSite(C.x, C.y, C.z, Math.atan2(-Math.cos(a0), -Math.sin(a0)));
        }
        this.invaders.say = (t) => this.hud.message(t);
        this.invaders.sfx = this.sfx;
        this.invaders.onJolt = () => { this.player.shake(0.7); this.vr.haptic?.(1); };
        this.druids.busy = () => this.invaders.running;
        this.druids.onCall = (c) => { if (c === "blue") this.invaders.hostStart(this.druids.players().map((q) => q.id)); };
        this.invaders.onSeat = (x, y, z, yaw) => {
            const p = this.player;
            this.invaders.setHome({ x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw });
            if (this.hud.inventoryOpen) this.setInventory(false);
            p.teleport(x, y, z, yaw); p.pitch = 0.45;
            p.ride = () => { if (!this.invaders.seated) return false; p.pos.set(x, y, z); return true; };
        };
        this.invaders.onRelease = () => {
            const h = this.invaders.homeSpot, p = this.player;
            if (h) p.teleport(h.x, h.y + 0.05, h.z, h.yaw);
        };
        this.warp.onFinished = () => {
            this.druids.setPhase("idle");
            this.hud.message("Mario waves goodbye and goes home. The sky clears.");
        };
        this.druids.myId = () => this.netId;
        this.druids.players = () => (this.net.targets?.() ?? [{ id: this.netId, x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }]).filter((p) => Math.abs(p.x) < 500 && Math.abs(p.z) < 500);
        this.druids.sound = (k, v) => { if (k === "bonk") this.sfx.bonk(); else if (k === "hop") this.sfx.hop(v); else if (k === "poof") this.sfx.poof(v); else if (k === "touch") this.sfx.hum(v); else this.sfx.whoosh(); };
        this.offshore.sound = (k, v) => { if (k === "blow") this.sfx.blow(v); else if (k === "splash") this.sfx.bigSplash(v); else this.sfx.horn(v); };
        this.stalkers.onSound = (w, x, z) => this.fauna.onSound?.(w, x, z);
        this.stalkers.onBlood = (x, y, z, n) => this.fauna.onBlood?.(x, y, z, n);
        this.twins.onSound = (w, x, z) => this.fauna.onSound?.(w, x, z);
        this.twins.nearFire = (x, z, r) => this.structures.list.some((q) => q.lit && Math.hypot(q.x - x, q.z - z) < r);
        this.stalkers.nearFire = (x, z, r) => this.structures.list.some((q) => q.lit && Math.hypot(q.x - x, q.z - z) < r);
        this.doors = new Doors(o.scene, this.building, o.shadows);
        this.paintings = new Paintings(o.scene, o.shadows);
        this.building.afterRemove = (p, silent) => {
            // a doorway came down: its door drops out; pictures on a wall fall off
            const d = this.doors.wallGone(p.key);
            if (d && !silent) { const g = p.group.position; this.resources.pickups.spawn("door", 1, g.x + 0.6, this.building.ground(g.x + 0.6, g.z + 0.6, p.H + 0.5), g.z + 0.6); }
            for (const q of this.paintings.wallGone(p.key)) {
                if (silent) continue;
                const x = q.x + Math.sin(q.yaw) * 0.5, z = q.z + Math.cos(q.yaw) * 0.5;
                this.resources.pickups.spawn("picture_frame", 1, x, this.building.ground(x, z, q.y), z);
            }
        };
        this.saplings.onGrow = (p) => this.resources.burst(new Vector3(p.x, p.y + 0.6, p.z), "leaf", 8);
        {
            const q = o.vegetation.q, vr = isProbablyHeadset();
            this.flowers = new Flowers(o.scene, q.name === "low" ? 46 : 60, o.shadows, vr ? 1400 : q.name === "high" ? 3200 : 2400);
            this.resources.flowers = this.flowers;
        }
        this.birds = new Birds(o.vegetation);
        this.natureRoot.add(this.prints.mesh, this.birds.group, this.flamingos.group);
        this.sealife = new SeaLife(this.natureRoot, !o.shadows);
        this.natureMirror = new ThreeMirror(o.scene, this.natureRoot, null, o.shadows, {
            custom: (m) => (m.name.startsWith("fish") ? fishMaterial(o.scene, FISH_WIGGLE[+m.name.slice(4)] ?? 0.1)
                : m.name === "skyMirror" ? skyMirrorMaterial(o.scene) : m.name === "woodSlab" ? woodMaterials(o.scene).slab : m.name === "glass" ? glassMaterial(o.scene) : druidMaterial(o.scene, m)),
        });
        this.birds.sound = (k, v) => { if (k === "chirp") this.sfx.chirp(v); else this.sfx.flutter(v); };
        this.flamingos.sound = (k, v) => { if (k === "honk") this.sfx.honk(v); else this.sfx.flutter(v); };
        {
            const pk = this.resources.pickups, tu = this.turtles;
            tu.layEgg = (x, y, z) => pk.spawn("turtle_egg", 1, x, y, z)?.nid ?? null;
            tu.eggThere = (nid) => pk.byId.has(nid);
            tu.takeEgg = (nid) => { const p = pk.byId.get(nid); if (p) pk.remove(p); };
            tu.onSand = (x, y, z, n) => { if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 90) this.resources.burst(new Vector3(x, y, z), "sand", n, 2.2); };
            this.resources.onTreeHit = (x, z) => this.birds.treeHit(x, z);
            tu.onArrive = (x, z) => { if (!this.under.active && Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 170) this.hud.message("Sea turtles are coming ashore to nest. Watch them, but give them room."); };
        }
        this.under = new Underground({
            scene: this.ugRoot, player: o.player,
            present: (on) => this.onUnderground?.(on),
            message: (t) => this.hud.message(t), gain: () => {},
            give: (id, n) => { this.give(id, n); return n; },
            canFit: (id, n) => this.inv.canFit(id, n),
            burst: (p, fx, n) => this.resources.burst(new Vector3(p.x, p.y, p.z), fx as HitFx, n),
            sfx: { hit: (k) => this.sfx.hit(k as never), denied: () => this.sfx.denied(), pickup: () => this.sfx.pickup(), creak: () => this.sfx.creak(), swing: () => this.sfx.swing() },
        });
        this.map = new MapView();
        this.map.onClose = () => this.toggleMap(false);
        this.fishing = new Fishing(o.scene, () => o.scene.activeCamera!, {
            message: (m) => this.hud.message(m),
            splash: (x, y, z, n) => this.resources.burst(new Vector3(x, y, z), "water", n, 3.2),
            sound: (w) => this.sfx.fish(w),
            caught: (n) => {
                this.give("raw_fish", n);
                this.hud.message(n > 1 ? "You caught two fish!" : "You caught a fish!");
                this.vr.haptic?.(0.8);
                this.wearHeld();
            },
            prompt: (t) => { this.fishPrompt = t; },
        });
        this.player.onLand = (v) => {
            if (this.stats.dead || this.under.camp?.active || this.under.town?.active) return;
            const d = (v - 14) * 6;
            if (d < 1) return;
            this.stats.hurt(d, "fall");
            this.player.shake(Math.min(1, d / 40));
            this.sfx.hurt();
            this.vr.haptic?.(0.9);
            this.hud.message(d > 30 ? "A brutal landing!" : "Ouch, that hurt!");
        };
        this.resources.onImpact = (x, _y, z, k) => {
            const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
            const near = Math.max(0, 1 - d / 40);
            this.player.shake(k * 1.6 * near);
            this.vr.haptic?.(Math.min(1, near * k));
            this.sfx.thump(Math.max(0.15, near * k));
        };
        this.resources.onCrumble = (x, _y, z, kind) => {
            const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
            this.player.shake(Math.max(0, 0.55 - d / 14));
            this.sfx.crumble(kind === "ore");
        };
        this.hud.onClose = () => this.setInventory(false);
        this.hud.onUse = (slot) => { const it = this.inv.slots[slot]; if (it && ITEMS[it.id].armor) this.wearFromBag(slot); else this.eatSlot(slot); };
        this.hud.onTakeOff = (i) => this.takeOff(i);
        this.hud.onDrop = (slot, all) => this.dropSlot(slot, all);
        this.hud.onRespawn = () => this.respawn();
        this.hud.onCraft = (r) => this.craftRecipe(r);
        this.hud.onFuel = (n) => this.addFuel(n);
        this.hud.onXfer = (fromCont, slot) => this.transfer(fromCont, slot);
        this.hud.onChip = () => { if (this.equippedDef?.kind === "plan") this.cyclePiece(1); };
        this.input.onInventory = () => this.toggleInventory();
        this.input.onCraft = () => this.toggleCraft();
        this.input.onMap = () => this.toggleMap();
        this.input.onMute = () => { this.sfx.setMuted(!this.sfx.muted); this.hud.message(this.sfx.muted ? "Sound off" : "Sound on"); };
        this.stats.onHurt = () => {
            this.hud.flashHurt();
            if (this.hurtCd <= 0) { this.sfx.hurt(); this.hurtCd = 0.6; }
        };
        window.addEventListener("keydown", (e) => { if (e.code === "Escape" && this.hud.inventoryOpen) this.setInventory(false); });
    }

    // ------------------------------------------------------------ armor
    wearFromBag(i: number) {
        const s = this.inv.slots[i], def = s ? ITEMS[s.id] : null;
        if (!s || !def?.armor) return;
        const wi = ARMOR_SLOTS.indexOf(def.armor.slot), cur = this.worn.slots[wi];
        this.worn.slots[wi] = s;
        this.inv.slots[i] = cur;
        this.inv.emit();
        this.worn.emit();
        this.sfx.pickup();
        this.hud.message(`Wearing ${def.name}. Armor ${this.armorPct}%.`);
    }
    takeOff(wi: number) {
        const s = this.worn.slots[wi];
        if (!s) return;
        if (this.inv.add(s.id, 1, s.dur) > 0) { this.hud.message("Your bag is full"); this.sfx.denied(); return; }
        this.worn.slots[wi] = null;
        this.worn.emit();
        this.sfx.pickup();
    }
    private wearArmor(dmg: number) {
        const n = Math.max(1, Math.round(dmg / 10));
        this.worn.slots.forEach((s, i) => {
            if (!s || s.dur === undefined) return;
            s.dur -= n;
            if (s.dur <= 0) { this.hud.message(`Your ${ITEMS[s.id].name} broke!`); this.sfx.tool_break(); this.worn.slots[i] = null; }
        });
        this.worn.emit();
    }

    // ------------------------------------------------------------ menus
    toggleMap(open = !this.map.open) {
        if (open && (this.stats.dead || this.sleeping)) return;
        if (open && this.hud.inventoryOpen) this.setInventory(false);
        this.map.setOpen(open);
        this.input.uiOpen = open || this.stats.dead || this.sleeping;
        if (open) { if (document.pointerLockElement) document.exitPointerLock(); }
        else if (!this.input.touch && !this.vr.active) this.input.requestLock();
    }

    toggleInventory() {
        if (this.stats.dead || this.sleeping) return;
        this.setInventory(!this.hud.inventoryOpen);
    }
    toggleCraft() {
        if (this.stats.dead || this.sleeping) return;
        if (this.hud.inventoryOpen && this.hud.tab === "craft") this.setInventory(false);
        else if (this.hud.inventoryOpen) this.hud.setTab("craft");
        else this.setInventory(true, "craft");
    }
    setInventory(open: boolean, tab: "bag" | "craft" = "bag") {
        this.hud.setInventory(open, tab);
        if (!open) this.openS = null;
        this.input.uiOpen = open || this.stats.dead || this.sleeping;
        if (open) { if (document.pointerLockElement) document.exitPointerLock(); }
        else if (!this.input.touch && !this.vr.active) this.input.requestLock();
    }

    /** Something hit the local player. `by` is an animal kind or a player's name. */
    hurtPlayer(dmg: number, fx: number, fz: number, by: string) {
        if (this.stats.dead || this.sleeping) return;
        const p = this.player, dx = p.pos.x - fx, dz = p.pos.z - fz, l = Math.hypot(dx, dz) || 1;
        p.vel.x += (dx / l) * 5;
        p.vel.z += (dz / l) * 5;
        this.stats.hurt(dmg * (1 - this.armorPct / 100), "attack");
        this.wearArmor(dmg);
        this.vr.haptic?.(1);
        this.player.shake(0.9);
        this.sfx.hurt();
        this.hud.message(`${by} hit you!`);
        if (this.stats.dead) this.stats.deathCause = `${by} killed you.`;
    }

    private eatSlot(i: number) {
        const s = this.inv.slots[i];
        if (!s) return;
        const f = ITEMS[s.id].food;
        if (!f) return;
        if (this.stats.hunger >= 99 && this.stats.thirst >= 99) { this.hud.message("You're not hungry or thirsty"); this.sfx.denied(); return; }
        this.stats.eat(f.hunger, f.thirst, f.health ?? 0);
        this.inv.takeAt(i, 1);
        this.view.eat();
        this.sfx.eat();
    }
    private dropSlot(i: number, all: boolean) {
        const s = this.inv.slots[i];
        if (!s) return;
        const out = this.inv.takeAt(i, all ? s.count : 1);
        if (out) this.dropInFront(out.id, out.count, out.dur);
    }
    private dropInFront(id: ItemId, count: number, dur?: number) {
        const p = this.player;
        const x = p.pos.x - Math.sin(p.yaw) * 1.3, z = p.pos.z - Math.cos(p.yaw) * 1.3;
        const y = Math.max(this.building.ground(x, z, this.player.pos.y + 0.5), -0.05);
        if (!this.resources.pickups.spawn(id, count, x, y, z, dur)) {
            this.inv.add(id, count, dur);
            this.hud.message("Too many items on the ground here");
        }
    }
    /** Puts items in the bag; whatever doesn't fit is dropped at your feet. */
    give(id: ItemId, n: number) {
        const left = this.inv.add(id, n);
        if (left > 0) this.dropInFront(id, left);
        this.hud.gain(id, n - left);
    }

    // ------------------------------------------------------------ crafting, stations, containers
    private craftRecipe(r: Recipe) {
        if (r.bench && !this.structures.nearBench(this.player.pos.x, this.player.pos.y, this.player.pos.z, BENCH_REACH)) {
            this.hud.message("You need to be near a workbench");
            this.sfx.denied();
            return;
        }
        if (craft(this.inv, r)) { this.sfx.craft(); this.hud.gain(r.out, r.count); }
        else { this.hud.message(this.inv.canFit(r.out, r.count) < r.count ? "Inventory full" : "Missing materials"); this.sfx.denied(); }
    }
    private addFuel(n: number) {
        const s = this.openS;
        if (!s) return;
        const coal = Math.min(n, this.inv.count("coal")), wood = Math.min(n, this.inv.count("wood"));
        if (coal <= 0 && wood <= 0) { this.hud.message("You need wood or coal"); this.sfx.denied(); return; }
        if (s.fuel >= MAX_FUEL - 1) { this.hud.message("It is full of fuel"); return; }
        if (coal > 0) { this.inv.remove("coal", coal); this.structures.addFuel(s, coal * COAL_BURN); }
        else { this.inv.remove("wood", wood); this.structures.addFuel(s, wood); }
        this.sfx.pickup();
    }
    private transfer(fromCont: boolean, slot: number) {
        const c = this.hud.cont;
        if (!c) return;
        const src = fromCont ? c : this.inv, dst = fromCont ? this.inv : c;
        if (src.sendTo(slot, dst) <= 0) { this.hud.message(fromCont ? "Your bag is full" : "That doesn’t go there"); this.sfx.denied(); }
    }
    private openStructure(s: Structure) {
        if (s.kind === "workbench") { this.setInventory(true, "craft"); return; }
        if (s.kind === "bed" || s.kind === "sleeping_bag") { this.useBed(s); return; }
        if (!s.inv) return;
        const user = this.net.inUse?.(s);
        if (user) { this.hud.message(`${user} is using this`); this.sfx.denied(); return; }
        const hint = s.kind === "flower_pot" ? "Put one of your flowers in the pot to plant it. Take it out again any time."
            : s.kind === "box" ? "Move things in and out. A box keeps its contents when you die."
            : s.kind === "campfire" ? "Put coconuts, meat and fish in the top row to cook them. Feed it wood to keep it burning."
            : "Put metal ore in the top row. Metal comes out below. Needs wood as fuel.";
        this.hud.openContainer(STRUCT_NAME[s.kind], s.inv, s.kind !== "box", hint);
        this.setInventory(true);
        this.openS = s;
    }
    private toggleDoor(d: Door) {
        const p = this.player.pos;
        this.doors.set(d, !d.open, this.doors.swingFrom(d, p.x, p.z));
        this.sfx.creak();
    }
    private takeDoor(d: Door) {
        if (!d.open) { const p = this.player.pos; this.doors.set(d, true, this.doors.swingFrom(d, p.x, p.z)); }
        this.doors.remove(d); this.give("door", 1); this.sfx.remove();
    }

    /** open the paint editor on a picture */
    private openPainting(p: Painting) {
        const user = this.net.inUse?.({ nid: p.nid } as Structure);
        if (user) { this.hud.message(`${user} is painting this`); this.sfx.denied(); return; }
        this.paintingNid = p.nid;
        this.input.uiOpen = true;
        if (document.pointerLockElement) document.exitPointerLock();
        this.painter.show("Paint a picture", p.data, (data) => {
            this.paintingNid = null;
            if (data !== null && this.paintings.list.includes(p)) { this.paintings.setData(p, data); this.sfx.place(); this.hud.message("Saved. Everybody can see your picture."); }
            else if (data !== null) this.hud.message("That picture is gone (its wall came down).");
            this.input.uiOpen = this.hud.inventoryOpen || this.stats.dead || this.sleeping;
            if (!this.input.uiOpen && !this.input.touch && !this.vr.active) this.input.requestLock();
        });
    }

    private takeDownPainting(p: Painting) {
        if (this.net.inUse?.({ nid: p.nid } as Structure)) { this.hud.message("Somebody is painting it"); this.sfx.denied(); return; }
        this.paintings.remove(p);
        this.give("picture_frame", 1);
        this.sfx.remove();
    }

    private pickupStructure(s: Structure) {
        if (s.inv && s.inv.slots.some(Boolean)) { this.hud.message(s.kind === "box" ? "Empty the box first" : "Take everything out first"); this.sfx.denied(); return; }
        if (s.kind === "table" && this.structures.onTable(s).length) { this.hud.message("Take the things off the table first"); this.sfx.denied(); return; }
        this.structures.remove(s);
        if (this.bed === s) this.bed = null;
        this.give(s.kind as ItemId, 1);
        this.sfx.remove();
    }
    private useBed(s: Structure) {
        this.bed = s;
        const h = this.clock.hour;
        const night = h >= 19.5 || h < 5.5;
        if (!night) { this.hud.message("Respawn point set. You can sleep here at night."); this.sfx.pickup(); return; }
        this.sleeping = true;
        this.input.uiOpen = true;
        this.hud.fade(true, "Sleeping…");
        this.sfx.sleep();
        setTimeout(() => {
            if (this.net.slept) this.net.slept();
            else this.clock.hour = 6.4;
            this.stats.hunger = Math.max(15, this.stats.hunger - 10);
            this.stats.thirst = Math.max(15, this.stats.thirst - 14);
            this.stats.health = Math.min(100, this.stats.health + (s.kind === "sleeping_bag" ? 18 : 30));
            this.stats.stamina = 100;
            this.hud.message(this.net.slept ? "Respawn point set. Morning comes when enough of you have slept." : "You slept until morning. Respawn point set.");
            this.hud.fade(false);
            setTimeout(() => { this.sleeping = false; this.input.uiOpen = this.hud.inventoryOpen || this.stats.dead; }, 900);
        }, 1500);
    }

    // ------------------------------------------------------------ death
    private onDeath() {
        this.deathHandled = true;
        this.net.died?.();
        const p = this.player;
        this.deathMark = { x: p.pos.x, z: p.pos.z };
        if (this.map.open) this.toggleMap(false);
        let dropped = 0;
        this.inv.slots.forEach((s, i) => {
            if (!s || s.id === "rock") return; // your first rock is yours for good: it never drops
            const a = (i / 24) * Math.PI * 2;
            const x = p.pos.x + Math.cos(a) * 0.9, z = p.pos.z + Math.sin(a) * 0.9;
            if (this.resources.pickups.spawn(s.id, s.count, x, Math.max(this.building.ground(x, z, p.pos.y + 0.5), -0.05), z, s.dur)) dropped++;
        });
        this.worn.slots.forEach((s, i) => {
            if (!s) return;
            const a = ((i + 0.5) / 3) * Math.PI * 2 + 0.5, x = p.pos.x + Math.cos(a) * 1.3, z = p.pos.z + Math.sin(a) * 1.3;
            if (this.resources.pickups.spawn(s.id, 1, x, Math.max(this.building.ground(x, z, p.pos.y + 0.5), -0.05), z, s.dur)) dropped++;
        });
        this.worn.clear();
        this.inv.clear();
        this.hud.setInventory(false);
        this.openS = null;
        this.input.uiOpen = true;
        if (document.pointerLockElement) document.exitPointerLock();
        this.sfx.death();
        this.hud.setBuild(null, false, false);
        this.hud.showDeath(this.stats.deathCause + (dropped ? " Your belongings are where you fell." : ""), this.hasBed);
    }

    respawn() {
        if (!this.stats.dead) return;
        this.under.exit(null, true);
        this.stats.reset();
        this.inv.add("rock", 1);
        if (this.hasBed) {
            const b = this.bed!;
            this.player.respawn(b.x + Math.cos(b.yaw) * 1.1, b.z - Math.sin(b.yaw) * 1.1, b.yaw + Math.PI / 2);
        } else this.player.respawn(this.spawn.x, this.spawn.z, this.spawn.yaw);
        this.hud.hideDeath();
        this.hud.select(0);
        this.input.uiOpen = false;
        this.deathHandled = false;
        if (!this.input.touch && !this.vr.active) this.input.requestLock();
    }

    // ------------------------------------------------------------ per-frame
    preUpdate() {
        this.player.canSprint = this.stats.canSprint;
        this.player.canJump = this.stats.stamina > 0.5;
    }

    update(dt: number, active: boolean) {
        const { player, stats, input, hud, view } = this;
        this.hurtCd -= dt; this.vrCd -= dt; this.meowCd -= dt; this.eatCd -= dt; this.seaCd -= dt; this.drinkCd -= dt;
        this.resources.update(dt, player.pos.x, player.pos.z);
        this.saplings.update(dt);
        this.doors.update(dt);
        this.building.update(dt);
        const ug = this.under;
        this.structures.update(dt, player.pos.x + (ug.active ? 1e6 : 0), player.pos.y, player.pos.z);
        this.sfx.setFire(this.structures.fireNear);
        this.sfx.setOcean(ug.active ? 0 : clamp(1 - Math.max(0, player.pos.y) / 9, 0, 1));
        {
            const def = this.equippedDef, torch = def?.id === "torch" && (!this.torchPlace || ug.active) && !stats.dead;
            this.structures.setHeldLight(torch, this.vr.active ? this.vr.eye : player.eye, dt, ug.active ? 2.1 : 1);
        }
        view.update(dt, Math.hypot(player.vel.x, player.vel.z));
        this.fishing.update(dt);
        {
            const h = this.clock.hour, p = player;
            this.fauna.update(dt, ug.active ? [{ id: this.netId, x: 1e6, y: 0, z: 1e6, sprint: false }] : this.net.targets ? this.net.targets() : [{ id: this.netId, x: p.pos.x, y: p.pos.y, z: p.pos.z, sprint: p.sprinting, yaw: p.yaw }], h < 5.8 || h > 19.5);
            this.faunaMirror.sync();
            const ts = ug.active ? [] : (this.net.targets ? this.net.targets() : [{ x: p.pos.x, y: p.pos.y, z: p.pos.z }]).filter((t) => Math.abs(t.x) < 5e5);
            const nightNow = h < 5.4 || h > 19.8;
            this.stalkers.update(dt, ts, nightNow);
            this.twins.update(dt, ts, nightNow);
            this.turtles.update(dt, h, ts);
            this.updateNature(dt, h, ug.active);
            this.natureMirror.sync();
        }
        if (this.deathMark && !stats.dead && Math.hypot(this.deathMark.x - player.pos.x, this.deathMark.z - player.pos.z) < 5) this.deathMark = null;
        {
            const b = this.hasBed ? this.bed! : null;
            const mk: MapMarkers = {
                bed: b ? { x: b.x, z: b.z } : null, death: this.deathMark,
                springs: this.resources.springs.springs,
                camps: this.structures.list.filter((q) => q !== b && q.kind !== "torch").map((q) => ({ x: q.x, z: q.z, kind: q.kind })),
                friends: this.mapExtras.friends?.() ?? [], pings: this.mapExtras.pings?.() ?? [],
            };
            this.map.update(player.pos.x, player.pos.z, player.yaw, mk);
        }
        if (this.fishing.active && (stats.dead || this.sleeping || hud.inventoryOpen || this.equippedDef?.tool?.model !== "rod"
            || Math.hypot(this.fishing.distanceFrom.x - player.pos.x, this.fishing.distanceFrom.z - player.pos.z) > 26)) this.fishing.cancel(stats.dead || this.sleeping);
        this.drinking = false;

        // footsteps, landings and splashes
        if (active && !stats.dead && !this.sleeping) {
            const swim = player.mode === "swim", sp = Math.hypot(player.vel.x, player.vel.z);
            if (player.mode === "walk" && player.onGround && sp > 0.6) {
                this.stepDist += sp * dt;
                if (this.stepDist > (player.sprinting ? 1.75 : 2.15)) {
                    this.stepDist = 0;
                    const h = heightAt(player.pos.x, player.pos.z);
                    this.sfx.step(player.waterDepth > 0.06 || this.building.inPool(player.pos.x, player.pos.z, player.pos.y) ? "water" : player.pos.y > h + 0.2 ? "wood" : h < 2.0 ? "sand" : "grass");
                }
            } else if (swim && sp > 0.5) {
                this.stepDist += sp * dt;
                if (this.stepDist > 2.6) { this.stepDist = 0; this.sfx.splash(0.35); }
            } else if (!player.onGround || sp < 0.3) this.stepDist = Math.min(this.stepDist, 1.2);
            if (!player.onGround) this.airVy = Math.min(this.airVy, player.vel.y);
            else if (!this.wasGround) {
                if (this.airVy < -4.5 && player.mode === "walk") {
                    if (player.waterDepth > 0.15) this.sfx.splash(0.7);
                    else { this.sfx.land(-this.airVy / 6); player.shake(Math.min(0.6, (-this.airVy - 4) * 0.08)); }
                }
                this.airVy = 0;
            }
            if (swim && !this.wasSwim) this.sfx.splash(1);
            const uw = player.underwater;
            if (!uw && this.wasUnder && this.stats.oxygen < 70) this.sfx.gasp(this.stats.oxygen < 25 ? 1 : 0.6);
            if (uw && this.stats.oxygen < 25 && !this.airWarned) { this.airWarned = true; this.hud.message(this.vr.active ? "You are running out of air! Swim up (A)." : "You are running out of air! Swim up (Space)."); }
            if (!uw || this.stats.oxygen > 40) this.airWarned = this.airWarned && uw;
            this.wasUnder = uw;
            this.wasGround = player.onGround;
            this.wasSwim = swim;
        }
        if (!active) { view.visible(false); return; }
        view.visible(!stats.dead && !this.vr.active && !this.warp.inLevel && !this.invaders.seated && !this.under.cat?.active && !this.under.camp?.active);

        const calm = !!this.under.camp?.active || !!this.under.locs?.active || !!this.under.town?.active;
        stats.godMode = player.mode === "fly" || calm;      // no hunger, thirst or falls in the campaign or the Locations places
        if (!stats.dead && !calm) stats.update({ dt, moving: player.moving && player.mode !== "fly", sprinting: player.sprinting && player.mode !== "fly", swimming: player.mode === "swim", jumped: player.jumped, underwater: player.underwater });
        if (stats.dead && !this.deathHandled) this.onDeath();
        hud.setVitals(stats);

        // sitting in a car: the airstrip drives; E gets you out
        const air = this.under.air;
        if (air?.driving) {
            hud.setPrompt(null); this.hideBuildUi();
            view.visible(false);
            if (input.interactQueued) { input.interactQueued = false; const c = air.driving; air.exitCar(this.player); if (c) this.under.onEvent?.({ k: "cr", i: c.index, on: 0 }); }
            input.attackQueued = false; input.attackHeld = false; input.hotbarDelta = 0; input.hotbarSelect = null;
            return;
        }
        if (this.boats.atHelm && input.interactQueued) { input.interactQueued = false; this.leaveHelm(); }
        if (stats.dead || this.sleeping || this.wreckT >= 0 || this.warp.inLevel || this.invaders.seated) { hud.setPrompt(null); this.hideBuildUi(); return; }

        if (hud.inventoryOpen) {
            hud.setPrompt(null);
            this.hideBuildUi();
            hud.setBench(this.structures.nearBench(player.pos.x, player.pos.y, player.pos.z, BENCH_REACH));
            const s = this.openS;
            if (s) {
                if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 6.5 || !this.structures.list.includes(s)) this.setInventory(false);
                else if (s.inv && s.kind !== "box") hud.setFuel(s.fuel, MAX_FUEL, this.inv.count("wood") + this.inv.count("coal"), s.lit, s.prog > 0);
            }
            return;
        }

        // hotbar
        if (input.hotbarSelect !== null) { hud.select(input.hotbarSelect); input.hotbarSelect = null; }
        if (input.hotbarDelta) { hud.select(hud.selected + input.hotbarDelta); input.hotbarDelta = 0; }
        const held = this.equipped;
        const def = held ? ITEMS[held.id] : null;
        view.setItem(held ? held.id : null);
        if ((held?.id ?? null) !== this.lastHeld) {
            this.lastHeld = held?.id ?? null;
            this.placeYaw = Math.round(player.yaw / STEP) * STEP; // new placeable: face the player
            this.hold = null;
            hud.setHold(0);
        }

        const eye = this.eye, dir = this.dir;
        ug.update(dt, player.eye, held ? held.id : null);
        if (this.vr.active) { dir.copyFrom(this.vr.dir); eye.copyFrom(this.vr.eye); this.assist = 1.7; }
        else {
            eye.copyFrom(player.eye);
            const cp = Math.cos(player.pitch);
            dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
            this.assist = input.touch ? 1.4 : 1;
        }

        // ---------------- a torch is carried (and lights the way) until you switch it to placing mode
        {
            const isTorch = def?.id === "torch";
            if (input.modeQueued) {
                input.modeQueued = false;
                if (isTorch) {
                    this.torchPlace = !this.torchPlace;
                    hud.message(this.torchPlace ? "Placing mode: aim and click to plant the torch" : "Carrying the torch");
                    this.sfx.place();
                }
            }
            if (!isTorch || ug.active) this.torchPlace = false;
            if (def?.instrument) {
                if (input.rotateQueued) { this.guitar.chord = (this.guitar.chord + input.rotateQueued + CHORDS.length * 4) % CHORDS.length; input.rotateQueued = 0; hud.message(`Chord: ${this.guitar.chordName}`); }
                if (!this.guitarHinted) {
                    this.guitarHinted = true;
                    hud.message(this.vr.active ? "Guitar: strum it with the trigger. X, Y and the left trigger change the chord." : input.touch ? "Guitar: tap HIT to strum, ⟳ to change chord" : "Guitar: click to strum, R to change chord");
                }
            } else this.guitar.reset();
            document.body.classList.toggle("holdmode", isTorch && !ug.active);
            document.body.classList.toggle("placemode", this.torchPlace);
        }

        // ---------------- placing furniture / structures (not underground: a held torch just lights the way)
        if (ug.active && (def?.kind === "placeable" || def?.kind === "plan")) {
            this.building.hideGhost(); this.structures.hideGhost(); this.hideBuildUi();
            if (input.attackQueued) { hud.message("Too cramped to build down here"); this.sfx.denied(); input.attackQueued = false; }
        }
        if (!ug.active && def?.kind === "placeable" && def.place && (def.place !== "torch" || this.torchPlace)) {
            this.building.hideGhost();
            if (input.rotateQueued) { this.placeYaw += STEP * input.rotateQueued; input.rotateQueued = 0; }
            const aim = this.structures.updateGhost(def.place, eye, dir, this.placeYaw);
            const back = def.place === "torch" ? (this.vr.active ? " · Y carry it" : input.touch ? " · 🔥 carry it" : " · B carry it") : "";
            const keys = (this.vr.active ? "Trigger place · X rotate" : input.touch ? "HIT place · ⟳ rotate" : "Click place · R rotate") + back;
            hud.setBuild(`<b>${def.name}</b>${aim.ok ? "" : ` · ${aim.reason}`}<small>${keys}</small>`, true, false, !aim.ok);
            hud.setPrompt(null);
            if (input.attackQueued) {
                input.attackQueued = false;
                if (aim.ok) this.placeStructure(def.place, aim);
                else { hud.message(aim.reason); this.sfx.denied(); }
            }
            input.interactQueued = false;
            return;
        }
        this.structures.hideGhost();

        // ---------------- building plan
        if (!ug.active && def?.kind === "plan") {
            if (input.cycleDelta) { this.cyclePiece(input.cycleDelta); input.cycleDelta = 0; }
            const pc = PIECES[this.pieceIdx];
            const aim = this.building.updateGhost(pc.kind, eye, dir);
            const have = this.inv.count("wood");
            const keys = this.vr.active ? "Trigger place · Y change piece · hold A remove · X to stone" : input.touch ? "HIT place · tap here to change piece · hold USE to remove · ⟳ to stone" : "Click place · Q change piece · hold E remove · R to stone";
            hud.setBuild(`<b>${pc.name}</b> · <b class="cost">${pc.cost} wood</b> <span style="opacity:.7">(you have ${have})</span>${aim.show && !aim.ok ? ` · ${aim.reason}` : ""}<small>${aim.show || aim.ok ? keys : `${aim.reason} · ${keys}`}</small>`, false, true, (aim.show && !aim.ok) || have < pc.cost);
            if (input.attackQueued) {
                input.attackQueued = false;
                if (!aim.ok) { hud.message(aim.reason || "Can’t build there"); this.sfx.denied(); }
                else if (have < pc.cost) { hud.message(`You need ${pc.cost} wood`); this.sfx.denied(); }
                else { this.inv.remove("wood", pc.cost); this.building.place(aim); this.sfx.place(); view.place(); this.vr.haptic?.(0.4); }
            }
            const hit = this.building.findPiece(eye, dir, 6);
            const toStone = this.vr.active ? "X" : input.touch ? "⟳" : this.keyLabel("R");
            if (hit) {
                const pp = hit.piece, stone = this.building.isStone(pp), cost = STONE_COST[pp.kind];
                const name = (stone ? "Stone " : "") + PIECE_INFO.find((p) => p.kind === pp.kind)!.name.toLowerCase().replace(/^./, (c) => (stone ? c : c.toUpperCase()));
                hud.setPrompt(name, `hold ${this.keyLabel("E")} to remove${stone || pp.kind === "pool" ? "" : ` &nbsp;·&nbsp; <b>${toStone}</b> turn to stone (${cost} stone, you have ${this.inv.count("stone")})`}`, true);
                this.runHold(dt, pp, () => {}, () => this.removePiece(pp));
                if (input.rotateQueued) {
                    input.rotateQueued = 0;
                    if (pp.kind === "pool") { hud.message("A pool stays wooden"); this.sfx.denied(); }
                    else if (stone) { hud.message("That is stone already"); this.sfx.denied(); }
                    else if (this.inv.count("stone") < cost) { hud.message(`You need ${cost} stone to turn this to stone`); this.sfx.denied(); }
                    else {
                        this.inv.remove("stone", cost);
                        this.building.upgrade(pp);
                        this.sfx.place();
                        view.place();
                        this.resources.burst(new Vector3(pp.group.position.x, pp.group.position.y + 1.2, pp.group.position.z), "stone", 10, 3);
                    }
                }
            } else { hud.setPrompt(null); this.runHold(dt, null, () => {}, () => {}); input.rotateQueued = 0; }
            input.interactQueued = false;
            return;
        }
        this.hideBuildUi();

        // ---------------- ordinary play: what are we looking at?
        const t = ug.active ? null : this.resources.findTarget(eye, dir, 3.2, this.assist);
        const st = ug.active ? null : this.structures.findTarget(eye, dir, 3.6, this.assist);
        const useStruct = st && (!t || st.dist < t.dist);
        const ugT: UgTarget | null = ug.target(eye, dir, def?.tool?.reach ?? 3.2, this.assist);
        const useUg = !!ugT && !useStruct && (ug.active || !t || ugT.dist < t.dist);
        // doors in doorways (and hanging a door: hold one and look at an empty doorway)
        const dt0 = ug.active ? null : this.doors.target(eye, dir, 3.2);
        const useDoor = !!dt0 && (!!dt0.door || def?.id === "door") && (!t || dt0.dist < t.dist + 0.3) && (!st || dt0.dist < st.dist);
        this.doors.showGhost(useDoor && dt0 && !dt0.door && def?.id === "door" ? dt0.piece : null);
        const wh = ug.active || useDoor ? null : this.building.findPiece(eye, dir, 3.2);
        const useWin = !!wh && wh.piece.kind === "window" && (!t || wh.dist < t.dist + 0.3) && (!st || wh.dist < st.dist);
        // pictures on the walls; holding a frame shows where it would hang
        const pt = ug.active ? null : this.paintings.findTarget(eye, dir, 3.4);
        const usePaint = !!pt && (!t || pt.dist < t.dist) && (!st || pt.dist < st.dist) && !useUg;
        this.frameAim = def?.frame && !ug.active && !usePaint ? this.paintings.aim(eye, dir, this.building.findPiece(eye, dir, 3.6)) : null;
        this.paintings.showGhost(this.frameAim);
        // the standing stones on the hilltop
        const dz = ug.active ? null : this.druids.target(eye, dir, 3.2);
        const useStone = !!dz && !useDoor && (!t || dz.dist < t.dist + 0.3) && (!st || dz.dist < st.dist);
        // holding a boat: show where it would go in the water
        if (def?.boat && input.rotateQueued) { this.boatTurn += (Math.PI / 4) * input.rotateQueued; input.rotateQueued = 0; }
        this.boatAim = def?.boat && !ug.active && !this.boats.on ? this.boats.aim(eye, dir, player.yaw + Math.PI / 2 + this.boatTurn) : null;
        this.boats.showGhost(this.boatAim, performance.now() / 1000);
        // a boat: climb aboard from outside; on deck, the wheel
        const bt = ug.active || this.boats.atHelm ? null : this.boats.target(eye, dir, 4.5);
        const useBoat = !!bt && (!t || bt.dist < t.dist) && (!st || bt.dist < st.dist) && !useDoor;
        if (useBoat && bt) {
            const b = bt.b, E = this.keyLabel("E");
            if (bt.what === "board") {
                hud.setPrompt("Boat", `${E} climb aboard${this.boats.aboard(b) ? "" : ` &nbsp;·&nbsp; hold ${E} pack it up`}`, true);
                this.runHold(dt, b, () => { this.boats.board(b, player.pos, player.vel); player.mode = "walk"; player.lastY = player.pos.y; }, () => this.pickupBoat(b));
            } else {
                const busy = b.helm !== null && b.helm !== this.netId;
                hud.setPrompt("Wheel", busy ? "Somebody else is steering" : `${E} take the wheel`, !busy);
                this.runHold(dt, b, () => { if (!busy) this.takeHelm(b); }, () => {});
            }
        } else if (useStone && dz) {
            const pr = this.druids.prompt(dz.i);
            hud.setPrompt(pr.name, pr.hint.replace(/^E /, `${this.keyLabel("E")} `), this.druids.phase === "idle");
            this.runHold(dt, null, () => {}, () => {});
            if (input.interactQueued && this.druids.phase === "idle") { input.interactQueued = false; this.druids.touch(dz.i); this.vr.haptic?.(0.5); }
        } else if (useDoor && dt0) {
            const d = dt0.door, clk = `<b>${this.vr.active ? "Trigger" : this.input.touch ? "HIT" : "Click"}</b>`;
            if (d) {
                hud.setPrompt("Door", `${this.keyLabel("E")} ${d.open ? "close" : "open"} &nbsp;·&nbsp; hold ${this.keyLabel("E")} take it out`, true);
                this.runHold(dt, d, () => this.toggleDoor(d), () => this.takeDoor(d));
            } else {
                hud.setPrompt("Doorway", `${clk} hang the door here`, true);
                this.runHold(dt, null, () => {}, () => {});
                if (input.attackQueued) { input.attackQueued = false; if (this.doors.hang(dt0.piece.key)) { this.inv.takeAt(hud.selected, 1); this.sfx.place(); view.place(); hud.message("Door hung. E opens and closes it."); } }
            }
        } else if (usePaint && pt && !(useWin && wh && wh.dist < pt.dist)) {
            const p = pt.p;
            hud.setPrompt("Picture", `${this.keyLabel("E")} paint &nbsp;·&nbsp; hold ${this.keyLabel("E")} take it down (the picture is lost)`, true);
            this.runHold(dt, p, () => this.openPainting(p), () => this.takeDownPainting(p));
        } else if (useWin && wh) {
            const w = wh.piece, open = this.building.windowOpen(w);
            hud.setPrompt(this.building.isStone(w) ? "Stone window" : "Window", `${this.keyLabel("E")} ${open ? "close" : "open"}`, true);
            this.runHold(dt, w, () => { const p = this.player.pos; this.building.setWindow(w, !open, this.building.swingFrom(w, p.x, p.z)); this.sfx.creak(); }, () => {});
        } else if (useStruct) {
            const s = st!.s;
            this.promptStructure(s);
            this.runHold(dt, s, () => this.openStructure(s), () => this.pickupStructure(s));
        } else if (useUg && ugT) {
            this.runHold(dt, null, () => {}, () => {});
            const pr = ug.prompt(ugT, held ? held.id : null);
            hud.setPrompt(pr.name, pr.hint, pr.ok);
        } else {
            this.runHold(dt, null, () => {}, () => {});
            const an = ug.active ? null : this.fauna.raycast(eye, dir, 4.2, this.assist);
            const sk = ug.active ? null : this.stalkers.raycast(eye, dir, 4.2, this.assist);
            const click = `<b>${this.vr.active ? "Swing" : this.input.touch ? "HIT" : "Click"}</b>`;
            if (this.fishPrompt && def?.tool?.model === "rod") hud.setPrompt(this.fishPrompt, "", true);
            else if (an && (!t || an.dist < t.dist)) {
                const a = an.a, hostile = a.kind === "boar" && a.state === "chase";
                hud.setPrompt(`${a.def.name}  ${Math.max(1, Math.ceil(a.hp))}/${a.def.hp}`, def?.tool && an.dist <= def.tool.reach ? `${click} attack` : an.dist > (def?.tool?.reach ?? 0) ? "Move closer" : "", hostile);
            } else if (sk && (!an || sk.dist < an.dist) && (!t || sk.dist < t.dist)) hud.setPrompt("The Stalker", def?.tool && sk.dist <= def.tool.reach ? `${click} attack` : "It watches you", true);
            else if (this.boatAim) {
                const ba = this.boatAim;
                const turnKey = this.vr.active ? "X" : this.input.touch ? "⟳" : this.keyLabel("R");
                hud.setPrompt("Boat", `${ba.ok ? `${click} put it in the water` : ba.why} &nbsp;·&nbsp; <b>${turnKey}</b> turn it`, ba.ok);
            } else if (this.frameAim) {
                const fa = this.frameAim;
                hud.setPrompt(def!.name, fa.ok ? `${click} hang it here` : fa.reason, fa.ok);
            } else if (def?.flower !== undefined && !t) {
                const fa = this.flowerAim(eye, dir);
                hud.setPrompt(def.name, fa.why || `${click} plant it here`, !fa.why);
            } else if (def?.kind === "seed" && !t) {
                const sp = this.seedAim(eye, dir);
                hud.setPrompt("Sapling", sp.why || `${click} plant it here`, !sp.why);
            } else this.updatePrompt(t, def);
        }

        // Banana or Salmon: click picks things up, throws them, beats your chest
        if (ug.camp?.active) { if (input.attackQueued) { input.attackQueued = false; ug.camp.click(ugT?.kind === "camp" ? ugT.t : null); } input.attackHeld = false; }
        if ((ug.locs?.active || ug.town?.active) && input.attackQueued && (ugT?.kind === "locroom" || ugT?.kind === "townexit")) { input.attackQueued = false; ug.interact(ugT); }
        // hide & seek: clicking works as well as E for tagging a player or opening a box
        if (ug.active && ugT?.kind === "hide" && input.attackQueued && (ugT.t.w === "tag" || ugT.t.w === "box")) { input.attackQueued = false; ug.interact(ugT); }
        // cat house: click is a pounce, G is a meow
        if (ug.cat?.active) {
            if (input.attackQueued) { input.attackQueued = false; this.pounce(); }
            if (input.meowQueued) { input.meowQueued = false; this.meow(); }
        }
        input.meowQueued = false;
        // primary action: swing a tool, or eat held food
        if (input.attackQueued || input.attackHeld) {
            if (def?.tool?.model === "rod") {
                if (input.attackQueued && !view.swinging && this.fishing.click(eye, dir)) view.swing();
            } else if (def?.tool && !view.swinging) { view.swing(); this.sfx.swing(); }
            else if (def?.boat && input.attackQueued && !ug.active && !this.boats.on) {
                const ba = this.boatAim;
                if (!ba || !ba.ok) { hud.message(ba?.why || "Aim at open water"); this.sfx.denied(); }
                else {
                    this.boats.add(`b${this.netId}_${Math.random().toString(36).slice(2, 8)}`, ba.x, ba.z, ba.yaw);
                    this.inv.takeAt(hud.selected, 1); this.sfx.splash(0.9); view.place();
                    hud.message("In the water! Look at it and press E to get in.");
                }
            }
            else if (def?.frame && input.attackQueued && !ug.active) {
                const fa = this.frameAim;
                if (!fa || !fa.ok) { hud.message(fa?.reason || "Aim at a plain wall"); this.sfx.denied(); }
                else { this.paintings.place(fa); this.inv.takeAt(hud.selected, 1); this.sfx.place(); view.place(); hud.message("Hung. Press E on it to paint a picture."); }
            }
            else if (def?.flower !== undefined && input.attackQueued && !ug.active) {
                const fa = this.flowerAim(eye, dir);
                if (fa.why) { hud.message(fa.why); this.sfx.denied(); }
                else {
                    this.flowers.plant(def.flower, fa.x, fa.y, fa.z);
                    this.inv.takeAt(hud.selected, 1); this.sfx.place(); view.place();
                    this.resources.burst(new Vector3(fa.x, fa.y + 0.05, fa.z), "leaf", 4, 1.2);
                }
            }
            else if (def?.kind === "seed" && input.attackQueued && !ug.active) {
                const sp = this.seedAim(eye, dir);
                if (sp.why) { hud.message(sp.why); this.sfx.denied(); }
                else {
                    const p = this.saplings.plant(sp.x, sp.y, sp.z);
                    if (!p) { hud.message("Too many young trees already"); this.sfx.denied(); }
                    else { this.inv.takeAt(hud.selected, 1); this.sfx.place(); view.place(); this.resources.burst(new Vector3(sp.x, sp.y + 0.1, sp.z), "wood", 6, 2); hud.message("Planted. It will take about a day to grow into a big tree."); }
                }
            }
            else if (def?.instrument && input.attackQueued) { this.guitar.click(this.ivEye.set(player.pos.x, player.pos.y, player.pos.z)); view.place(); }
            else if (def?.kind === "food" && this.eatCd <= 0 && input.attackQueued) { this.eatCd = 0.9; this.eatSlot(hud.selected); }
            input.attackQueued = false;
        }

        // interact (pick up / forage / drink)
        if (useUg && ugT && input.interactQueued) { ug.interact(ugT); input.interactQueued = false; }
        if (!useStruct && !useWin && !useUg && !useDoor && !usePaint && !useStone && !useBoat && (input.interactQueued || input.interactHeld)) this.interact(t, dt, input.interactQueued);
        input.interactQueued = false;
    }

    /** cat house: leap forward and swat; catches the mouse if it is close enough */
    pounce() {
        const cat = this.under.cat, p = this.player;
        if (!cat?.active || this.stats.dead) return;
        this.swings++;
        this.onPounce?.();
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        if (p.onGround) { p.vel.x += fx * 2.3; p.vel.z += fz * 2.3; p.vel.y = 3.4; p.onGround = false; }
        else { p.vel.x += fx * 1.6; p.vel.z += fz * 1.6; }
        this.sfx.swing();
        if (cat.swat(p.pos.x, p.pos.z, p.yaw)) this.vr.haptic?.(0.8);
    }
    meow() {
        if (!this.under.cat?.active || this.meowCd > 0) return;
        this.meowCd = 0.8; this.sfx.meow(0.9); this.onMeow?.();
    }
    meowCd = 0;
    onPounce: (() => void) | null = null;
    onMeow: (() => void) | null = null;

    /** VR: a trigger pull (swung = false) or a real swing of the arm (swung = true). */
    vrPrimary(swung: boolean) {
        if (this.stats.dead || this.sleeping || this.hud.inventoryOpen || this.warp.inLevel || this.invaders.seated || this.under.air?.driving) return;
        if (this.under.cat?.active) { if (!swung) this.pounce(); return; }
        if (this.under.camp?.active) { if (!swung) this.input.attackQueued = true; return; }
        const held = this.equipped, def = held ? ITEMS[held.id] : null;
        if (def?.tool && def.tool.model !== "rod") {
            if (this.vrCd > 0) return;
            this.vrCd = 0.42;
            this.sfx.swing();
            this.swingHit();
            return;
        }
        if (!swung) this.input.attackQueued = true;
    }

    private hideBuildUi() {
        this.paintings.showGhost(null);
        this.doors.showGhost(null);
        this.hud.setBuild(null, false, false);
        this.building.hideGhost();
        this.structures.hideGhost();
    }
    private keyLabel(k: string) { return `<b>${this.vr.active ? "A" : this.input.touch ? "USE" : k}</b>`; }
    private cyclePiece(d: number) {
        this.pieceIdx = (this.pieceIdx + d + PIECES.length * 4) % PIECES.length;
        this.sfx.pickup();
    }
    private placeStructure(kind: PlaceKind, aim: PlaceAim) {
        const s = this.structures.place(kind, aim);
        if (!s) return;
        this.inv.takeAt(this.hud.selected, 1);
        this.sfx.place();
        this.view.place();
        this.vr.haptic?.(0.4);
        if (kind === "bed") { this.bed = s; this.hud.message("Bed placed. This is now your respawn point."); }
        else if (kind === "sleeping_bag") { this.bed = s; this.hud.message("Sleeping bag rolled out. This is now your respawn point."); }
    }
    private removePiece(p: Piece) {
        const why = this.building.canRemove(p);
        if (why) { this.hud.message(why); this.sfx.denied(); return; }
        const cost = PIECE_INFO.find((q) => q.kind === p.kind)!.cost;
        this.building.remove(p);
        this.give("wood", Math.floor(cost / 2));
        this.sfx.remove();
    }

    /** Tap vs hold on E: a quick tap runs `onTap`, holding for a moment runs `onDone` (picking something up, say). */
    private runHold(dt: number, target: object | null, onTap: () => void, onDone: () => void) {
        const { input, hud } = this;
        if (!target) { if (this.hold) { this.hold = null; hud.setHold(0); } return; }
        if (input.interactQueued) { this.hold = { target, t: 0 }; input.interactQueued = false; }
        const h = this.hold;
        if (!h) return;
        if (h.target !== target) { this.hold = null; hud.setHold(0); return; }
        if (input.interactHeld) {
            h.t += dt;
            hud.setHold(h.t > 0.25 ? h.t / HOLD_TIME : 0);
            if (h.t >= HOLD_TIME) { this.hold = null; hud.setHold(0); onDone(); }
        } else {
            this.hold = null;
            hud.setHold(0);
            if (h.t < 0.45) onTap();
        }
    }

    private promptStructure(s: Structure) {
        const hint = (tap: string) => `${this.keyLabel("E")} ${tap} &nbsp;·&nbsp; hold ${this.keyLabel("E")} pick up`;
        let name = STRUCT_NAME[s.kind];
        if (s.kind === "campfire" || s.kind === "furnace") name += s.lit ? " (burning)" : "";
        const tap = s.kind === "bed" || s.kind === "sleeping_bag" ? "sleep / set respawn" : s.kind === "workbench" ? "craft" : s.kind === "flower_pot" ? (s.inv?.slots[0] ? "change the flower" : "plant a flower") : "open";
        if (s.kind === "torch" || s.kind === "rug" || s.kind === "lantern" || s.kind === "table" || s.kind === "cat_bed") return this.hud.setPrompt(name, `hold ${this.keyLabel("E")} pick up`, true);
        this.hud.setPrompt(name, hint(tap), true);
    }

    private updatePrompt(t: Target | null, def: (typeof ITEMS)[ItemId] | null) {
        const click = `<b>${this.vr.active ? "Swing" : this.input.touch ? "HIT" : "Click"}</b>`;
        const key = (k: string, label: string) => `${this.keyLabel(k)} ${label}`;
        if (!t) return this.hud.setPrompt(null);
        switch (t.type) {
            case "pickup": {
                const d = ITEMS[t.pickup.id];
                return this.hud.setPrompt(d.name + (t.pickup.count > 1 ? ` ×${t.pickup.count}` : ""), key("E", "pick up"), true);
            }
            case "spring":
                return this.hud.setPrompt("Fresh spring", this.stats.thirst >= 99 ? "You are not thirsty" : key("E", "hold to drink"), true);
            case "node": {
                const n = t.node;
                if (n.gather === "berries") return this.hud.setPrompt(n.name, key("E", "pick berries"), true);
                const rate = def?.tool?.gather[n.gather] ?? 0;
                if (!def?.tool) return this.hud.setPrompt(n.name, "Equip a tool to gather", false);
                if (rate <= 0) return this.hud.setPrompt(n.name, "This tool can’t gather that", false);
                if (t.dist > def.tool.reach) return this.hud.setPrompt(n.name, "Move closer", false);
                return this.hud.setPrompt(n.name, `${click} gather ${GATHER_LABEL[n.gather]}`, true);
            }
            case "sea":
                return this.hud.setPrompt(null);
            case "flower": {
                const f = FLOWERS[t.hit.k], plant = def?.flower !== undefined ? ` &nbsp;·&nbsp; ${click} plant yours here` : "";
                return this.hud.setPrompt(t.hit.planted ? `${f.name} (planted)` : f.name, key("E", t.hit.planted ? "pick it up" : "pick") + plant, true);
            }
        }
    }

    private interact(t: Target | null, dt: number, pressed: boolean) {
        const { hud, inv, stats } = this;
        if (!t) {
            const held = this.equipped;
            if (pressed && held && ITEMS[held.id].kind === "food" && this.eatCd <= 0) { this.eatCd = 0.9; this.eatSlot(hud.selected); }
            return;
        }
        if (t.type === "flower" && pressed) {
            const h = t.hit, id = FLOWERS[h.k].id as ItemId;
            if (this.inv.canFit(id, 1) <= 0) { this.hud.message("Inventory full"); this.sfx.denied(); return; }
            if (h.planted) { if (!this.flowers.unplant(h.planted.nid)) return; }
            else if (!this.flowers.pickWild(h.wild)) return;
            this.inv.add(id, 1); this.hud.gain(id, 1);
            this.sfx.pickup(); this.view.reach();
            this.resources.burst(new Vector3(h.x, h.y + 0.15, h.z), "leaf", 3, 1);
            return;
        }
        if (t.type === "pickup" && pressed) {
            const p = t.pickup;
            const fit = inv.canFit(p.id, p.count);
            if (fit <= 0) { hud.message("Inventory full"); this.sfx.denied(); return; }
            inv.add(p.id, fit, p.dur);
            hud.gain(p.id, fit);
            this.sfx.pickup();
            this.view.reach();
            this.vr.haptic?.(0.25);
            if (fit >= p.count) this.resources.pickups.remove(p);
            else this.resources.pickups.setCount(p, p.count - fit);
        } else if (t.type === "node" && t.node.gather === "berries" && pressed) {
            const n = 2 + Math.floor(Math.random() * 3);
            const fit = inv.canFit("berries", n);
            if (fit <= 0) { hud.message("Inventory full"); this.sfx.denied(); return; }
            inv.add("berries", fit);
            hud.gain("berries", fit);
            const fib = 1 + Math.floor(Math.random() * 2);
            if (inv.canFit("fiber", fib) >= fib) { inv.add("fiber", fib); hud.gain("fiber", fib); }
            this.resources.pick(t.node);
            this.sfx.pickup();
            this.view.reach();
            this.vr.haptic?.(0.25);
        } else if (t.type === "spring") {
            if (stats.thirst < 99) {
                stats.drink(18 * dt);
                this.drinking = true;
                if (this.drinkCd <= 0) { this.sfx.drink(); this.drinkCd = 0.38; }
            } else if (pressed) hud.message("You are not thirsty");
        } else if (t.type === "sea" && pressed && this.seaCd <= 0) {
            this.seaCd = 3;
            hud.message("Seawater is too salty to drink. Look for a freshwater spring.");
            this.sfx.denied();
        }
    }

    /** The moment a swing connects. */
    private swingHit() {
        const held = this.equipped;
        const def = held ? ITEMS[held.id] : null;
        if (!def?.tool || this.stats.dead) return;
        this.swings++;
        const { player } = this;
        const eye = this.vr.active ? this.vr.eye : player.eye;
        if (this.vr.active) this.dir.copyFrom(this.vr.dir);
        else {
            const cp = Math.cos(player.pitch);
            this.dir.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
        }
        if (def.tool.model === "rod") return;
        const ug = this.under;
        const t = ug.active ? null : this.resources.findTarget(eye, this.dir, def.tool.reach, this.assist);
        const an = ug.active ? null : this.fauna.raycast(eye, this.dir, def.tool.reach, this.assist);
        // a pickaxe-class swing: mining ore underground, or digging for the way down
        if (ug.swing(eye, this.dir, held!.id, t && t.type === "node" ? t.dist : 99, this.assist)) { this.vr.haptic?.(0.6); this.wearHeld(); return; }
        const pl = this.net.rayPlayer?.(eye, this.dir, def.tool.reach) ?? null;
        if (pl && (!an || pl.dist < an.dist) && (!t || t.type !== "node" || pl.dist < t.dist)) {
            this.net.hitPlayer?.(pl.id, def.tool.dmg * (0.85 + Math.random() * 0.3));
            this.sfx.thwack();
            player.shake(0.35);
            this.resources.burst(eye.add(this.dir.scale(pl.dist)), "flesh", 7);
            this.vr.haptic?.(0.8);
            this.wearHeld();
            return;
        }
        const sk = ug.active ? null : this.stalkers.raycast(eye, this.dir, def.tool.reach, this.assist);
        if (sk && (!an || sk.dist < an.dist) && (!t || t.type !== "node" || sk.dist < t.dist)) { this.hitStalker(sk.s); return; }
        const md = ug.active ? null : this.druids.raycast(eye, this.dir, def.tool.reach);
        if (md !== null && (!an || md < an.dist) && (!t || t.type !== "node" || md < t.dist)) {
            this.druids.hit(def.tool.dmg, player.pos.x, player.pos.z);
            player.shake(0.3); this.resources.burst(eye.add(this.dir.scale(md)), "leaf", 8); this.vr.haptic?.(0.8);
            this.wearHeld();
            return;
        }
        if (an && (!t || t.type !== "node" || an.dist < t.dist)) { this.hitAnimal(an.a, def.tool.dmg); return; }
        if (!t) { this.sfx.hit("leaf"); return; }
        this.vr.haptic?.(0.55);
        if (t.type !== "node" || t.node.gather === "berries") { this.sfx.hit("leaf"); return; }
        const n = t.node;
        const gk = n.gather as GatherKind;
        const rate = def.tool.gather[gk] ?? 0;
        if (rate <= 0) { this.sfx.denied(); return; }

        const item = GATHER_ITEM[gk];
        let amount = Math.max(1, Math.round(rate * (0.8 + Math.random() * 0.4)));
        amount = Math.min(amount, Math.ceil(n.left));
        const fit = this.inv.canFit(item, amount);
        if (fit <= 0) { this.hud.message("Inventory full"); this.sfx.denied(); return; }
        this.inv.add(item, fit);
        this.hud.gain(item, fit);
        if (n.kind === "palm" && Math.random() < 0.45) this.give("fiber", 1 + Math.floor(Math.random() * 3));
        const wasPlanted = n.pool !== undefined;
        const fx: HitFx = n.kind === "stone" ? "stone" : n.kind === "ore" ? "ore" : "wood";
        this.resources.burst(t.point, fx, fx === "wood" ? 11 : 9);
        if (n.kind === "palm" || n.kind === "tree") this.resources.burst(t.point.add(new Vector3(0, 1.8 + Math.random() * 1.5, 0)), "leaf", 5);
        this.player.shake(fx === "wood" ? 0.22 : 0.3);
        this.sfx.hit(fx);
        const emptied = this.resources.take(n, fit, player.pos.x, player.pos.z);
        if (emptied && n.fall) this.sfx.creak();
        // felling a tree sometimes shakes a sapling loose
        if (emptied && (n.kind === "palm" || n.kind === "tree") && Math.random() < (wasPlanted ? 0.4 : 0.12)) { this.give("sapling", 1); this.hud.message("A sapling fell out of the tree!"); }
        this.wearHeld();
    }

    // ------------------------------------------------------------ boats
    /** true while I sit at a boat's helm (VR: the sticks steer it) */
    get boatHelm() { return this.boats.atHelm; }
    private takeHelm(b: Boat) {
        const p = this.player;
        if (p.ride || this.stats.dead) return;
        if (!this.boats.takeHelm(b)) { this.hud.message("Somebody else is steering"); this.sfx.denied(); return; }
        if (!this.vr.active) { p.yaw = b.yaw; p.pitch = 0; } // facing the bow
        p.ride = () => {
            if (this.input.jumpQueued) { this.leaveHelm(); return false; }
            return this.boats.carryHelm(p.pos, p);
        };
        const vr = this.vr.active, touch = this.input.touch;
        this.hud.message(vr ? "At the wheel: left stick steers, right trigger fills the sails · A let go" : touch ? "At the wheel: the stick steers and sails · USE let go" : "At the wheel: W / S sails, A / D steer, Shift full sail · E or Space let go");
    }
    private leaveHelm() {
        const p = this.player;
        this.boats.leaveHelm();
        p.ride = null; p.onGround = true; p.vel.set(0, 0, 0); p.lastY = p.pos.y;
    }
    private pickupBoat(b: Boat) {
        if (this.boats.aboard(b)) { this.hud.message("Somebody is aboard"); this.sfx.denied(); return; }
        if (this.inv.add("boat", 1) > 0) { this.hud.message("No room in your pockets"); this.sfx.denied(); return; }
        this.boats.remove(b); this.sfx.pickup(); this.hud.message("Boat picked up");
    }

    // ------------------------------------------------------------ lost at sea: the giant wave, the black, the beach
    private startWreck() {
        if (this.wreckT >= 0) return;
        this.wreckT = 0; this.wreckStage = 0;
        document.getElementById("fade")?.classList.add("now");
        this.hud.fade(true, "");
        this.vr.haptic?.(1);
        this.fishing.cancel(true);
        if (this.hud.inventoryOpen) this.setInventory(false);
    }
    private updateWreck(dt: number) {
        if (this.wreckT < 0) return;
        const t0 = this.wreckT, t = (this.wreckT += dt), p = this.player;
        if (t0 < 0.3 && t >= 0.3) {
            // the boat is gone; you come round on the beach (everybody a little apart), the storm is over
            const b = this.boats.on;
            this.boats.leaveHelm();
            if (b) this.boats.remove(b);
            this.boats.reset();
            this.weather?.calm(); this.net.calm?.();
            const s = this.spawn, k = (this.netId % 4) - 1.5, rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
            const x = s.x + rx * k * 2.4, z = s.z + rz * k * 2.4;
            this.wakeAt = { x, z, yaw: s.yaw };
            p.ride = null;
            p.teleport(x, this.wakeGround(x, z), z, s.yaw);
            p.ride = () => this.wakeRide();
            this.stats.hunger = Math.max(10, this.stats.hunger - 12); this.stats.thirst = Math.max(10, this.stats.thirst - 18);
        }
        if (t >= 4 && this.wreckStage === 0) { this.wreckStage = 1; this.lids(0); this.hud.fade(false); }
        if (t >= 4) { this.lids(lidOpen(t - 4)); this.eyeBlur = 9 * (1 - smooth01((t - 4) / 6.2)); }
        if (t >= 11) {
            this.wreckT = -1; this.eyeBlur = 0; this.lids(-1);
            document.getElementById("fade")?.classList.remove("now");
            this.hud.message("You wake up on the beach, soaked through. The boat is gone… but you still have all your things.");
        }
    }
    private wakeGround(x: number, z: number) { return Math.max(heightAt(x, z), this.building.ground(x, z, heightAt(x, z) + 1)); }
    /** lying on your back on the sand, then sitting up and getting to your feet */
    private wakeRide(): boolean {
        const p = this.player, t = this.wreckT, w = this.wakeAt;
        if (t < 0) return false;
        const up = smooth01((t - 8.4) / 2.4);
        const eyeH = 0.26 + (p.body.eye - 0.26) * up;
        p.pos.set(w.x, this.wakeGround(w.x, w.z) + eyeH - p.body.eye, w.z);
        p.vel.set(0, 0, 0);
        if (!this.vr.active) p.pitch = 1.25 * (1 - up);
        return t < 11;
    }
    /** the eyelids over the screen: -1 gone, 0 shut .. 1 open */
    private lids(o: number) {
        const el = (this.lidsEl ??= document.getElementById("lids"));
        if (!el) return;
        el.style.display = o < 0 ? "none" : "block";
        if (o >= 0) el.style.setProperty("--o", o.toFixed(3));
    }

    // ------------------------------------------------------------ Mario's warp pipe and the secret level
    private updateWarp(dt: number) {
        const w = this.warp, dr = this.druids, p = this.player;
        w.place(this.under.sites?.door ?? null);
        if (w.running) dr.away = true;
        const alive = dr.phase === "alive";
        w.setShown(alive && !dr.away);
        if (alive && !dr.away && w.pipeAt && !this.pipeHinted) { this.pipeHinted = true; this.hud.message("A green warp pipe has popped up by the old hut with the odd door. Lead Mario to it!"); }
        if (!alive) this.pipeHinted = false;
        // host: Mario has followed somebody to the pipe: in they all go (everybody near it)
        if (!w.remote && !w.running && alive && !dr.away && w.pipeAt) {
            const P = w.pipeAt, m = dr.marioPos();
            if (Math.hypot(m.x - P.x, m.z - P.z) < 4.5) {
                const pl = dr.players();
                if (pl.some((q) => Math.hypot(q.x - P.x, q.z - P.z) < 8)) {
                    dr.away = true;
                    w.hostStart(pl.filter((q) => Math.hypot(q.x - P.x, q.z - P.z) < 25).map((q) => q.id));
                }
            }
        }
        // in the level: the body waits on the island (hidden from the others), the keys / stick / buttons play the level
        if (w.inLevel && !p.ride) p.ride = () => this.warp.inLevel;
        const inp = this.input;
        // (VR: the screen goes up in front of your eyes, the way your head faces)
        const vr = this.vr.active && w.inLevel ? { on: true, head: this.vr.head ?? this.vr.eye, fwd: this.vr.headDir ?? this.vr.dir } : null;
        w.update(dt, { x: inp.move.x, jump: inp.jumpHeld || inp.move.y > 0.6, run: inp.wantsSprint }, vr);
    }

    /** footprints in the sand, and the birds and flamingos (which take off when someone comes too close) */
    private updateNature(dt: number, hour: number, away: boolean) {
        const p = this.player, me = p.pos, onIsland = !away && Math.abs(me.x) < 500 && Math.abs(me.z) < 500 && me.y < heightAt(me.x, me.z) + 60;
        const W = this.walkers; W.length = 0;
        const threats: { x: number; z: number; fast: boolean }[] = [];
        if (onIsland) {
            if (!this.stats.dead && p.mode === "walk" && !p.cave) W.push({ key: "me", x: me.x, y: me.y, z: me.z, kind: "foot", fast: p.sprinting });
            threats.push({ x: me.x, z: me.z, fast: p.sprinting });
            for (const o of this.resources.others() as { id?: number; x: number; y?: number; z: number }[]) {
                if (Math.abs(o.x) > 500 || Math.abs(o.z) > 500) continue;
                const y = o.y ?? heightAt(o.x, o.z);
                W.push({ key: "p" + (o.id ?? 0), x: o.x, y, z: o.z, kind: "foot" });
                threats.push({ x: o.x, z: o.z, fast: false });
            }
            this.fauna.animals.forEach((a, i) => {
                if (a.kind === "crab" || a.state === "dead" || Math.abs(a.x - me.x) > 80 || Math.abs(a.z - me.z) > 80) return;
                W.push({ key: "a" + i, x: a.x, y: a.y, z: a.z, kind: a.kind === "boar" ? "hoof" : "paw" });
                threats.push({ x: a.x, z: a.z, fast: true });
            });
            for (const t of this.turtles.adults) if (t.st >= 1 && t.st <= 5) W.push({ key: "t" + t.id, x: t.x, y: heightAt(t.x, t.z), z: t.z, kind: "flipper" });
        }
        this.prints.update(dt, W);
        this.flowers.update(dt, me.x, me.z, onIsland);
        this.prints.mesh.visible = onIsland;
        this.birds.update(dt, me, threats, (this.weather?.rain ?? 0) > 0.35 ? 0 : hour, onIsland);
        this.flamingos.update(dt, me, threats, hour, onIsland);
        // sea life: only near the sea. Some nights (about one in three) the sea glows: the host / solo player decides at dusk
        if (!this.net.bioRemote) {
            if (this.bioHour >= 0 && this.bioHour < 19.6 && hour >= 19.6) { this.bioTonight = Math.random() < 0.35; this.net.bio?.(this.bioTonight); }
            if (this.bioHour >= 0 && this.bioHour < 5.6 && hour >= 5.6) { this.bioTonight = false; this.net.bio?.(false); }
            this.bioHour = hour;
        }
        {
            const nearSea = onIsland && (p.underwater || heightAt(me.x, me.z) < 6);
            const waders = nearSea && p.waterDepth > 0.05 && !this.stats.dead ? [{ x: me.x, y: me.y, z: me.z, moving: p.moving }] : [];
            if (nearSea) for (const o of this.resources.others() as { x: number; y?: number; z: number }[]) if (Math.abs(o.x) < 500 && heightAt(o.x, o.z) < -0.05) waders.push({ x: o.x, y: o.y ?? 0, z: o.z, moving: true });
            const night = hour < 5.6 || hour > 19.3;
            this.sealife.bioTarget = this.bioTonight && night ? 1 : 0;
            this.sealife.update(dt, me, nearSea ? [{ x: me.x, y: me.y, z: me.z }] : [], waders, nearSea);
        }
        // weather: rain stops under a roof (and in the caves, and under water); the sky, sea and plants follow the host's weather
        this.roofT -= dt;
        if (this.roofT <= 0) { this.roofT = 0.4; this.roofed = onIsland && this.structures.ceilingAt?.(me.x, me.y, me.z) != null; }
        // boats, and the storm out at sea (it only ever blows round whoever is far out)
        this.boats.setSelf(me.x, me.z);
        {
            const bx0 = me.x, by0 = me.y, bz0 = me.z;
            this.boats.update(dt, performance.now() / 1000, { x: this.input.move.x, y: this.input.move.y, boost: this.input.wantsSprint }, me, p,
                (!p.ride || this.boats.atHelm) && !this.stats.dead && !this.sleeping && p.mode !== "fly", !onIsland || !!p.cave || this.stats.dead || this.wreckT >= 0);
            // the boat moved after the player did this frame: the eyes go with it
            if (this.boats.on) { p.eye.x += me.x - bx0; p.eye.y += me.y - by0; p.eye.z += me.z - bz0; }
        }
        this.updateWreck(dt);
        const wx = this.weather;
        if (wx) {
            wx.sea = this.boats.storm;
            const local = onIsland && !p.cave;
            wx.update(dt, this.vr.active ? this.vr.eye : p.eye, local, this.roofed, p.underwater);
            this.druids.update(dt, me, onIsland && !p.cave);
            this.updateWarp(dt);
            // the water slide: walk into its ladder or its chute to get on
            if (onIsland && !p.ride && !this.stats.dead && !this.sleeping) {
                const go = this.slide.check(me, p.yaw, this.input.move.y || (this.input.interactQueued ? 1 : 0));
                if (go === "slide") {
                    this.slide.beginRide();
                    p.ride = (d) => this.slide.ride(d, p.pos, p.vel, p, this.vr.active);
                    this.hud.message("Wheee!");
                } else if (go === "ladder") {
                    this.slide.beginClimb();
                    p.ride = (d) => this.slide.climb(d, p.pos, p.vel, this.input.move.y, this.input.jumpHeld);
                }
            }
            // the alien invasion: the cannon points where you look (your head in VR); click / trigger fires
            {
                const iv = this.invaders, inp = this.input;
                const e = this.vr.active ? this.vr.head ?? this.vr.eye : p.eye;
                this.ivEye.set(e.x, e.y, e.z);
                if (this.vr.active) { const d = this.vr.headDir ?? this.vr.dir; this.ivDir.set(d.x, d.y, d.z); }
                else { const cp = Math.cos(p.pitch); this.ivDir.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp); }
                iv.update(dt, this.ivEye, this.ivDir, iv.seated && !this.stats.dead && (inp.attackHeld || inp.attackQueued));
                if (iv.seated) inp.attackQueued = false;
                this.clock.dawn = iv.sky;
            }
            this.offshore.tick(hour, wx.kind === 0);
            this.offshore.update(dt, me, performance.now() / 1000, wx.rough, 1 - (this.clock.day ?? 1), !onIsland || !!p.cave);
            this.sfx.setWeather(local && !p.underwater ? wx.rain : 0, local ? Math.max(0, Math.min(1, (wx.wind - 1.4) / 2.8)) : 0, this.roofed, dt);
        }
    }

    /** where a sapling would go: the ground along the view ray (natural terrain only) */
    private seedAim(eye: Vector3, dir: Vector3): { x: number; y: number; z: number; why: string } {
        let x = 0, y = 0, z = 0, found = false;
        for (let t = 0.6; t <= 4.4; t += 0.1) {
            x = eye.x + dir.x * t; y = eye.y + dir.y * t; z = eye.z + dir.z * t;
            const h = heightAt(x, z);
            if (y <= h + 0.05) { y = h; found = true; break; }
        }
        if (!found) return { x, y, z, why: "Aim at open ground" };
        if (this.building.ground(x, z, y + 1) > y + 0.25) return { x, y, z, why: "Not on a building" };
        return { x, y, z, why: this.saplings.check(x, z) };
    }

    /** where a flower would go: the ground along the view ray (natural terrain, not on buildings) */
    private flowerAim(eye: Vector3, dir: Vector3): { x: number; y: number; z: number; why: string } {
        let x = 0, y = 0, z = 0, found = false;
        for (let t = 0.5; t <= 4.2; t += 0.05) {
            x = eye.x + dir.x * t; y = eye.y + dir.y * t; z = eye.z + dir.z * t;
            const h = heightAt(x, z);
            if (y <= h + 0.02) { y = h; found = true; break; }
        }
        if (!found) return { x, y, z, why: "Aim at the ground" };
        if (this.building.ground(x, z, y + 1) > y + 0.25) return { x, y, z, why: "Flowers grow in the ground, not on floors" };
        return { x, y, z, why: this.flowers.check(x, z) };
    }

    private hitStalker(s: Stalkers["list"][number]) {
        const p = this.player;
        if (this.stalkers.remote) { this.net.hitStalker?.(this.stalkers.indexOf(s), p.pos.x, p.pos.z); this.fauna.onBlood?.(s.x, s.y + 1.4, s.z, 6); }
        else this.stalkers.hit(s, p.pos.x, p.pos.z);
        this.sfx.thwack(); this.vr.haptic?.(0.8); p.shake(0.3); this.wearHeld();
    }

    private hitAnimal(a: Animal, dmg: number) {
        const p = this.player;
        if (this.fauna.remote) { // the host owns the animals
            this.net.hitAnimal?.(this.fauna.indexOf(a), dmg * (0.85 + Math.random() * 0.3), p.pos.x, p.pos.z);
            this.fauna.hurtFx(a);
            this.sfx.thwack();
            p.shake(0.35);
            this.wearHeld();
            return;
        }
        const killed = this.fauna.damage(a, dmg * (0.85 + Math.random() * 0.3), p.pos.x, p.pos.z);
        this.sfx.thwack();
        this.vr.haptic?.(0.8);
        p.shake(0.35);
        if (killed) this.hud.message(`${a.def.name} down. Pick up the meat${a.def.extra ? " and hide" : ""}.`);
        this.wearHeld();
    }

    private wearHeld() {
        const e = this.equipped;
        if (!e || e.dur === undefined) return;
        const name = ITEMS[e.id].name;
        if (this.inv.wear(this.hud.selected)) {
            const left = this.equipped;
            this.hud.message(left && left.id === e.id ? `One ${name.toLowerCase()} crumbled (${left.count} left)` : `Your ${name} broke!`);
            this.sfx.tool_break();
            this.fishing.cancel(true);
        } else if (e.dur === 10 || e.dur === 3) this.hud.message(`Your ${name} is wearing out`);
    }
}

const smooth01 = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
/** coming round: the eyes flicker open, close again, open a little more ... and stay open */
const LID_KEYS = [[0, 0], [0.9, 0], [1.6, 0.22], [2.1, 0.03], [2.5, 0.03], [3.3, 0.45], [3.7, 0.16], [4.1, 0.2], [5.4, 1]];
function lidOpen(t: number) {
    for (let i = 1; i < LID_KEYS.length; i++) {
        const [t1, v1] = LID_KEYS[i], [t0, v0] = LID_KEYS[i - 1];
        if (t <= t1) return v0 + (v1 - v0) * smooth01((t - t0) / (t1 - t0));
    }
    return 1;
}
