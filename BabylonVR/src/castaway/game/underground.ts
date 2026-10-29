// Gameplay glue for the caves: finding the entrances by digging, going down and up, mining ore, opening chests, and
// switching the whole presentation between the island and the underworld.
// Babylon port: Castaway's logic. The cave and the surface marks are three.js scene graphs drawn by render/mirror.ts;
// switching between the island and the underworld is the host's `present` hook. The sky room and the places behind
// its doors are not ported yet, so their targets are left out for now.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CaveWorld, CAVE_Y, type Ore, type Chest } from '../world/cave';
import { heightAt } from '../world/island';
import type { SurfaceSites, SiteChest } from '../world/sites';
import type { SkyRoom } from '../world/skyroom';
import type { Airstrip } from '../world/airstrip';
import type { Car } from './cars';
import type { CatHome } from '../world/catroom';
import type { HideIsle, HideTarget } from '../world/hideisle';
import type { Campaign, CampTarget } from '../campaign/campaign';
import type { LocationsRoom, LocTarget } from '../world/locationsroom';
import type { Town } from '../world/town';
import type { TileTrial, TrialTarget } from '../world/tiletrial';
import { CAT, HUMAN } from '../world/player';
import { rayGround } from './building';
import type { ItemId } from './items';
import { ITEMS } from './items';
import type { Player } from '../world/player';

interface V3 { x: number; y: number; z: number }

export interface UgHost {
  scene: THREE.Object3D;
  player: Player;
  /** show the caves (and hide the island), or the other way round */
  present(underground: boolean): void;
  message(t: string): void;
  gain(id: ItemId, n: number): void;
  give(id: ItemId, n: number): number;
  canFit(id: ItemId, n: number): number;
  burst(p: V3, fx: 'stone' | 'ore' | 'wood' | 'leaf' | 'flesh' | 'ember' | 'water', n: number): void;
  sfx: { hit(k: string): void; denied(): void; pickup(): void; creak(): void; swing(): void };
}

export type UgTarget =
  | { kind: 'ore'; ore: Ore; chunk: any; dist: number }
  | { kind: 'chest'; chest: Chest; dist: number }
  | { kind: 'rope'; index: number; dist: number }
  | { kind: 'pit'; index: number; dist: number }
  | { kind: 'crack'; index: number; dist: number }
  | { kind: 'loot'; chest: SiteChest; dist: number }
  | { kind: 'skydoor'; dist: number }
  | { kind: 'skyexit'; dist: number }
  | { kind: 'clouddoor'; dist: number }
  | { kind: 'airdoor'; dist: number }
  | { kind: 'airexit'; dist: number }
  | { kind: 'car'; car: Car; dist: number }
  | { kind: 'catdoor'; dist: number }
  | { kind: 'catexit'; dist: number }
  | { kind: 'hidedoor'; dist: number }
  | { kind: 'campdoor'; dist: number }
  | { kind: 'locdoor'; dist: number }
  | { kind: 'locroom'; t: LocTarget; dist: number }
  | { kind: 'townexit'; dist: number }
  | { kind: 'camp'; t: CampTarget; dist: number }
  | { kind: 'hide'; t: HideTarget; dist: number }
  | { kind: 'trialdoor'; dist: number }
  | { kind: 'trial'; t: TrialTarget; dist: number };

const DIG_HITS = 6;

export class Underground {
  active = false;
  readonly world: CaveWorld;
  private opened = new Set<number>();
  /** multiplayer: called with a world event to broadcast */
  onEvent: ((e: any) => void) | null = null;
  dig = new Map<string, number>();
  /** ruined huts and shipwrecks on the surface (set by main) */
  sites: SurfaceSites | null = null;
  /** the secret room behind the odd door (set by main) */
  sky: SkyRoom | null = null;
  /** the airstrip island (set by main) */
  air: Airstrip | null = null;
  /** the cat house (set by main) */
  cat: CatHome | null = null;
  /** Hideaway Isle (hide and seek) and the Chamber of Tiles (set by main) */
  hide: HideIsle | null = null;
  /** Banana or Salmon, the co-op campaign behind the yellow door (set by main) */
  camp: Campaign | null = null;
  /** Locations, Locations: the monitor room and the real place you are in (set by main) */
  locs: LocationsRoom | null = null;
  town: Town | null = null;
  /** leaving a town through its doorway (main puts you back in the Locations room) */
  onTownExit: (() => void) | null = null;
  /** the Locations room was entered (the narrator says hello) */
  onLocs: (() => void) | null = null;
  trial: TileTrial | null = null;
  /** cat house entered / left (main swaps the body, the paws and the multiplayer flag) */
  onCat: ((on: boolean) => void) | null = null;
  private surf = new THREE.Group();
  private hintCd = 0;
  private marks: { crack: THREE.Group; pit: THREE.Group }[] = [];

