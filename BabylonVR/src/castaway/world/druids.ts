// The druid circle on the hilltop in the middle of the island, and what it summons.
//
// Eleven weathered standing stones and a trilithon round a flat altar stone. Each has a colour (its carving glows it, a crystal
// above shows it): red, blue or a sleeping grey. Touch a stone (E) and its carving lights up; two stones of one colour touched
// within 30 s of each other (or every player on the island touching one of that colour) make a call. Blue brings the alien
// invasion (invaders.ts). Red brings Mario: the summoning starts: a funeral drone plays (13.6 s, its whole length) while the sky bleeds to a dark pink, the runes pulse and a vortex
// of pink light winds up over the altar. When the drone ends there is a flash, and Mario stands in the circle: "it's-a me!".
// He follows the players about, runs and hops, and now and then goes after a cat. He doesn't hurt anyone; a few good hits
// with any tool finish him (he pops up and drops through the ground, the classic way), and the sky clears.
//
// The host (or the solo player) runs it all and tells the others (events zt / zp / zm / zh); it is saved with the world.
//
// Model: "Mario Terminal 7 New Super Mario Bros Style" by JameSmartGuy02 (Sketchfab), CC-BY-4.0. It comes as one rigid mesh
// in a T-pose, so it is rigged here: each vertex is given to the body, a leg, an arm or the head by where it sits (blended
// over a few centimetres at each joint), and those bones are swung procedurally (run, hop, flinch, wave, death).
// Babylon port: Castaway's code, drawn by render/mirror.ts. The stones are named 'druidRock' (the Babylon rock material),
// the carvings 'rune' and the funnel 'vortex' (their glow shaders are in world/druidView.ts); Mario is a three.js skinned
// mesh, skinned on the CPU by the mirror.
import * as THREE from 'three';
import { heightAt, slopeAt } from './island';
import type { ColliderGrid, Collider } from './vegetation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface V3 { x: number; y: number; z: number }
/** a stand-in for a shader uniform: the Babylon side reads .value every frame */
const uniform = (v: number) => ({ value: v });
import marioUrl from '../assets/mario/mario.glb?inline';
import summonUrl from '../assets/mario/summon.mp3?inline';
import itsMeUrl from '../assets/mario/its-me.mp3?inline';

export type DruidPhase = 'idle' | 'summon' | 'alive' | 'dying';
const SUMMON_S = 13.63;            // the drone's length: the summoning lasts exactly that long
const HP = 5;
const R = 7.2;                     // circle radius (m)

