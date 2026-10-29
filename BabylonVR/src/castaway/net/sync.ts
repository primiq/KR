// Glue between the game and a Session: turns local world changes into events, applies other players' events,
// builds / applies the join snapshot and drives the remote avatars. Ported from Castaway (same event keys).
import { type Scene, Vector3 } from "@babylonjs/core";
import type { Game } from "../game/game";
import type { FaunaTarget } from "../game/fauna";
import type { Structure } from "../game/structures";
import { heightAt } from "../world/island";
import { Avatars, playerColor } from "./avatars";
import { parseOutfit } from "./outfit";
import { type PState, Session, type VRPoseData } from "./session";
import { applyWorld, captureWorld, packInv, unpackInv } from "./world";

export class WorldSync {
    readonly avatars: Avatars;
    private lastSent = "";
    private lastOpen: Structure | null = null;
    private stationT = 0;
    onLost: ((why: string, fatal?: boolean) => void) | null = null;
    onChat: ((from: string, id: number, text: string) => void) | null = null;
    /** set by the VR layer: head and hand poses of this player, or null outside a headset */
    vrPose: (() => VRPoseData | null) | null = null;
    private pings: { x: number; z: number; name: string; color: string; t: number }[] = [];
    /** container nid -> player id who has it open */
    private users = new Map<string, number>();
    /** host: player id -> when they went to bed */
    private votes = new Map<number, number>();
    private orig: { sound: Game["fauna"]["onSound"]; blood: Game["fauna"]["onBlood"]; kill: Game["fauna"]["onKill"] } | null = null;
    private lastHitter = 0;
    private slowTick = 0;