  constructor(private h: UgHost) {
    this.world = new CaveWorld(7777);
    h.scene.add(this.world.group, this.surf);
    this.world.net.entrances.forEach((e, i) => this.buildMarks(e, i));
    this.refreshMarks();
  }

  // ---------------------------------------------------------------- surface marks
  private buildMarks(e: { x: number; z: number }, i: number) {
    const y = heightAt(e.x, e.z);
    const root = new THREE.Group(); root.position.set(e.x, y + 0.03, e.z);
    // everything below follows the real ground: a flat disc on a slope floats on one side and sinks into the other
    const gy = (lx: number, lz: number) => heightAt(e.x + lx, e.z + lz) - root.position.y;
    const conform = (geo: THREE.BufferGeometry, lift: number) => {
      const p = geo.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, gy(p.getX(k), p.getZ(k)) + lift);
      p.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    };
    const patch = (r: number, lift: number) => conform(new THREE.RingGeometry(0.0001, r, 20, 4).rotateX(-Math.PI / 2), lift);
    // cracked patch: where the ground sounds hollow (soft-edged earth tint instead of a hard-edged disc)
    const crack = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ name: 'ug', color: '#4a3f33', roughness: 1 });
    // a soft-edged tint (the Babylon side gives 'ugEarth' its radial fade)
    const earth = new THREE.MeshStandardMaterial({ name: 'ugEarth', color: '#6e5d46', roughness: 1, transparent: true, depthWrite: false });
    crack.add(new THREE.Mesh(patch(1.5, 0.02), earth));
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + i, L = 0.8 + (k % 3) * 0.35;
      const x = Math.cos(a) * L * 0.5, z = Math.sin(a) * L * 0.5;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, L), dark);
      b.position.set(x, gy(x, z) + 0.015, z); b.rotation.y = -a + Math.PI / 2;
      // lie along the slope under the crack, not level
    }
    const pebble = new THREE.MeshStandardMaterial({ name: 'ug', color: '#9b9488', roughness: 0.95 });
    // (the pebbles, and the rocks round the pit below, are merged into one mesh each: one draw instead of nine / eleven)
    const peb: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const a = k * 2.1 + i * 1.7, r = 0.5 + (k % 4) * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
      peb.push(new THREE.IcosahedronGeometry(0.06 + (k % 3) * 0.03, 0).translate(x, gy(x, z) + 0.02, z));
    }
    crack.add(new THREE.Mesh(mergeGeometries(peb)!, pebble));
    // opened shaft: a dark mouth in the ground ringed by rocks that sit in the slope
    const pit = new THREE.Group();
    const hole = new THREE.Mesh(patch(1.15, 0.015), new THREE.MeshBasicMaterial({ name: 'ugHole', color: '#000000' }));
    pit.add(hole);
    const rock = new THREE.MeshStandardMaterial({ name: 'ug', color: '#7d756a', roughness: 0.95 });
    const rk: THREE.BufferGeometry[] = [], o = new THREE.Object3D();
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2, r = 1.2 + (k % 2) * 0.12, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.28 + (k % 3) * 0.1;
      o.position.set(x, gy(x, z) + s * 0.12, z); o.scale.set(1, 0.6, 1); o.rotation.set(k, k * 2, 0); o.updateMatrix();
      rk.push(new THREE.IcosahedronGeometry(s, 0).applyMatrix4(o.matrix));
    }
    pit.add(new THREE.Mesh(mergeGeometries(rk)!, rock));
    const wood = new THREE.MeshStandardMaterial({ name: 'ug', color: '#8b5e34', roughness: 0.9 });
    for (const x of [-0.3, 0.3]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), wood); r.position.set(x, gy(x, 1.05) + 0.3, 1.05); r.rotation.x = 0.35; pit.add(r); }
    root.add(crack, pit);
    this.surf.add(root);
    this.marks[i] = { crack, pit };
  }
  private refreshMarks() {
    this.marks.forEach((m, i) => { const o = this.opened.has(i); m.crack.visible = !o; m.pit.visible = o; });
  }

  // ---------------------------------------------------------------- going down and up
  private setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.world.group.visible = on;
    if (!on) this.world.clear();
    this.h.present(on);
    this.h.player.cave = on ? this.world : null;
  }

  enter(i: number) {
    const L = this.world.landing(i);
    this.setActive(true);
    this.world.prewarm(L.x + 3.4, L.y, L.z);
    this.h.player.teleport(L.x + 3.4, this.world.floor(L.x + 3.4, L.z, L.y + 1), L.z, -Math.PI / 2);
    this.h.message('You climb down into the dark. Bring a torch.');
    this.h.sfx.creak();
  }
  exit(i: number | null = null, quiet = false) {
    if (!this.active) return;
    const e = this.world.net.entrances[i ?? this.nearestEntrance(this.h.player.pos.x, this.h.player.pos.z)];
    this.setActive(false);
    const x = e.x + 1.9, z = e.z + 0.2;
    this.h.player.teleport(x, heightAt(x, z), z, -Math.PI / 2);
    if (!quiet) { this.h.message('Daylight at last.'); this.h.sfx.creak(); }
  }
  private nearestEntrance(x: number, z: number) {
    let b = 0, bd = 1e9;
    this.world.net.entrances.forEach((e, i) => { const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; b = i; } });
    return b;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, eye: V3, toolId: ItemId | null) {
    this.hintCd -= dt;
    const p = this.h.player;
    if (this.active) {
      this.world.update(dt, p.pos.x, p.pos.y + 1, p.pos.z);
      if (p.pos.y < CAVE_Y - 60) { // fell out of the world: back to the nearest rope
        const L = this.world.landing(this.nearestEntrance(p.pos.x, p.pos.z));
        p.teleport(L.x + 3.4, L.y, L.z, p.yaw);
      }
    } else if (toolId && ITEMS[toolId]?.tool?.model === 'pickaxe' && this.hintCd <= 0) {
      const i = this.nearestEntrance(p.pos.x, p.pos.z), e = this.world.net.entrances[i];
      const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
      if (!this.opened.has(i) && d < 12) { this.h.message('You feel cool air seeping out of the ground nearby…'); this.hintCd = 60; }
    }
    void eye;
  }

  // ---------------------------------------------------------------- aiming
  /** what the player is looking at that belongs to the caves (or their entrances) */
  target(eye: V3, dir: V3, reach: number, assist: number): UgTarget | null {
    if (this.active) {
      const t = this.world.pick(eye, dir, Math.max(reach, 3.4), assist);
      if (!t) return null;
      if (t.type === 'ore') return { kind: 'ore', ore: t.ore, chunk: t.chunk, dist: t.dist };
      if (t.type === 'chest') return { kind: 'chest', chest: t.chest, dist: t.dist };
      return { kind: 'rope', index: t.index, dist: t.dist };
    }
    const p = this.h.player;
    let best: UgTarget | null = null;
    this.world.net.entrances.forEach((e, i) => {
      const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
      if (this.opened.has(i)) { if (d < 2.6 && Math.abs(p.pos.y - heightAt(e.x, e.z)) < 2) best = { kind: 'pit', index: i, dist: d }; }
      else if (dir.y < -0.2 && d < 5) {
        const g = rayGround(eye, dir, 3.4, heightAt);
        if (g.hit && Math.hypot(g.x - e.x, g.z - e.z) < 2.4) best = { kind: 'crack', index: i, dist: g.t };
      }
    });
    const lt = this.sites?.pick(eye, dir, Math.max(reach, 3.2), assist);
    if (lt && (!best || lt.dist < (best as UgTarget).dist)) best = { kind: 'loot', chest: lt.chest, dist: lt.dist };
    const dt = this.sites?.pickDoor(eye, dir, Math.max(reach, 3.2), assist);
    if (dt != null && (!best || dt < (best as UgTarget).dist)) best = { kind: 'skydoor', dist: dt };
    const xt = this.sky?.pick(eye, dir, Math.max(reach, 3.2), assist);
    if (xt != null && (!best || xt < (best as UgTarget).dist)) best = { kind: 'skyexit', dist: xt };
    const cd2 = this.sky?.pickCloud(eye, dir, Math.max(reach, 3.2), assist);
    if (cd2 != null && (!best || cd2 < (best as UgTarget).dist)) best = { kind: 'clouddoor', dist: cd2 };
    const at = this.sky?.pickAir(eye, dir, Math.max(reach, 3.2), assist);
    if (at != null && (!best || at < (best as UgTarget).dist)) best = { kind: 'airdoor', dist: at };
    const ht2 = this.sky?.pickHide(eye, dir, Math.max(reach, 3.2), assist);
    if (ht2 != null && (!best || ht2 < (best as UgTarget).dist)) best = { kind: 'hidedoor', dist: ht2 };
    const tt2 = this.sky?.pickTrial(eye, dir, Math.max(reach, 3.2), assist);
    if (tt2 != null && (!best || tt2 < (best as UgTarget).dist)) best = { kind: 'trialdoor', dist: tt2 };
    const cd3 = this.sky?.pickCamp(eye, dir, Math.max(reach, 3.2), assist);
    if (cd3 != null && (!best || cd3 < (best as UgTarget).dist)) best = { kind: 'campdoor', dist: cd3 };
    const ld = this.sky?.pickLoc(eye, dir, Math.max(reach, 3.2), assist);
    if (ld != null && (!best || ld < (best as UgTarget).dist)) best = { kind: 'locdoor', dist: ld };
    const te = this.town?.pick(eye, dir, reach, assist);
    if (te != null && (!best || te < (best as UgTarget).dist)) best = { kind: 'townexit', dist: te };
    const lp = this.locs?.pick(eye, dir, reach, assist);
    if (lp && (!best || lp.dist < (best as UgTarget).dist)) best = { kind: 'locroom', t: lp.t, dist: lp.dist };
    const cp = this.camp?.pick(eye, dir, reach, assist);
    if (cp && (cp.t.w === 'm' && cp.t.t.w === 'held' || !best || cp.dist < (best as UgTarget).dist)) best = { kind: 'camp', t: cp.t, dist: cp.dist };
    const tp = this.trial?.pick(eye, dir, reach, assist);
    if (tp && (!best || tp.dist < (best as UgTarget).dist)) best = { kind: 'trial', t: tp.t, dist: tp.dist };
    const hp = this.hide?.pick(eye, dir, reach, assist);
    if (hp && (hp.t.w === 'out' || !best || hp.dist < (best as UgTarget).dist)) best = { kind: 'hide', t: hp.t, dist: hp.dist };
    const kt = this.sky?.pickCat(eye, dir, Math.max(reach, 3.2), assist);
    if (kt != null && (!best || kt < (best as UgTarget).dist)) best = { kind: 'catdoor', dist: kt };
    const kx = this.cat?.pickDoor(eye, dir, Math.max(reach, 3.2), assist);
    if (kx != null && (!best || kx < (best as UgTarget).dist)) best = { kind: 'catexit', dist: kx };
    const ct = this.air?.pickCar(eye, dir, Math.max(reach, 4.2), assist);
    if (ct && (!best || ct.dist < (best as UgTarget).dist)) best = { kind: 'car', car: ct.car, dist: ct.dist };
    const et = this.air?.pickDoor(eye, dir, Math.max(reach, 3.2), assist);
    if (et != null && (!best || et < (best as UgTarget).dist)) best = { kind: 'airexit', dist: et };
    return best;
  }

  prompt(t: UgTarget, toolId: ItemId | null): { name: string; hint: string; ok: boolean } {
    const def = toolId ? ITEMS[toolId] : null;
    const pick = def?.tool?.model === 'pickaxe';
    switch (t.kind) {
      case 'ore': {
        const nm = t.ore.kind === 'iron' ? 'Iron ore' : t.ore.kind === 'coal' ? 'Coal seam' : 'Diamond vein';
        if (!def?.tool || (def.tool.gather.ore ?? 0) <= 0) return { name: nm, hint: 'Equip a pickaxe', ok: false };
        if (t.ore.kind === 'diamond' && !pick) return { name: nm, hint: 'Needs a pickaxe', ok: false };
        return { name: nm, hint: '<b>Click</b> mine', ok: true };
      }
      case 'locdoor': return { name: 'Locations, Locations', hint: '<b>E</b> open · real places', ok: true };
      case 'locroom': return this.locs!.prompt(t.t);
      case 'townexit': return { name: 'Exit to Locations', hint: '<b>E</b> / click · back to the Locations room', ok: true };
      case 'campdoor': return { name: 'Banana or Salmon', hint: '<b>E</b> open · a co-op adventure', ok: true };
      case 'camp': return this.camp!.prompt(t.t);
      case 'hidedoor': return { name: 'Green door', hint: '<b>E</b> open · hide & seek island', ok: true };
      case 'hide': return this.hide!.prompt(t.t);
      case 'trialdoor': return { name: 'Copper door', hint: '<b>E</b> open · the Chamber of Tiles', ok: true };
      case 'trial': return this.trial!.prompt(t.t);
      case 'catdoor': return { name: 'Door with a paw print', hint: '<b>E</b> open · become a cat', ok: true };
      case 'catexit': return { name: 'Kitchen door', hint: '<b>E</b> back to the secret room', ok: true };
      case 'airdoor': return { name: 'Door to the airstrip', hint: '<b>E</b> open', ok: true };
      case 'airexit': return { name: 'Door back home', hint: '<b>E</b> go back to the secret room', ok: true };
      case 'car': return t.car.driver !== null || this.air?.remote.has(t.car.index) ? { name: t.car.spec.name, hint: 'Someone is driving it', ok: false } : { name: t.car.spec.name, hint: `<b>E</b> drive · ${t.car.spec.blurb}`, ok: true };
      case 'clouddoor': return { name: 'Cloud door', hint: '<b>E</b> open · jump out and parachute down', ok: true };
      case 'skydoor': return { name: 'Strange door', hint: '<b>E</b> open', ok: true };
      case 'skyexit': return { name: 'Door', hint: '<b>E</b> go back down', ok: true };
      case 'loot': return t.chest.opened ? { name: 'Empty chest', hint: '', ok: false } : { name: t.chest.kind === 'wreck' ? 'Sea-battered chest' : 'Old chest', hint: '<b>E</b> open', ok: true };
      case 'chest': return t.chest.opened ? { name: 'Empty chest', hint: '', ok: false } : { name: 'Old chest', hint: '<b>E</b> open', ok: true };
      case 'rope': return { name: 'Rope ladder', hint: '<b>E</b> climb up', ok: true };
      case 'pit': return { name: 'Shaft', hint: '<b>E</b> climb down', ok: true };
      case 'crack': return pick ? { name: 'Hollow ground', hint: '<b>Click</b> dig', ok: true } : { name: 'Cracked ground', hint: 'Dig with a pickaxe', ok: false };
    }
  }

  interact(t: UgTarget) {
    switch (t.kind) {
      case 'rope': this.exit(t.index); break;
      case 'pit': this.enter(t.index); break;
      case 'chest': this.openChest(t.chest); break;
      case 'loot': this.openSiteChest(t.chest); break;
      case 'clouddoor': this.sky?.openCloud(); break;
      case 'townexit': this.onTownExit?.(); this.h.sfx.creak(); break;
      case 'locdoor': if (this.sky && this.locs) { this.sky.depart(); this.locs.enter(this.h.player); this.onLocs?.(); this.h.sfx.creak(); } break;
      case 'locroom': { if (this.locs?.interact(t.t) === 'exit' && this.sky) { this.locs.leave(this.h.player); this.sky.enter(this.h.player, 'loc'); this.h.message('Back in the secret room.'); this.h.sfx.creak(); } break; }
      case 'campdoor': if (this.sky && this.camp) { this.sky.depart(); this.camp.enter(); this.h.sfx.creak(); } break;
      case 'camp': { if (this.camp?.interact(t.t) === 'exit' && this.sky) { this.camp.leave(); this.sky.enter(this.h.player, 'camp'); this.h.message('Back in the secret room.'); this.h.sfx.creak(); } break; }
      case 'hidedoor': if (this.sky && this.hide) { this.sky.depart(); this.hide.enter(this.h.player); this.h.sfx.creak(); } break;
      case 'trialdoor': if (this.sky && this.trial) { this.sky.depart(); this.trial.enter(this.h.player); this.h.sfx.creak(); } break;
      case 'trial': { if (this.trial?.interact(t.t) === 'exit' && this.sky) { this.trial.leave(this.h.player); this.sky.enter(this.h.player, 'trial'); this.h.message('Back in the secret room.'); this.h.sfx.creak(); } break; }
      case 'hide': { if (this.hide?.interact(t.t, this.h.player) === 'exit' && this.sky) { this.hide.leave(this.h.player); this.sky.enter(this.h.player, 'hide'); this.h.message('Back in the secret room.'); this.h.sfx.creak(); } break; }
      case 'catdoor': if (this.sky && this.cat) { this.sky.depart(); this.cat.enter(this.h.player, CAT); this.onCat?.(true); this.h.message('You are a cat now. Jump on things (hold Space at a scratching post to climb), pounce with click, chase the mouse!'); this.h.sfx.creak(); } break;
      case 'catexit': if (this.sky && this.cat) { this.cat.leave(this.h.player, HUMAN); this.onCat?.(false); this.sky.enter(this.h.player, 'cat'); this.h.message('Back on two legs.'); this.h.sfx.creak(); } break;
      case 'airdoor': if (this.sky && this.air) { this.sky.depart(); this.air.enter(this.h.player); this.h.message('Welcome to the airstrip. Find a car and drive!'); this.h.sfx.creak(); } break;
      case 'airexit': if (this.sky && this.air) { this.air.leave(this.h.player); this.sky.enter(this.h.player, 'air'); this.h.sfx.creak(); } break;
      case 'car': if (this.air?.enterCar(t.car, this.h.player)) { this.h.message(`${t.car.spec.name}: W/S gas and brake · A/D steer · Space handbrake · Shift boost · E to get out`); this.onEvent?.({ k: 'cr', i: t.car.index, on: 1 }); } else { this.h.message('Someone is already in that car'); this.h.sfx.denied(); } break;
      case 'skydoor': this.sky?.enter(this.h.player); this.h.message('The door opens onto… somewhere far above the island.'); this.h.sfx.creak(); break;
      case 'skyexit': { const e = this.sites?.doorExit(); if (e && this.sky) { this.sky.leave(this.h.player, { x: e.x, y: heightAt(e.x, e.z), z: e.z, yaw: e.yaw }); this.h.sfx.creak(); } break; }
      default: break;
    }
  }

  // ---------------------------------------------------------------- tools
  /** A pickaxe-class swing connected. Returns true when it was spent on digging or mining. */
  swing(eye: V3, dir: V3, toolId: ItemId, nodeDist: number, assist: number): boolean {
    const def = ITEMS[toolId], tool = def.tool;
    if (!tool) return false;
    if (this.active) {
      const t = this.world.pick(eye, dir, tool.reach + 0.2, assist);
      if (!t || t.type !== 'ore') return false;
      const rate = tool.gather.ore ?? 0;
      if (rate <= 0) { this.h.sfx.denied(); return true; }
      const o = t.ore;
      if (o.kind === 'diamond' && tool.model !== 'pickaxe') { this.h.message('Too hard for that — you need a pickaxe.'); this.h.sfx.denied(); return true; }
      const item: ItemId = o.kind === 'iron' ? 'metal_ore' : o.kind === 'coal' ? 'coal' : 'diamond';
      let n = o.kind === 'diamond' ? 1 : Math.max(1, Math.round((rate / 6) * (0.8 + Math.random() * 0.4)));
      n = Math.min(n, this.h.canFit(item, n));
      if (n <= 0) { this.h.message('Inventory full'); this.h.sfx.denied(); return true; }
      this.h.give(item, n); this.h.gain(item, n);
      const pt = new THREE.Vector3(o.x + o.nx * 0.3, o.y + o.ny * 0.3, o.z + o.nz * 0.3);
      this.h.burst(pt, 'ore', 10); this.h.player.shake(0.3); this.h.sfx.hit('ore');
      const spent = this.world.mineOre(t.chunk, o);
      this.onEvent?.({ k: 'cm', id: o.id, l: spent ? 0 : o.left });
      if (spent) this.h.message(o.kind === 'diamond' ? 'The diamond vein is spent.' : 'The vein is exhausted.');
      return true;
    }
    // ---- surface: dig for a way down
    if (tool.model !== 'pickaxe' || dir.y > -0.2) return false;
    const g = rayGround(eye, dir, tool.reach + 0.4, heightAt);
    if (!g.hit || g.t > nodeDist) return false;
    if (heightAt(g.x, g.z) < 1.2) return false;
    let idx = -1;
    this.world.net.entrances.forEach((e, i) => { if (Math.hypot(e.x - g.x, e.z - g.z) < 2.4) idx = i; });
    const pt = new THREE.Vector3(g.x, g.y + 0.1, g.z);
    this.h.burst(pt, 'stone', 8); this.h.sfx.hit('stone'); this.h.player.shake(0.25);
    if (idx >= 0 && !this.opened.has(idx)) {
      const k = `e${idx}`, n = (this.dig.get(k) ?? 0) + 1;
      this.dig.set(k, n);
      if (n < DIG_HITS) this.onEvent?.({ k: 'cd', i: idx, n });
      if (n === 1) this.h.message('The ground sounds hollow here…');
      else if (n === 3) this.h.message('Something is down there. Keep digging!');
      if (n >= DIG_HITS) {
        this.opened.add(idx); this.refreshMarks(); this.dig.delete(k);
        this.onEvent?.({ k: 'ce', i: idx });
        this.h.burst(pt, 'stone', 18); this.h.sfx.creak();
        this.h.message('The ground gives way — a shaft leads down into the dark!');
      }
    } else {
      const k = `${Math.floor(g.x / 2.5)},${Math.floor(g.z / 2.5)}`, n = (this.dig.get(k) ?? 0) + 1;
      this.dig.set(k, n);
      if (n === 4) this.h.message('Nothing but solid rock under here.');
      else if (n < 4 && Math.random() < 0.25) { const f = this.h.canFit('stone', 1); if (f > 0) { this.h.give('stone', 1); this.h.gain('stone', 1); } }
    }
    return true;
  }

  // ---------------------------------------------------------------- chests
  private openChest(ch: Chest) {
    if (ch.opened) { this.h.message('Already looted.'); return; }
    this.world.openChest(ch);
    this.onEvent?.({ k: 'cc', id: ch.id });
    this.h.sfx.creak();
    const r = Math.random;
    const loot: [ItemId, number][] = [];
    const rich = ch.rich;
    loot.push(['metal', 3 + Math.floor(r() * (8 + rich * 8))]);
    loot.push(['metal_ore', 5 + Math.floor(r() * 16)]);
    loot.push(['coal', 4 + Math.floor(r() * 10)]);
    if (r() < 0.8) loot.push(['torch', 2 + Math.floor(r() * 5)]);
    if (r() < 0.6) loot.push(['cooked_meat', 2 + Math.floor(r() * 3)]);
    if (r() < 0.5) loot.push(['fiber', 6 + Math.floor(r() * 14)]);
    if (r() < 0.12 + rich * 0.2) loot.push(['diamond', 1 + Math.floor(r() * 2)]);
    if (r() < 0.05 + rich * 0.06) loot.push([r() < 0.5 ? 'metal_pickaxe' : 'metal_hatchet', 1]);
    const got: string[] = [];
    for (const [id, n] of loot) {
      const fit = this.h.canFit(id, n);
      if (fit <= 0) continue;
      this.h.give(id, fit); this.h.gain(id, fit); got.push(`${fit} ${ITEMS[id].name}`);
    }
    this.h.message(got.length ? `You found: ${got.slice(0, 4).join(', ')}${got.length > 4 ? '…' : ''}` : 'Your bag is full!');
  }

  // ---------------------------------------------------------------- surface chests (huts and wrecks)
  private openSiteChest(ch: SiteChest) {
    if (ch.opened) { this.h.message('Already looted.'); return; }
    this.sites?.setOpened(ch.id);
    this.onEvent?.({ k: 'cc', id: ch.id });
    this.h.sfx.creak();
    const r = Math.random, n = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const LEATHER: ItemId[] = ['leather_cap', 'leather_vest', 'leather_pants'], METAL: ItemId[] = ['metal_helmet', 'metal_chestplate', 'metal_greaves'], DIAMOND: ItemId[] = ['diamond_helmet', 'diamond_chestplate', 'diamond_greaves'];
    const loot: [ItemId, number][] = [];
    if (ch.kind === 'hut') {
      loot.push(['fiber', n(6, 16)], ['wood', n(6, 16)]);
      if (r() < 0.7) loot.push(['stone', n(4, 12)]);
      if (r() < 0.7) loot.push(['torch', n(2, 4)]);
      if (r() < 0.5) loot.push(['cooked_meat', n(1, 3)]);
      if (r() < 0.6) loot.push(['leather', n(2, 5)]);
      if (r() < 0.55) loot.push(['metal', n(2, 7)]);
      if (r() < 0.4) loot.push(['coal', n(3, 8)], ['metal_ore', n(4, 10)]);
      if (r() < 0.2) loot.push([pick(LEATHER), 1]);
      if (r() < 0.07) loot.push([pick(METAL), 1]);
      if (r() < 0.07) loot.push([r() < 0.5 ? 'metal_pickaxe' : 'metal_hatchet', 1]);
      if (r() < 0.06) loot.push(['diamond', 1]);
    } else {
      loot.push(['metal', n(8, 18)], ['leather', n(3, 8)], ['torch', n(3, 6)]);
      if (r() < 0.8) loot.push(['coal', n(6, 12)]);
      if (r() < 0.6) loot.push(['cooked_fish', n(3, 5)]);
      if (r() < 0.5) loot.push(['diamond', n(1, 3)]);
      if (r() < 0.6) loot.push([pick(METAL), 1]);
      if (r() < 0.25) loot.push([pick(METAL), 1]);
      if (r() < 0.12) loot.push([pick(DIAMOND), 1]);
      if (r() < 0.3) loot.push([r() < 0.5 ? 'metal_pickaxe' : 'metal_hatchet', 1]);
    }
    const got: string[] = [];
    for (const [id, c] of loot) {
      const fit = this.h.canFit(id, c);
      if (fit <= 0) continue;
      this.h.give(id, fit); this.h.gain(id, fit); got.push(`${fit} ${ITEMS[id].name}`);
    }
    this.h.message(got.length ? `You found: ${got.slice(0, 4).join(', ')}${got.length > 4 ? '…' : ''}` : 'Your bag is full!');
  }

  // ---------------------------------------------------------------- saving
  /** an event from another player */
  remote(e: any) {
    switch (e.k) {
      case 'cm': this.world.applyOre(e.id, e.l); break;
      case 'cc': if (String(e.id)[0] === 'S') this.sites?.setOpened(e.id); else this.world.applyChest(e.id); break;
      case 'cd': if (!this.opened.has(e.i)) this.dig.set(`e${e.i}`, Math.max(this.dig.get(`e${e.i}`) ?? 0, e.n)); break;
      case 'ce': this.opened.add(e.i); this.dig.delete(`e${e.i}`); this.refreshMarks(); break;
    }
  }
  capture() {
    return { open: [...this.opened], mined: [...this.world.mined], chests: [...this.world.opened], partial: [...this.world.partial], sites: [...(this.sites?.opened ?? [])], dig: [...this.dig].filter(([k]) => k[0] === 'e') };
  }
  restore(s: any) {
    if (!s) return;
    this.opened = new Set(s.open ?? []);
    this.world.mined.clear(); (s.mined ?? []).forEach((i: string) => this.world.mined.add(i));
    this.world.opened.clear(); (s.chests ?? []).forEach((i: string) => this.world.opened.add(i));
    this.world.partial.clear(); (s.partial ?? []).forEach(([i, l]: [string, number]) => this.world.partial.set(i, l));
    for (const [k, n] of s.dig ?? []) this.dig.set(k, n);
    for (const id of s.sites ?? []) this.sites?.setOpened(id, true);
    this.refreshMarks();
  }
}

export type { ItemId };