const rnd = (() => { let s = 4711; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const hash = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

/** what a stone calls: two red ones together bring Mario, two blue ones the alien invasion; grey ones are still asleep */
export type StoneColor = 'red' | 'blue' | 'grey';
const STONE_HEX: Record<StoneColor, string> = { red: '#ff3b3b', blue: '#3b8bff', grey: '#9aa6a8' };
const CALL_WINDOW = 30;            // seconds: two stones of a colour must be touched within this of each other
interface Stone { x: number; z: number; y: number; h: number; mesh: THREE.Mesh; rune: THREE.Mesh; glow: { value: number }; touchedBy: Map<number, number>; col: Collider; face: number; color: StoneColor }
export interface DruidTarget { i: number; dist: number }

/** a rough sarsen: a tall box, bulged, with every vertex pushed about by noise and the top weathered round */
function sarsen(w: number, h: number, d: number, seed: number) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 8, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + h / 2) / h;                                                  // 0 at the foot, 1 at the top
    const taper = 1 - 0.22 * t * t, bulge = 1 + 0.12 * Math.sin(t * Math.PI);
    x *= taper * bulge; z *= taper * bulge * 0.95;
    const n = (hash(x * 3 + seed, y * 2, z * 3) - 0.5) * 0.16 + (hash(x + seed * 2, y * 0.7, z) - 0.5) * 0.12;
    x += n * Math.sign(x || 1); z += n * 0.8 * Math.sign(z || 1);
    if (t > 0.85) { const k = (t - 0.85) / 0.15; y -= k * k * 0.18 * (Math.abs(x) / (w / 2) + Math.abs(z) / (d / 2)); }   // weathered round on top
    p.setXYZ(i, x, y + h / 2, z);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

export class Druids {
  readonly group = new THREE.Group();
  readonly centre = { x: 0, y: 0, z: 0 };
  readonly stones: Stone[] = [];
  phase: DruidPhase = 'idle';
  private t = 0;
  /** the host runs it; clients are told */
  remote = false;
  hp = HP;
  /** 0..1 how cursed the sky is (Atmosphere reads it) */
  curse = 0;
  // ---- network / game hooks
  onTouch: ((i: number) => void) | null = null;
  /** host: a colour other than red was called (blue: the invasion) */
  onCall: ((c: StoneColor) => void) | null = null;
  /** something else is going on (the invasion): the stones stay quiet */
  busy: () => boolean = () => false;
  onPhase: ((p: DruidPhase) => void) | null = null;
  onHit: ((dmg: number) => void) | null = null;
  /** who is on the island now (ids and positions): everybody must touch */
  players: () => { id: number; x: number; y: number; z: number }[] = () => [];
  myId: () => number = () => 0;
  /** island cats (host: one to chase; everyone: the ones near Mario run) */
  cats: { list: () => { x: number; z: number }[]; scare: (x: number, z: number, r: number) => void } | null = null;
  sound: ((k: 'bonk' | 'hop' | 'poof' | 'touch' | 'whoosh', v: number) => void) | null = null;
  say: ((t: string) => void) | null = null;
  // ---- the summoning effects
  private vortex: THREE.Mesh;
  private vortexU = uniform(0);
  private motes: THREE.InstancedMesh;
  private moteT: number[] = [];
  private flashT = 0;
  // ---- Mario
  private mario: MarioRig | null = null;
  readonly m = { x: 0, y: 0, z: 0, yaw: 0, vy: 0, anim: 0, hurt: 0, speed: 0, ground: true };
  private ai = { target: -1 as number, catT: 20, cat: -1, hopT: 5, mode: 'follow' as 'follow' | 'cat' | 'idle', modeT: 0, inv: 0 };
  private summonAudio: HTMLAudioElement | null = null;
  private itsMe: HTMLAudioElement | null = null;
  /** seconds until Mario says "it's-a me!" again (about once a minute while he is about) */
  private voiceT = 60;
  private cols: Collider[] = [];

  constructor(scene: THREE.Scene, private colliders: ColliderGrid, shadows: boolean) {
    this.pickSite();
    const C = this.centre;
    this.group.position.set(0, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ name: 'druidRock' });
    // runes: a carved spiral and three ogham strokes, lit by the glow uniform (pink when the sky is cursed)
    const runeMat = (glow: { value: number }, hex: string) => {
      const m = new THREE.MeshBasicMaterial({ name: 'rune', color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.userData = { glow, hex, curse: this.curseU };
      return m;
    };
    // eleven uprights (one gap faces the sunrise) and a trilithon opposite it
    const n = 12;
    const ORDER: StoneColor[] = ['red', 'blue', 'grey'];
    for (let k = 0; k < n; k++) {
      if (k === 0) continue;                                                     // the entrance
      const a = (k / n) * Math.PI * 2 + 0.26;
      const x = C.x + Math.cos(a) * R, z = C.z + Math.sin(a) * R;
      const tri = k === 6;
      const w = 1.0 + rnd() * 0.45, h = tri ? 3.9 : 2.3 + rnd() * 1.3, d = 0.62 + rnd() * 0.25;
      const y = heightAt(x, z) - 0.35;
      const mesh = new THREE.Mesh(sarsen(w, h, d, k * 7.3), mat);
      mesh.position.set(x, y, z); mesh.rotation.set((rnd() - 0.5) * 0.08, -a + Math.PI / 2 + (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.08);
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      this.group.add(mesh);
      const glow = uniform(0);
      const sc = ORDER[this.stones.length % 3];
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), runeMat(glow, STONE_HEX[sc]));
      // on the face towards the altar, at chest height
      rune.position.set(0, 1.45, d / 2 + 0.035); mesh.add(rune); rune.rotation.y = 0;
      // a coloured crystal set into the face above the carving says what the stone calls (the grey ones have none: asleep)
      if (sc !== 'grey') {
        const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(STONE_HEX[sc]).multiplyScalar(1.3) }); gm.fog = false; gm.toneMapped = false;
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0).scale(1, 1.5, 0.6), gm);
        gem.position.set(0, 1.98, d / 2 + 0.03); mesh.add(gem);
      }
      const face = Math.atan2(C.x - x, C.z - z);
      mesh.rotation.y = face;                                                    // its broad face looks at the altar
      const col: Collider = { x, z, r: Math.max(w, d) * 0.55 };
      colliders.add(col); this.cols.push(col);
      this.stones.push({ x, z, y, h, mesh, rune, glow: glow as any, touchedBy: new Map(), col, face, color: sc });
      if (tri) {
        // its twin beside it and the lintel across the top
        const a2 = a + 0.2, x2 = C.x + Math.cos(a2) * R, z2 = C.z + Math.sin(a2) * R, y2 = heightAt(x2, z2) - 0.35;
        const m2 = new THREE.Mesh(sarsen(w, h, d, 99), mat); m2.position.set(x2, y2, z2); m2.rotation.y = Math.atan2(C.x - x2, C.z - z2);
        m2.castShadow = shadows; m2.receiveShadow = shadows; this.group.add(m2);
        const c2: Collider = { x: x2, z: z2, r: Math.max(w, d) * 0.55 }; colliders.add(c2); this.cols.push(c2);
        const top = Math.max(y + h, y2 + h) - 0.12, span = Math.hypot(x2 - x, z2 - z) + w;
        const lintel = new THREE.Mesh(sarsen(0.62, span, 0.8, 55), mat);
        lintel.position.set((x + x2) / 2, top + 0.3, (z + z2) / 2); lintel.rotation.set(0, Math.atan2(x2 - x, z2 - z), Math.PI / 2, 'YXZ');
        lintel.position.y = top; lintel.geometry.translate(0, -span / 2, 0); lintel.rotation.order = 'YXZ'; lintel.rotation.set(Math.PI / 2, Math.atan2(x2 - x, z2 - z), 0);
        lintel.castShadow = shadows; lintel.receiveShadow = shadows; this.group.add(lintel);
      }
    }
    // the altar: a low flat slab in the middle
    const altar = new THREE.Mesh(sarsen(2.2, 0.75, 1.2, 3), mat);
    altar.position.set(C.x, heightAt(C.x, C.z) - 0.25, C.z); altar.rotation.y = 0.4; altar.castShadow = shadows; altar.receiveShadow = shadows;
    this.group.add(altar);
    const ac: Collider = { x: C.x, z: C.z, r: 0.9 }; colliders.add(ac); this.cols.push(ac);

    // the vortex: a tall spinning funnel of pink light over the altar, only while summoning
    const vm = new THREE.MeshBasicMaterial({ name: 'vortex', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    vm.userData = { vortex: this.vortexU };
    this.vortex = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 0.5, 26, 32, 1, true), vm);
    this.vortex.position.set(C.x, this.centre.y + 13, C.z); this.vortex.visible = false; this.vortex.renderOrder = 4;
    this.group.add(this.vortex);
    // motes rising out of the ground inside the ring
    const mm = new THREE.MeshBasicMaterial({ color: '#ff5ec4', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    mm.fog = false;
    this.motes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), mm, 90);
    this.motes.count = 0; this.motes.frustumCulled = false;
    for (let i = 0; i < 90; i++) this.moteT.push(Math.random() * 4);
    this.group.add(this.motes);
    scene.add(this.group);
    // get him ready in the background, so he is there the moment the drone ends (hidden until then)
    setTimeout(() => { void this.loadMario(); }, 6000);
  }
  private curseU = uniform(0);

  /** the flattest clear spot on the hilltop nearest the middle of the island (the same for everybody) */
  private pickSite() {
    let best = { x: 0, z: 0, s: 1e9 };
    const tmp: Collider[] = [];
    for (let r = 0; r <= 40; r += 2) for (let a = 0; a < Math.PI * 2; a += r ? 2 / r : 7) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < 12; k++) { const b = (k / 12) * Math.PI * 2; for (const d of [3, 6, R + 1]) { const h = heightAt(x + Math.cos(b) * d, z + Math.sin(b) * d); lo = Math.min(lo, h); hi = Math.max(hi, h); } }
      tmp.length = 0; this.colliders.near(x, z, R + 2.5, tmp);
      const score = (hi - lo) + r * 0.04 + tmp.length * 3 + slopeAt(x, z) * 2;
      if (score < best.s) best = { x, z, s: score };
    }
    this.centre.x = best.x; this.centre.z = best.z; this.centre.y = heightAt(best.x, best.z);
  }

  // ------------------------------------------------------------ touching the stones
  /** the stone under the crosshair (within reach) */
  target(eye: V3, dir: V3, reach: number): DruidTarget | null {
    if (Math.hypot(eye.x - this.centre.x, eye.z - this.centre.z) > R + 6) return null;
    let best: DruidTarget | null = null;
    this.stones.forEach((s, i) => {
      // a vertical capsule round the stone
      const ox = s.x - eye.x, oz = s.z - eye.z, l2 = dir.x * dir.x + dir.z * dir.z;
      const t = l2 > 1e-6 ? (ox * dir.x + oz * dir.z) / l2 : 0;
      if (t < 0 || t > reach) return;
      const px = eye.x + dir.x * t, pz = eye.z + dir.z * t, py = eye.y + dir.y * t;
      if (Math.hypot(px - s.x, pz - s.z) > 0.75 || py < s.y || py > s.y + s.h + 0.3) return;
      const d = Math.hypot(ox, oz);
      if (!best || d < best.dist) best = { i, dist: d };
    });
    return best;
  }
  prompt(i = -1): { name: string; hint: string } {
    const st = this.stones[i], c = st?.color ?? 'grey';
    const name = c === 'red' ? 'Red standing stone' : c === 'blue' ? 'Blue standing stone' : 'Grey standing stone';
    if (this.phase === 'summon') return { name, hint: 'Something is coming...' };
    if (this.phase !== 'idle') return { name, hint: 'The stones are silent while he walks the island' };
    if (this.busy()) return { name, hint: 'The stones are silent: something is in the sky' };
    if (c === 'grey') return { name, hint: 'E touch the stone (it is still asleep)' };
    const n = this.touchedOf(c).stones;
    return { name, hint: n > 0 ? `E touch: ${n} ${c} stone${n > 1 ? 's' : ''} humming, touch another ${c} one` : `E touch (two ${c} stones together call something)` };
  }
  /** the stones of a colour touched lately, and by whom */
  private touchedOf(c: StoneColor) {
    const now = performance.now() / 1000, who = new Set<number>();
    let stones = 0;
    for (const s of this.stones) {
      if (s.color !== c) continue;
      let lit = false;
      for (const [id, t] of s.touchedBy) if (now - t < CALL_WINDOW) { lit = true; who.add(id); }
      if (lit) stones++;
    }
    return { stones, who };
  }
  /** I touch stone i (or a remote player did) */
  touch(i: number, who = this.myId(), remote = false) {
    const s = this.stones[i]; if (!s || this.phase !== 'idle' || this.busy()) return;
    s.touchedBy.set(who, performance.now() / 1000);
    this.sound?.('touch', remote ? 0.4 : 1);
    if (!remote) this.onTouch?.(i);
    if (s.color === 'grey') { if (!remote) this.say?.('The grey stone is cold. It is still asleep.'); return; }
    if (!this.remote) {
      // a call: two stones of one colour touched together, or every player on the island has touched one of that colour
      const t = this.touchedOf(s.color), ids = new Set<number>([this.myId(), ...this.players().map((p) => p.id)]);
      const everyone = ids.size > 1 && [...ids].every((id) => t.who.has(id));
      if (t.stones >= 2 || everyone) {
        for (const q of this.stones) q.touchedBy.clear();
        if (s.color === 'red') this.setPhase('summon');
        else this.onCall?.(s.color);
      } else if (!remote) this.say?.(`The ${s.color} stone hums under your hand. Touch another ${s.color} stone...`);
    }
  }

  // ------------------------------------------------------------ phases
  setPhase(p: DruidPhase, remote = false) {
    if (p === this.phase) return;
    this.phase = p; this.t = 0;
    if (p === 'summon') {
      this.playSummon();
      this.say?.('The ground trembles. The stones are calling something...');
    } else if (p === 'alive') {
      this.stopSummon();
      this.spawnMario();
    } else if (p === 'dying') {
      this.m.vy = 9; this.m.ground = false;
      this.say?.('Mario is gone. The sky begins to clear.');
    } else if (p === 'idle') {
      this.stopSummon(); this.away = false;
      if (this.mario) this.mario.root.visible = false;
      for (const s of this.stones) s.touchedBy.clear();
    }
    if (!remote) this.onPhase?.(p);
  }
  private playSummon() {
    try {
      this.summonAudio ??= new Audio(summonUrl);
      this.summonAudio.currentTime = 0; this.summonAudio.volume = 0.9;
      void this.summonAudio.play().catch(() => {});
    } catch { /* no audio */ }
  }
  private stopSummon() { try { this.summonAudio?.pause(); } catch { /* */ } }

  private spawnMario() {
    const C = this.centre;
    this.m.x = C.x; this.m.z = C.z - 2.2; this.m.y = heightAt(this.m.x, this.m.z); this.m.yaw = 0; this.m.vy = 4; this.m.ground = false; this.hp = HP;
    this.ai.mode = 'idle'; this.ai.modeT = 2.5; this.ai.catT = 15 + Math.random() * 10;
    this.flashT = 0.6;
    this.loadMario();
    this.sayItsMe(1);
    this.voiceT = 55 + Math.random() * 15;
    this.sound?.('poof', 1);
  }
  /** Mario has gone down the warp pipe (the secret level): he is not on the island, nobody can hit him */
  away = false;
  /** where Mario is (feet) */
  marioPos() { return { x: this.m.x, y: this.m.y, z: this.m.z }; }
  sayItsMe(vol: number) {
    try { this.itsMe ??= new Audio(itsMeUrl); this.itsMe.currentTime = 0; this.itsMe.volume = Math.max(0, Math.min(1, vol)); void this.itsMe.play().catch(() => {}); } catch { /* */ }
  }
  private loading = false;
  private async loadMario() {
    if (this.mario) { this.mario.root.visible = this.phase === 'alive' || this.phase === 'dying'; return; }
    if (this.loading) return;
    this.loading = true;
    try {
      const buf = await (await fetch(marioUrl)).arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      // the file's materials use the old specular-glossiness extension (no longer read), so its two colour textures (the
      // body, and the eyes with a see-through surround) are taken straight out of the file and decoded here
      const tex = await glbImages(buf);
      gltf.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const eye = o.material?.name === 'eye_tx';
        o.material = new THREE.MeshStandardMaterial({ map: tex[eye ? 1 : 0], roughness: 0.6, metalness: 0, side: THREE.DoubleSide, alphaTest: eye ? 0.4 : 0 });
      });
      this.mario = new MarioRig(gltf.scene as unknown as THREE.Object3D);
      this.group.add(this.mario.root);
      this.mario.root.visible = this.phase === 'alive' || this.phase === 'dying';
    } catch (e) { console.warn('Mario failed to load', e); }
  }

  // ------------------------------------------------------------ hits
  /** a swing from the eye along dir: did it hit Mario? */
  raycast(eye: V3, dir: V3, reach: number): number | null {
    if (this.phase !== 'alive') return null;
    const cx = this.m.x - eye.x, cy = this.m.y + 0.7 - eye.y, cz = this.m.z - eye.z;
    const t = cx * dir.x + cy * dir.y + cz * dir.z;
    if (t < 0 || t > reach + 0.4) return null;
    const dx = cx - dir.x * t, dy = cy - dir.y * t, dz = cz - dir.z * t;
    return Math.hypot(dx, dy * 0.6, dz) < 0.75 ? t : null;
  }
  /** I hit him (the host applies it; a client sends it) */
  hit(dmg: number, fromX: number, fromZ: number) {
    this.sound?.('bonk', 1);
    if (this.remote) { this.onHit?.(dmg); this.m.hurt = 0.4; return; }
    this.damage(dmg, fromX, fromZ);
  }
  damage(dmg: number, fromX: number, fromZ: number) {
    if (this.phase !== 'alive' || this.away || this.ai.inv > 0) return;
    this.ai.inv = 0.35;
    this.hp -= dmg >= 25 ? 2 : 1;
    this.m.hurt = 0.45;
    const a = Math.atan2(this.m.x - fromX, this.m.z - fromZ);
    this.m.x += Math.sin(a) * 0.9; this.m.z += Math.cos(a) * 0.9; this.m.vy = 3.5; this.m.ground = false;
    if (this.hp <= 0) this.setPhase('dying');
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, me: V3, onIsland: boolean) {
    this.t += dt;
    // while he is about he keeps announcing himself, about once a minute (quieter the further off he is)
    if (this.phase === 'alive' && !this.away) {
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = 55 + Math.random() * 15;
        const d = Math.hypot(this.m.x - me.x, this.m.z - me.z);
        if (onIsland && d < 90) this.sayItsMe(1 - 0.8 * Math.min(1, d / 90));
      }
    }
    const C = this.centre;
    // the sky: curses while summoning (over the whole drone), stays cursed while he lives, clears over a few seconds after
    const want = this.phase === 'summon' ? Math.min(1, this.t / SUMMON_S) : this.phase === 'alive' ? 1 : this.phase === 'dying' ? Math.max(0, 1 - this.t / 6) : 0;
    this.curse += (want - this.curse) * Math.min(1, dt * (this.phase === 'summon' ? 4 : 0.8));
    if (!onIsland) this.curse = Math.min(this.curse, 0);
    this.curseU.value = Math.min(1, this.curse * 1.3);
    // runes: lit while touched (in time), all of them while summoning / cursed
    const now = performance.now() / 1000;
    for (const s of this.stones) {
      let lit = 0; for (const t of s.touchedBy.values()) if (now - t < (s.color === 'grey' ? 4 : CALL_WINDOW)) lit = 1;
      // a faint glow all the time (so you can see each stone's colour), bright while touched
      const goal = this.phase === 'summon' ? (s.color === 'red' ? 1 : 0.4) * (0.6 + 0.4 * Math.min(1, this.t / 4)) : this.phase === 'alive' ? 0.7 : s.color === 'grey' ? lit * 0.5 : Math.max(0.28, lit);
      s.glow.value += (goal - s.glow.value) * Math.min(1, dt * 3);
      s.rune.visible = s.glow.value > 0.01;
    }
    // summoning effects
    this.vortex.visible = this.phase === 'summon' || this.flashT > 0;
    if (this.vortex.visible) {
      const k = this.phase === 'summon' ? Math.min(1, this.t / SUMMON_S) : this.flashT / 0.6;
      this.vortexU.value = 0.15 + 0.85 * k;
      this.vortex.scale.set(0.4 + k * 0.8, 0.5 + k * 0.6, 0.4 + k * 0.8);
      this.vortex.rotation.y += dt * (1 + k * 4);
    }
    this.flashT = Math.max(0, this.flashT - dt);
    // motes
    const mN = this.phase === 'summon' ? Math.floor(20 + 70 * Math.min(1, this.t / SUMMON_S)) : 0;
    this.motes.count = mN;
    if (mN) {
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
      for (let i = 0; i < mN; i++) {
        this.moteT[i] += dt * (0.8 + (i % 5) * 0.12);
        const tt = this.moteT[i] % 4, a = i * 2.39996 + tt * 0.8, r = 1.2 + (i % 9) * 0.65 - tt * 0.25;
        pv.set(C.x + Math.cos(a) * r, C.y + tt * 2.2, C.z + Math.sin(a) * r);
        sv.setScalar(1 - tt / 4.5); M.compose(pv, q, sv); this.motes.setMatrixAt(i, M);
      }
      this.motes.instanceMatrix.needsUpdate = true;
    }
    // host: the summoning ends when the drone does
    if (!this.remote && this.phase === 'summon' && this.t >= SUMMON_S) this.setPhase('alive');
    if (!this.remote && this.phase === 'dying' && this.t > 3.2) this.setPhase('idle');
    // Mario
    if ((this.phase === 'alive' || this.phase === 'dying') && this.away) { if (this.mario) this.mario.root.visible = false; }
    else if (this.phase === 'alive' || this.phase === 'dying') {
      if (!this.remote) this.think(dt);
      else this.coast(dt);
      this.cats?.scare(this.m.x, this.m.z, 7);
      this.pose(dt);
    }
    void me;
  }

  /** host: where he goes */
  private think(dt: number) {
    const m = this.m, ai = this.ai;
    ai.inv = Math.max(0, ai.inv - dt);
    if (this.phase === 'dying') { this.fallDeath(dt); return; }
    const pl = this.players();
    // nearest player
    let tgt: { x: number; z: number } | null = null, td = 1e9;
    for (const p of pl) { const d = Math.hypot(p.x - m.x, p.z - m.z); if (d < td && Math.abs(p.x) < 500 && Math.abs(p.z) < 500) { td = d; tgt = p; } }
    ai.modeT -= dt; ai.catT -= dt;
    if (ai.mode !== 'cat' && ai.catT <= 0 && this.cats) {
      const cs = this.cats.list(); let ci = -1, cd = 45;
      cs.forEach((c, i) => { const d = Math.hypot(c.x - m.x, c.z - m.z); if (d < cd) { cd = d; ci = i; } });
      if (ci >= 0) { ai.mode = 'cat'; ai.cat = ci; ai.modeT = 7 + Math.random() * 4; this.say?.('Mario is chasing a cat!'); }
      ai.catT = 18 + Math.random() * 20;
    }
    if (ai.mode === 'cat' && (ai.modeT <= 0 || !this.cats)) { ai.mode = 'follow'; }
    if (ai.mode === 'idle' && ai.modeT <= 0) ai.mode = 'follow';
    let gx = m.x, gz = m.z, speed = 0;
    if (ai.mode === 'cat' && this.cats) {
      const c = this.cats.list()[ai.cat]; if (c) { gx = c.x; gz = c.z; speed = 7.2; }
    } else if (ai.mode === 'follow' && tgt) {
      // keep a few metres off, run to catch up
      const keep = 3.2;
      if (td > keep) { const k = (td - keep) / td; gx = m.x + (tgt.x - m.x) * k; gz = m.z + (tgt.z - m.z) * k; speed = td > 12 ? 6.5 : 3.2; }
      else m.yaw = turn(m.yaw, Math.atan2(-(tgt.x - m.x), -(tgt.z - m.z)), dt * 6);
    }
    this.moveTo(gx, gz, speed, dt);
    // the occasional hop while running
    ai.hopT -= dt;
    if (ai.hopT <= 0 && m.ground && speed > 3) { m.vy = 7; m.ground = false; ai.hopT = 3 + Math.random() * 5; this.sound?.('hop', this.near()); }
    this.gravity(dt);
  }
  private moveTo(gx: number, gz: number, speed: number, dt: number) {
    const m = this.m, dx = gx - m.x, dz = gz - m.z, d = Math.hypot(dx, dz);
    if (d < 0.2 || speed <= 0) { m.speed += (0 - m.speed) * Math.min(1, dt * 8); return; }
    let nx = m.x + (dx / d) * Math.min(d, speed * dt), nz = m.z + (dz / d) * Math.min(d, speed * dt);
    if (heightAt(nx, nz) < 0.2) { nx = m.x; nz = m.z; }                         // he doesn't swim
    m.x = nx; m.z = nz; m.speed += (speed - m.speed) * Math.min(1, dt * 6);
    m.yaw = turn(m.yaw, Math.atan2(-dx, -dz), dt * 9);
  }
  private gravity(dt: number) {
    const m = this.m, g = heightAt(m.x, m.z);
    m.vy -= 22 * dt; m.y += m.vy * dt;
    if (m.y <= g) { m.y = g; m.vy = 0; m.ground = true; } else if (m.y > g + 0.05) m.ground = false;
  }
  /** the classic exit: up, a pause at the top, then down through the ground */
  private fallDeath(dt: number) { const m = this.m; m.vy -= (this.t < 0.5 ? 6 : 24) * dt; m.y += m.vy * dt; m.speed = 0; }
  /** client: slide towards what the host last said */
  private net = { x: 0, y: 0, z: 0, yaw: 0 };
  private coast(dt: number) {
    const m = this.m, k = Math.min(1, dt * 10);
    if (this.phase === 'dying') { this.fallDeath(dt); return; }
    const ox = m.x, oz = m.z;
    m.x += (this.net.x - m.x) * k; m.z += (this.net.z - m.z) * k; m.y += (this.net.y - m.y) * k;
    m.yaw = turn(m.yaw, this.net.yaw, dt * 10);
    m.speed = Math.hypot(m.x - ox, m.z - oz) / Math.max(dt, 1e-3);
    m.ground = Math.abs(m.y - heightAt(m.x, m.z)) < 0.08;
    m.hurt = Math.max(0, m.hurt - dt);
  }
  private near() { return 0.8; }
  /** host -> clients, ~10 times a second */
  exportState() { const m = this.m; return [+m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), +m.yaw.toFixed(2), this.hp, m.hurt > 0.2 ? 1 : 0]; }
  importState(r: number[]) {
    if (!Array.isArray(r)) return;
    this.net.x = r[0]; this.net.y = r[1]; this.net.z = r[2]; this.net.yaw = r[3];
    if (this.hp !== r[4]) { this.hp = r[4]; }
    if (r[5]) this.m.hurt = Math.max(this.m.hurt, 0.3);
    if (this.phase === 'alive' && Math.hypot(this.m.x - r[0], this.m.z - r[2]) > 8) { this.m.x = r[0]; this.m.z = r[2]; this.m.y = r[1]; }
  }
  /** saved with the world / sent to someone joining */
  capture() { return { p: this.phase === 'alive' ? 'alive' : 'idle', hp: this.hp, x: +this.m.x.toFixed(2), z: +this.m.z.toFixed(2) }; }
  restore(s: any) {
    if (!s || s.p !== 'alive') { if (this.phase !== 'idle') this.setPhase('idle', true); return; }
    this.setPhase('alive', true);
    this.hp = Math.max(1, Math.min(HP, s.hp ?? HP));
    if (typeof s.x === 'number') { this.m.x = s.x; this.m.z = s.z; this.m.y = heightAt(s.x, s.z); this.net.x = s.x; this.net.z = s.z; this.net.y = this.m.y; }
    try { this.itsMe?.pause(); } catch { /* */ }
  }

  private pose(dt: number) {
    const rig = this.mario; if (!rig) return;
    const m = this.m;
    m.hurt = Math.max(0, m.hurt - dt);
    rig.root.visible = this.phase === 'alive' || (this.phase === 'dying' && m.y > heightAt(m.x, m.z) - 3);
    rig.root.position.set(m.x, m.y, m.z);
    rig.root.rotation.y = m.yaw;
    rig.update(dt, m.speed, !m.ground, m.hurt, this.phase === 'dying', this.ai.mode === 'idle' && this.phase === 'alive');
  }

  dispose() { for (const c of this.cols) this.colliders.remove(c); }
}