    constructor(
        private game: Game,
        readonly session: Session,
        scene: Scene,
        shadows: boolean,
        private clock: { hour: number },
        surfaceAt: (x: number, z: number) => number,
    ) {
        this.avatars = new Avatars(scene, shadows);
        this.avatars.surfaceAt = surfaceAt;
        const { resources, building, structures } = game;
        const id = session.myId;
        resources.pickups.idPrefix = `p${id}-`;
        structures.idPrefix = `s${id}-`;

        // ---- local changes -> events
        resources.onNode = (n, h) => session.sendEvent({ k: "n", i: resources.nodeId(n), l: +n.left.toFixed(2), x: +h.x.toFixed(1), z: +h.z.toFixed(1) });
        resources.pickups.onSpawn = (p) => session.sendEvent({ k: "ps", n: p.nid, id: p.id, c: p.count, d: p.dur, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
        resources.pickups.onRemove = (p) => session.sendEvent({ k: "pr", n: p.nid });
        resources.pickups.onCount = (p) => session.sendEvent({ k: "pc", n: p.nid, c: p.count });
        building.onPlace = (p) => session.sendEvent({ k: "bp", t: p.kind, i: p.i, j: p.j, a: p.axis, H: +p.H.toFixed(3), L: p.L, d: p.dir });
        building.onRemove = (p) => session.sendEvent({ k: "br", t: p.kind, i: p.i, j: p.j, a: p.axis, L: p.L });
        building.onUpgrade = (p) => session.sendEvent({ k: "bs", t: p.kind, i: p.i, j: p.j, a: p.axis, L: p.L });
        building.onWindow = (p, o, s) => session.sendEvent({ k: "bw", i: p.i, j: p.j, a: p.axis, L: p.L, o: o ? 1 : 0, s });
        structures.onPlace = (s) => session.sendEvent({ k: "sp", n: s.nid, t: s.kind, x: +s.x.toFixed(2), y: +s.y.toFixed(3), z: +s.z.toFixed(2), r: +s.yaw.toFixed(3) });
        structures.onRemove = (s) => session.sendEvent({ k: "sr", n: s.nid });

        game.netId = id;
        game.under.onEvent = (e) => session.sendEvent(e);
        game.flowers.idPrefix = `f${id}-`;
        game.flowers.onPickWild = (i) => session.sendEvent({ k: "fw", i });
        game.flowers.onPlant = (p) => session.sendEvent({ k: "fa", n: p.nid, s: p.k, x: +p.x.toFixed(2), y: +p.y.toFixed(3), z: +p.z.toFixed(2), r: +p.rot.toFixed(2) });
        game.flowers.onUnplant = (p) => session.sendEvent({ k: "fd", n: p.nid });
        game.net.hitPlayer = (to, dmg) => session.sendEvent({ k: "ph", to, d: +dmg.toFixed(1), x: +game.player.pos.x.toFixed(1), z: +game.player.pos.z.toFixed(1) });
        game.net.rayPlayer = (eye, dir, reach) => this.rayPlayer(eye, dir, reach);
        // ---- wildlife: the host simulates, clients mirror
        const fauna = game.fauna;
        if (!session.isHost) { fauna.remote = true; game.turtles.remote = true; }
        // weather: the host decides, the others follow
        if (game.weather) {
            game.weather.remote = !session.isHost;
            game.weather.onChange = session.isHost ? (s, l) => session.sendEvent({ k: "we", s, l: Math.round(l) }) : null;
        }
        game.net.targets = () => this.targets();
        game.net.bioRemote = !session.isHost;
        if (session.isHost) game.net.bio = (on) => session.sendEvent({ k: "bi", v: on ? 1 : 0 });
        game.net.hitAnimal = (i, dmg, px, pz) => session.sendEvent({ k: "ah", i, d: +dmg.toFixed(1), x: +px.toFixed(1), z: +pz.toFixed(1) });
        game.net.hurtRemote = (to, dmg, fx, fz, by) => session.sendEvent({ k: "hurt", to, d: dmg, x: +fx.toFixed(1), z: +fz.toFixed(1), by });
        if (session.isHost) {
            const sound = fauna.onSound, blood = fauna.onBlood;
            this.orig = { sound, blood, kill: fauna.onKill };
            fauna.onSound = (w, x, z) => { sound?.(w, x, z); session.sendEvent({ k: "as", w, x: +x.toFixed(1), z: +z.toFixed(1) }); };
            fauna.onBlood = (x, y, z, n) => { blood?.(x, y, z, n); session.sendEvent({ k: "ab", x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), n }); };
            fauna.onKill = (a) => session.sendEvent({ k: "ak", i: fauna.indexOf(a), by: this.lastHitter, nm: a.def.name });
            session.onFast = () => {
                const near = (x: number, z: number) => this.targets().some((t) => Math.hypot(t.x - x, t.z - z) < 135);
                session.sendEvent({ k: "an", r: fauna.exportState(near) });
                const tu = game.turtles.exportState(); if (tu.length) session.sendEvent({ k: "tu", r: tu });
                // the weather, for anyone who joined since it started
                if (++this.slowTick % 40 === 0) {
                    if (game.weather) session.sendEvent({ k: "we", s: game.weather.kind, l: Math.round(game.weather.left) });
                    session.sendEvent({ k: "bi", v: game.bioTonight ? 1 : 0 });
                }
            };
        }

        // ---- remote events -> world
        session.onEvent = (from, e) => this.apply(from, e);
        session.onJoin = (p) => game.hud.message(`${p.name} joined the island`);
        session.onLeave = (p) => {
            game.hud.message(`${p.name} left`);
            for (const [k, u] of this.users) if (u === p.id) this.users.delete(k);
            this.votes.delete(p.id);
        };
        session.snapshot = () => captureWorld(this.game);
        session.getHour = () => clock.hour;
        session.onPeriodic = () => this.broadcastStations();
        session.onHour = (h) => this.setHour(h);
        session.onDisconnect = (why, fatal) => {
            this.avatars.clear();
            this.detach();
            if (this.onLost) this.onLost(why, fatal);
            else game.hud.message(`${why}. You are playing solo now.`);
        };
        // ---- the host decides when nodes grow back (and never under anyone's nose)
        resources.autoRespawn = session.isHost;
        resources.others = () => this.avatars.positions;
        if (session.isHost) resources.onRespawn = (n) => session.sendEvent({ k: "nr", i: resources.nodeId(n) });
        // ---- containers: one user at a time
        game.net.inUse = (st) => {
            const u = this.users.get(st.nid);
            return u !== undefined && u !== session.myId ? session.players.get(u)?.name ?? "Someone" : null;
        };
        // ---- sleeping: morning comes when enough players have slept
        game.net.slept = () => { if (session.isHost) this.vote(0); else session.sendEvent({ k: "zz" }); };
        game.net.died = () => session.sendEvent({ k: "dd" });
        game.mapExtras.friends = () => this.avatars.positions.map((a) => ({ x: a.x, z: a.z, name: a.name, color: playerColor(a.id) }));
        game.mapExtras.pings = () => {
            const t = performance.now();
            this.pings = this.pings.filter((p) => t - p.t < 20000);
            return this.pings.map((p) => ({ x: p.x, z: p.z, name: p.name, color: p.color, age: (t - p.t) / 1000 }));
        };
        this.avatars.onStep = (x, y, z) => {
            const d = Math.hypot(x - game.player.pos.x, z - game.player.pos.z);
            if (d > 30) return;
            const h = heightAt(x, z);
            game.sfx.step(-h > 0.06 ? "water" : y > h + 0.2 ? "wood" : h < 2.0 ? "sand" : "grass", 0.75 * (1 - d / 30));
        };
    }

    /** Stop mirroring (session ended). The world stays as it is. */
    detach() {
        const { resources, building, structures } = this.game;
        resources.onNode = null;
        resources.pickups.onSpawn = resources.pickups.onRemove = resources.pickups.onCount = null;
        building.onPlace = building.onRemove = building.onUpgrade = null;
        building.onWindow = null;
        structures.onPlace = structures.onRemove = null;
        this.game.under.onEvent = null;
        this.game.flowers.onPickWild = this.game.flowers.onPlant = this.game.flowers.onUnplant = null;
        this.game.netId = 0;
        this.game.net = {};
        this.game.mapExtras = {};
        const f = this.game.fauna;
        if (f.remote) f.promote();
        if (this.game.turtles.remote) this.game.turtles.promote();
        if (this.game.weather) { this.game.weather.remote = false; this.game.weather.onChange = null; }
        if (this.orig) { f.onSound = this.orig.sound; f.onBlood = this.orig.blood; f.onKill = this.orig.kill; this.orig = null; }
        this.session.onFast = null;
        resources.autoRespawn = true;
        resources.others = () => [];
        resources.onRespawn = null;
    }

    /** Host: a player went to bed. */
    private vote(id: number) {
        const s = this.session, t = performance.now();
        this.votes.set(id, t);
        for (const [k, at] of this.votes) if (t - at > 25000 || !s.players.has(k)) this.votes.delete(k);
        const need = Math.ceil(s.players.size / 2), n = this.votes.size;
        if (n >= need) {
            this.votes.clear();
            this.clock.hour = 6.4;
            s.sendEvent({ k: "hr", h: 6.4 });
        } else {
            const m = `${s.players.get(id)?.name ?? "Someone"} is sleeping (${n}/${need} needed for morning)`;
            this.game.hud.message(m);
            s.sendEvent({ k: "zm", m });
        }
    }

    private setHour(h: number) {
        const a = this.clock;
        let d = h - a.hour;
        if (d > 12) d -= 24;
        if (d < -12) d += 24;
        if (Math.abs(d) > 0.08) a.hour = (h + 24) % 24;
        else a.hour = (a.hour + d * 0.5 + 24) % 24;
    }

    applySnapshot(snap: any) { applyWorld(this.game, snap); }

    // ------------------------------------------------------------------ remote events
    private apply(from: number, e: any) {
        const g = this.game, r = g.resources;
        switch (e.k) {
            case "n": {
                const n = r.nodeAt(e.i);
                if (!n) break;
                const hitter = this.avatars.positions.find((a) => a.id === from);
                const hx = hitter?.x ?? e.x, hz = hitter?.z ?? e.z;
                if (n.gather !== "berries" && e.l > 0) this.hitFx(n, hx, hz);
                r.applyNode(n, e.l, hx, hz);
                break;
            }
            case "ps": if (!r.pickups.byId.has(e.n)) r.pickups.spawn(e.id, e.c, e.x, e.y, e.z, e.d ?? undefined, e.n, true); break;
            case "pr": { const p = r.pickups.byId.get(e.n); if (p) r.pickups.remove(p, true); break; }
            case "pc": { const p = r.pickups.byId.get(e.n); if (p) p.count = e.c; break; }
            case "bp": g.building.placeRemote(e.t, e.i, e.j, e.a, e.H, e.L ?? 0, e.d ?? 0); break;
            case "bs": { const p = g.building.find(e.t, e.i, e.j, e.a, e.L ?? 0); if (p) g.building.upgrade(p, true); break; }
            case "bw": {
                const p = g.building.find("window", e.i, e.j, e.a, e.L ?? 0);
                if (p) {
                    g.building.setWindow(p, !!e.o, e.s < 0 ? -1 : 1, true);
                    if (Math.hypot(g.player.pos.x - p.group.position.x, g.player.pos.z - p.group.position.z) < 20) g.sfx.creak();
                }
                break;
            }
            case "br": { const p = g.building.find(e.t, e.i, e.j, e.a, e.L ?? 0); if (p) g.building.remove(p, true); break; }
            case "sp": if (!g.structures.list.some((s) => s.nid === e.n)) g.structures.place(e.t, { ok: true, reason: "", x: e.x, y: e.y, z: e.z, yaw: e.r }, e.n, true); break;
            case "sr": { const s = g.structures.list.find((q) => q.nid === e.n); if (s && g.openStruct !== s) g.structures.remove(s, true); break; }
            case "ss": this.applyStation(e); break;
            case "sa": for (const row of e.list) this.applyStation(row); break;
            case "an": if (!this.session.isHost) g.fauna.importState(e.r); break;
            case "tu": if (!this.session.isHost) g.turtles.importState(e.r); break;
            case "ah": {
                const a = this.session.isHost ? g.fauna.animals[e.i] : undefined;
                if (a && a.state !== "dead") { this.lastHitter = from; g.fauna.damage(a, Math.min(150, e.d), e.x, e.z); }
                break;
            }
            case "as": if (!this.session.isHost) g.fauna.onSound?.(e.w, e.x, e.z); break;
            case "ab": {
                if (this.session.isHost) break;
                r.burst(new Vector3(e.x, e.y, e.z), "flesh", e.n);
                let best: (typeof g.fauna.animals)[number] | null = null, bd = 2.5;
                for (const a of g.fauna.animals) { const d = Math.hypot(a.x - e.x, a.z - e.z); if (d < bd) { bd = d; best = a; } }
                if (best) g.fauna.hurtFx(best);
                break;
            }
            case "ak": if (e.by === this.session.myId && !this.session.isHost) g.hud.message(`${e.nm} down. Pick up the meat.`); break;
            case "hurt": if (e.to === this.session.myId) g.hurtPlayer(e.d, e.x, e.z, e.by); break;
            case "ph": if (e.to === this.session.myId && this.session.pvp) g.hurtPlayer(e.d, e.x, e.z, this.session.players.get(from)?.name ?? "Someone"); break;
            case "chat": {
                const name = this.session.players.get(from)?.name ?? "?";
                this.avatars.say(from, e.t);
                this.onChat?.(name, from, e.t);
                g.hud.message(`${name}: ${e.t}`);
                break;
            }
            case "nr": { const n = r.nodeAt(e.i); if (n && !this.session.isHost) r.respawnNode(n); break; }
            case "so": this.users.set(e.n, from); break;
            case "sc": if (this.users.get(e.n) === from) this.users.delete(e.n); break;
            case "hr": if (!this.session.isHost) this.clock.hour = e.h; break;
            case "zz": if (this.session.isHost) this.vote(from); break;
            case "zm": g.hud.message(e.m); break;
            case "dd": g.hud.message(`${this.session.players.get(from)?.name ?? "Someone"} died`); break;
            case "lk": { const p = this.session.players.get(from), o = parseOutfit(e.l); if (p && o) p.look = o; break; }
            case "cm": case "cc": case "cd": case "ce": g.under.remote(e); break;
            case "fw": g.flowers.pickWild(e.i, true); break;
            case "fa": g.flowers.plant(e.s, e.x, e.y, e.z, { nid: e.n, rot: e.r, remote: true }); break;
            case "fd": g.flowers.unplant(e.n, true); break;
            case "we": if (!this.session.isHost && (e.s === 0 || e.s === 1 || e.s === 2)) g.weather?.setRemote(e.s, Number(e.l) || 0); break;
            case "bi": if (!this.session.isHost) g.bioTonight = !!e.v; break;
            case "mp": this.addPing(from, this.session.players.get(from)?.name ?? "Someone", playerColor(from), e.x, e.z); break;
        }
    }

    private hitFx(n: { kind: string; x: number; y: number; z: number; offs: number[] }, hx: number, hz: number) {
        const g = this.game, p = g.player.pos;
        if (Math.hypot(n.x - p.x, n.z - p.z) > 35) return;
        const fx = n.kind === "stone" ? "stone" : n.kind === "ore" ? "ore" : "wood";
        const dx = hx - n.x, dz = hz - n.z, l = Math.hypot(dx, dz) || 1;
        g.resources.burst(new Vector3(n.x + (dx / l) * 0.5, n.y + (n.offs[0] ?? 1) + 0.6, n.z + (dz / l) * 0.5), fx, 8);
        g.sfx.hit(fx);
    }

    private applyStation(e: any) {
        const g = this.game;
        const s = g.structures.list.find((q) => q.nid === e.n);
        if (!s || g.openStruct === s) return; // never fight the player who has it open
        s.fuel = e.f;
        s.lit = !!e.l;
        s.prog = e.p;
        if (e.i && s.inv) unpackInv(s.inv, e.i);
    }

    private stationState(s: Structure) { return { n: s.nid, f: +s.fuel.toFixed(1), l: s.lit ? 1 : 0, p: +s.prog.toFixed(1), i: packInv(s.inv) }; }

    private broadcastStations() {
        const list = this.game.structures.list.filter((s) => s.inv).map((s) => this.stationState(s));
        if (list.length) this.session.sendEvent({ k: "sa", list });
    }

    /** While the player has a station/box open, share its contents whenever they change; once more when it closes. */
    private shareOpenStation(dt: number) {
        const open = this.game.openStruct;
        this.stationT += dt;
        if (open !== this.lastOpen && this.lastOpen && this.game.structures.list.includes(this.lastOpen)) this.session.sendEvent({ k: "ss", ...this.stationState(this.lastOpen) });
        if (open !== this.lastOpen) {
            if (this.lastOpen) { this.session.sendEvent({ k: "sc", n: this.lastOpen.nid }); this.users.delete(this.lastOpen.nid); }
            if (open) { this.session.sendEvent({ k: "so", n: open.nid }); this.users.set(open.nid, this.session.myId); }
        }
        this.lastOpen = open;
        if (!open || this.stationT < 0.25) return;
        this.stationT = 0;
        const st = this.stationState(open);
        const key = JSON.stringify([st.f, st.i]);
        if (key !== this.lastSent) { this.lastSent = key; this.session.sendEvent({ k: "ss", ...st }); }
    }

    /** Everyone the animals might go after, local player first. */
    private targets(): FaunaTarget[] {
        const p = this.game.player;
        const out: FaunaTarget[] = [{ id: this.session.myId, x: p.pos.x, y: p.pos.y, z: p.pos.z, sprint: p.sprinting, yaw: p.yaw }];
        if (this.session.isHost) {
            for (const [id, st] of this.session.states) {
                if (id === 0 || st.flags & 4) continue;
                out.push({ id, x: st.x, y: st.y, z: st.z, sprint: (st.flags & 1) !== 0, yaw: st.yaw });
            }
        }
        return out;
    }

    private rayPlayer(eye: Vector3, dir: Vector3, reach: number): { id: number; name: string; dist: number } | null {
        if (!this.session.pvp) return null;
        let best: { id: number; name: string; dist: number } | null = null;
        for (const a of this.avatars.positions) {
            const st = this.session.states.get(a.id);
            if (!st || st.flags & 4) continue;
            for (const [h, rad] of [[0.5, 0.4], [1.3, 0.32]] as const) {
                const lx = a.x - eye.x, ly = a.y + h - eye.y, lz = a.z - eye.z;
                const tca = lx * dir.x + ly * dir.y + lz * dir.z;
                const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
                if (tca < 0 || d2 > rad * rad) continue;
                const t = tca - Math.sqrt(rad * rad - d2);
                if (t < reach && (!best || t < best.dist)) best = { id: a.id, name: a.name, dist: Math.max(0, t) };
            }
        }
        return best;
    }

    private addPing(from: number, name: string, color: string, x: number, z: number) {
        this.pings = this.pings.filter((p) => p.name !== name);
        this.pings.push({ x, z, name, color, t: performance.now() });
        this.avatars.addPing(x, z, color);
        this.game.sfx.ping();
        if (from !== this.session.myId) this.game.hud.message(`${name} marked a location`);
    }

    /** Mark the spot you are looking at for everyone. */
    sendPing(eye: Vector3, dir: Vector3) {
        for (let t = 1; t < 220; t += 1.5) {
            const x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t;
            if (y <= this.game.building.ground(x, z, y) + 0.05) {
                const me = this.session.players.get(this.session.myId);
                this.addPing(this.session.myId, me?.name ?? "You", playerColor(this.session.myId), x, z);
                this.session.sendEvent({ k: "mp", x: +x.toFixed(1), z: +z.toFixed(1) });
                return;
            }
        }
        this.game.hud.message("Point at the ground to ping");
        this.game.sfx.denied();
    }

    sendChat(text: string) { this.session.sendEvent({ k: "chat", t: text }); }

    // ------------------------------------------------------------------ per frame
    update(dt: number) {
        const g = this.game, p = g.player, s = this.session;
        if (s.closed) return;
        const held = g.equipped;
        const st: PState = {
            x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch,
            spd: Math.hypot(p.vel.x, p.vel.z), item: held ? held.id : "", swing: g.swings,
            flags: (p.sprinting ? 1 : 0) | (p.mode === "swim" ? 2 : 0) | (g.stats.dead ? 4 : 0) | (g.isSleeping ? 8 : 0) | (g.drinking ? 32 : 0),
            hp: g.stats.health, arm: g.armorCode,
        };
        const pose = this.vrPose?.() ?? null;
        if (pose) { st.v = pose; st.yaw = pose.h[3]; st.pitch = pose.h[4]; }
        s.setMyState(st);
        s.update(dt);
        this.pushApart(dt);
        this.avatars.sync(s.players, s.states, s.myId, dt, p.pos);
        this.shareOpenStation(dt);
    }

    /** Players are soft bodies: standing inside someone gently slides you apart (each client moves only itself). */
    private pushApart(dt: number) {
        const g = this.game, p = g.player;
        if (g.stats.dead || g.isSleeping || p.mode === "fly") return;
        for (const a of this.avatars.positions) {
            const st = this.session.states.get(a.id);
            if (!st || st.flags & 12) continue;
            if (Math.abs(p.pos.y - a.y) > 1.4) continue;
            const dx = p.pos.x - a.x, dz = p.pos.z - a.z, d = Math.hypot(dx, dz);
            if (d >= 0.7) continue;
            const nx = d > 0.01 ? dx / d : Math.cos(this.session.myId * 2.1), nz = d > 0.01 ? dz / d : Math.sin(this.session.myId * 2.1);
            const push = Math.min(0.06, (0.7 - d) * Math.min(1, dt * 6));
            p.pos.x += nx * push;
            p.pos.z += nz * push;
        }
    }

    /** Guests arrive a short walk from the host's spawn, each on their own bearing, always on dry land. */
    spawnOffset(spawn: { x: number; z: number; yaw: number }) {
        const id = this.session.myId;
        if (!id) return;
        let x = spawn.x, z = spawn.z;
        for (let k = 0; k < 24; k++) {
            const a = id * 2.4 + k * 0.7, r = 6 + (id % 3) * 3 + (k >> 3) * 5;
            const cx = spawn.x + Math.cos(a) * r, cz = spawn.z + Math.sin(a) * r, h = heightAt(cx, cz);
            if (h > 0.6 && h < 12) { x = cx; z = cz; break; }
        }
        this.game.player.respawn(x, z, spawn.yaw);
    }
}

export { Session };
