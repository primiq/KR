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
    clock: { hour: number };
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
    private natureRoot = new THREE.Scene();
    private natureMirror: ThreeMirror;
    private walkers: Walker[] = [];
    /** switch the presentation between the island and the caves (set by main) */
    onUnderground: ((on: boolean) => void) | null = null;
    private faunaMirror: ThreeMirror;
    readonly map: MapView;
    private fishPrompt: string | null = null;
    private deathMark: { x: number; z: number } | null = null;
    /** multiplayer: friends and pings for the map (set by net/sync) */
    mapExtras: { friends?: () => { x: number; z: number; name: string; color: string }[]; pings?: () => { x: number; z: number; name: string; color: string; age: number }[] } = {};
    /** VR: aim comes from the hand, not the head; the VR rig fills this in every frame */
    readonly vr = { active: false, eye: new Vector3(), dir: new Vector3(0, 0, -1), haptic: null as null | ((strength: number) => void) };
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

    get armorPct() { let t = 0; for (const s of this.worn.slots) if (s) t += ITEMS[s.id].armor?.def ?? 0; return Math.min(75, t); }
    get armorCode() { let c = 0; for (const s of this.worn.slots) c = c * 10 + (s ? ITEMS[s.id].armor?.tier ?? 0 : 0); return c; }
    get equipped() { return this.inv.slots[this.hud.selected]; }
    get equippedDef() { const e = this.equipped; return e ? ITEMS[e.id] : null; }
    get uiBlocking() { return this.hud.inventoryOpen || this.map.open || this.stats.dead || this.sleeping; }
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
        this.player.world = {
            ground: (x, z, y) => this.building.ground(x, z, y),
            resolve: (x, z, r, feetY, out) => this.building.resolve(x, z, r, feetY, out),
        };
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
        this.birds = new Birds(o.vegetation);
        this.natureRoot.add(this.prints.mesh, this.birds.group, this.flamingos.group);
        this.natureMirror = new ThreeMirror(o.scene, this.natureRoot, null, o.shadows);
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
            if (this.stats.dead) return;
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
        this.hurtCd -= dt; this.vrCd -= dt; this.eatCd -= dt; this.seaCd -= dt; this.drinkCd -= dt;
        this.resources.update(dt, player.pos.x, player.pos.z);
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
        view.visible(!stats.dead && !this.vr.active);

        stats.godMode = player.mode === "fly";
        if (!stats.dead) stats.update({ dt, moving: player.moving && player.mode !== "fly", sprinting: player.sprinting && player.mode !== "fly", swimming: player.mode === "swim", jumped: player.jumped, underwater: player.underwater });
        if (stats.dead && !this.deathHandled) this.onDeath();
        hud.setVitals(stats);

        if (stats.dead || this.sleeping) { hud.setPrompt(null); this.hideBuildUi(); return; }

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
        const wh = ug.active ? null : this.building.findPiece(eye, dir, 3.2);
        const useWin = !!wh && wh.piece.kind === "window" && (!t || wh.dist < t.dist + 0.3) && (!st || wh.dist < st.dist);
        if (useWin && wh) {
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
            const click = `<b>${this.vr.active ? "Swing" : this.input.touch ? "HIT" : "Click"}</b>`;
            if (this.fishPrompt && def?.tool?.model === "rod") hud.setPrompt(this.fishPrompt, "", true);
            else if (an && (!t || an.dist < t.dist)) {
                const a = an.a, hostile = a.kind === "boar" && a.state === "chase";
                hud.setPrompt(`${a.def.name}  ${Math.max(1, Math.ceil(a.hp))}/${a.def.hp}`, def?.tool && an.dist <= def.tool.reach ? `${click} attack` : an.dist > (def?.tool?.reach ?? 0) ? "Move closer" : "", hostile);
            } else this.updatePrompt(t, def);
        }

        // primary action: swing a tool, or eat held food
        if (input.attackQueued || input.attackHeld) {
            if (def?.tool?.model === "rod") {
                if (input.attackQueued && !view.swinging && this.fishing.click(eye, dir)) view.swing();
            } else if (def?.tool && !view.swinging) { view.swing(); this.sfx.swing(); }
            else if (def?.kind === "food" && this.eatCd <= 0 && input.attackQueued) { this.eatCd = 0.9; this.eatSlot(hud.selected); }
            input.attackQueued = false;
        }

        // interact (pick up / forage / drink)
        if (useUg && ugT && input.interactQueued) { ug.interact(ugT); input.interactQueued = false; }
        if (!useStruct && !useWin && !useUg && (input.interactQueued || input.interactHeld)) this.interact(t, dt, input.interactQueued);
        input.interactQueued = false;
    }

    /** VR: a trigger pull (swung = false) or a real swing of the arm (swung = true). */
    vrPrimary(swung: boolean) {
        if (this.stats.dead || this.sleeping || this.hud.inventoryOpen) return;
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
        }
    }

    private interact(t: Target | null, dt: number, pressed: boolean) {
        const { hud, inv, stats } = this;
        if (!t) {
            const held = this.equipped;
            if (pressed && held && ITEMS[held.id].kind === "food" && this.eatCd <= 0) { this.eatCd = 0.9; this.eatSlot(hud.selected); }
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
        this.prints.mesh.visible = onIsland;
        this.birds.update(dt, me, threats, hour, onIsland);
        this.flamingos.update(dt, me, threats, hour, onIsland);
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