/** the images embedded in a .glb, as textures (in the file's order) */
async function glbImages(buf: ArrayBuffer): Promise<THREE.Texture[]> {
  const dv = new DataView(buf), jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const out: THREE.Texture[] = [];
  for (const im of json.images ?? []) {
    const bv = json.bufferViews[im.bufferView];
    const blob = new Blob([new Uint8Array(buf, binStart + (bv.byteOffset ?? 0), bv.byteLength)], { type: im.mimeType });
    const bmp = await createImageBitmap(blob);
    const t = new THREE.Texture(bmp as any);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    out.push(t);
  }
  return out;
}

const turn = (a: number, b: number, k: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + Math.max(-k, Math.min(k, d)); };

/**
 * The GLB's single mesh, rigged by hand: hips, two legs, two arms (lowered from the T-pose), the head. Coordinates of the model:
 * z up, -y forward, about 18.8 units tall; the rig is built in those units and the root scales and turns it into the world.
 */
class MarioRig {
  readonly root = new THREE.Group();
  private bones: Record<'root' | 'body' | 'legL' | 'legR' | 'armL' | 'armR' | 'head', THREE.Bone>;
  private t = 0;
  private hop = 0;
  constructor(scene: THREE.Object3D) {
    const H = 1.45, S = H / 18.8;
    const holder = new THREE.Group();
    holder.scale.setScalar(S);
    holder.rotation.x = -Math.PI / 2;                       // z-up model into y-up
    this.root.add(holder);
    holder.rotation.z = Math.PI;                            // its front (-y) to the game's forward (-z)
    // bones (model units)
    const B = () => new THREE.Bone();
    const root = B(), body = B(), legL = B(), legR = B(), armL = B(), armR = B(), head = B();
    body.position.set(0, 0, 5.6); root.add(body);
    legL.position.set(-1.4, 0, 0); legR.position.set(1.4, 0, 0); body.add(legL, legR);
    armL.position.set(-3.3, 0, 4.0); armR.position.set(3.3, 0, 4.0); body.add(armL, armR);
    head.position.set(0, 0, 5.7); body.add(head);
    holder.add(root);
    this.bones = { root, body, legL, legR, armL, armR, head };
    const list = [root, body, legL, legR, armL, armR, head];
    holder.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(list);
    // every mesh in the file becomes a skinned mesh weighted by where each vertex sits
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const src of meshes) {
      // the raw mesh (z up, as modelled): the file's own root node turns it y-up, but the rig and the holder do that here
      const g = src.geometry.clone();
      const P = g.attributes.position, n = P.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let i = 0; i < n; i++) {
        const x = P.getX(i), z = P.getZ(i);
        // leg share (below the hips), arm share (out past the shoulders), head share (above the neck)
        const leg = 1 - sm(4.9, 6.3, z), arm = sm(3.0, 3.9, Math.abs(x)) * sm(7.0, 7.9, z) * (1 - sm(11.6, 12.2, z)), hd = sm(10.9, 11.7, z) * (1 - sm(3.6, 4.2, Math.abs(x)));
        const w: [number, number][] = [];
        if (leg > 0) w.push([x < 0 ? 2 : 3, leg]);
        if (arm > 0) w.push([x < 0 ? 4 : 5, arm * (1 - leg)]);
        if (hd > 0) w.push([6, hd * (1 - leg) * (1 - arm)]);
        const rest = Math.max(0, 1 - w.reduce((a, b) => a + b[1], 0));
        w.push([1, rest]);
        w.sort((a, b) => b[1] - a[1]);
        const tot = w.slice(0, 4).reduce((a, b) => a + b[1], 0) || 1;
        w.slice(0, 4).forEach(([b, v], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = v / tot; });
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      const mesh = new THREE.SkinnedMesh(g, src.material as THREE.Material);
      mesh.castShadow = true; mesh.frustumCulled = false;
      holder.add(mesh);
      mesh.updateMatrixWorld(true);
      mesh.bind(skeleton);                                  // bound where it stands, so the rest pose draws the model as it is
    }
  }
  /** speed m/s, airborne, hurt 0..0.45, dying, idle (looking about) */
  update(dt: number, speed: number, air: boolean, hurt: number, dying: boolean, idle: boolean) {
    const b = this.bones;
    const run = Math.min(1, speed / 6.5);
    this.t += dt * (2.2 + speed * 1.55);
    const s = Math.sin(this.t), c = Math.cos(this.t);
    this.hop += ((air ? 1 : 0) - this.hop) * Math.min(1, dt * 12);
    // arms down from the T-pose, swinging against the legs; in the air the classic one-fist-up jump
    const down = 1.2;
    b.armL.rotation.set(0, -down * (1 - this.hop * 0.4) + s * 0.1 * run, 0);
    b.armR.rotation.set(0, down * (1 - this.hop) - this.hop * 1.2, 0);
    b.armL.rotation.x = -s * 0.9 * run; b.armR.rotation.x = s * 0.9 * run * (1 - this.hop);
    // legs: stride, tucked up in the air
    b.legL.rotation.x = s * 0.85 * run - this.hop * 0.6; b.legR.rotation.x = -s * 0.85 * run + this.hop * 0.35;
    // body: bob and lean into the run, flinch when hit, wobble when idle
    const flinch = hurt > 0 ? Math.sin(hurt * 30) * 0.25 : 0;
    b.body.position.z = 5.6 + Math.abs(c) * 0.5 * run;
    b.body.rotation.x = -0.18 * run + flinch;
    b.head.rotation.z = idle ? Math.sin(this.t * 0.4) * 0.5 : 0;
    b.root.rotation.z = 0;
    if (dying) { b.armL.rotation.set(0, 0.3, 0); b.armR.rotation.set(0, -0.3, 0); b.legL.rotation.x = 0.4; b.legR.rotation.x = -0.4; }
    this.root.scale.setScalar(hurt > 0 ? 1 + Math.sin(hurt * 40) * 0.05 : 1);
  }
}
