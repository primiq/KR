// The cloud door's skydive: you jump out high above the island, freefall for about 40 seconds (steer with the move keys, look around),
// the parachute opens by itself at 420 m, and you drift down under the canopy. Gate to gate it takes around two and a half minutes.
// While it runs the player is "seated" (the physics are off) and this class moves them. Other players see a canopy over you.
// Babylon port: Castaway's code, drawn by render/mirror.ts (which skips the canopy's suspension lines).
import * as THREE from 'three';

/** a position or velocity (Babylon's Vector3 here) */
interface PV { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
import { Mesher } from '../net/playerModel';
import { heightAt } from './island';

export const START_ABOVE = 900;      // metres above the ground at the jump
const OPEN_AT = 300;                 // the canopy opens this far above the ground
const TERMINAL = 55, CHUTE_V = 6.5;  // m/s
const COLS = ['#d94a3a', '#f2efe6'];

function canopy() {
  const M = new Mesher(), R = 3.4, n = 8;
  for (let i = 0; i < n; i++) M.add(new THREE.SphereGeometry(R, 8, 7, (i / n) * Math.PI * 2, Math.PI * 2 / n, 0, Math.PI / 2), COLS[i % 2], 0, 0, 0, 0, 0, 0, 1, 0.55, 1);
  M.cyl(R * 0.98, R * 0.98, 0.1, '#8a2a20', 0, 0.02, 0, 1, 1, 16);
  const mesh = M.build(false);
  (mesh.material as THREE.Material).side = THREE.DoubleSide;
  const g = new THREE.Group(); g.add(mesh);
  // suspension lines down to the harness
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pts.push(Math.cos(a) * R * 0.97, 0.05, Math.sin(a) * R * 0.97, Math.cos(a) * 0.25, -2.5, Math.sin(a) * 0.25); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#e8e0c8' })); lines.frustumCulled = false; g.add(lines);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

export class Skydive {
  active = false;
  /** 'free' falling, or 'chute' under the canopy */
  phase: 'free' | 'chute' = 'free';
  private vel = new THREE.Vector3();
  private t = 0;
  private open = 0;                  // 0..1 canopy opening
  private mine = canopy();
  private remote = new Map<number, THREE.Group>();
  private hud: HTMLDivElement;
  private flash: HTMLDivElement;
  onChute: (() => void) | null = null;
  onLand: (() => void) | null = null;
  say: (t: string) => void = () => {};
  wind: (v: number) => void = () => {};

  constructor(private scene: THREE.Scene) {
    this.mine.visible = false; scene.add(this.mine);
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:50%;bottom:130px;transform:translateX(-50%);z-index:5;display:none;color:#fff;font:700 18px system-ui,sans-serif;text-align:center;text-shadow:0 1px 5px rgba(0,0,0,.85);pointer-events:none';
    this.flash = document.createElement('div');
    this.flash.style.cssText = 'position:fixed;inset:0;z-index:6;background:#fff;opacity:0;pointer-events:none;transition:opacity .15s';
    document.body.append(this.hud, this.flash);
  }

  /** jump: from where the cloud door opens, high above the spawn side of the island */
  start(p: { pos: PV; seated: boolean; cave: any; yaw: number; pitch: number; vel: PV; mode: string }, x: number, z: number, yaw: number) {
    this.active = true; this.phase = 'free'; this.t = 0; this.open = 0;
    p.cave = null; p.seated = true; p.mode = 'walk'; p.vel.set(0, 0, 0);
    p.pos.set(x, Math.max(0, heightAt(x, z)) + START_ABOVE, z); p.yaw = yaw; p.pitch = -0.9;
    this.vel.set(-Math.sin(yaw) * 6, 0, -Math.cos(yaw) * 6);
    this.flash.style.transition = 'none'; this.flash.style.opacity = '1';
    requestAnimationFrame(() => { this.flash.style.transition = 'opacity .9s'; this.flash.style.opacity = '0'; });
    this.say('You jump out of the clouds! A / D slide, W dives, S brakes. The parachute opens by itself.');
  }

  update(dt: number, p: { pos: PV; seated: boolean; yaw: number; pitch: number; vel: PV; lastY?: number; onGround?: boolean }, move: { x: number; y: number }, dead: boolean) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05); this.t += dt;
    if (dead) { this.stop(p); return; }
    // wanted horizontal velocity from the stick / keys (relative to where you look)
    // A / D bank the canopy (turn as well as slide), W dives (faster, further forward), S brakes (slower fall, hangs back)
    const dive = Math.max(0, move.y), brake = Math.max(0, -move.y);
    if (this.phase === 'chute') p.yaw -= move.x * 0.9 * dt * Math.min(1, this.open);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fwd = this.phase === 'free' ? 8 + dive * 18 - brake * 8 : 5 + dive * 9 - brake * 4.5, side = this.phase === 'free' ? 14 : 9;
    const wx = -sy * fwd * move.y + cy * move.x * side;
    const wz = -cy * fwd * move.y - sy * move.x * side;
    const k = 1 - Math.exp(-dt * (this.phase === 'free' ? 1.4 : 1.0));
    this.vel.x += (wx - this.vel.x) * k; this.vel.z += (wz - this.vel.z) * k;
    const ground = Math.max(0, heightAt(p.pos.x, p.pos.z)), alt = p.pos.y - ground;
    if (this.phase === 'free') {
      const tv = TERMINAL * (1 + dive * 0.4 - brake * 0.35);                          // dive to fall faster, spread out to fall slower
      const cap = Math.abs(this.vel.y) > tv ? 0.9 : 1;
      this.vel.y = Math.max(-tv, this.vel.y - 9.8 * dt * Math.max(0, 1 - Math.abs(this.vel.y) / (tv * 1.02)) * cap);
      if (this.vel.y < -tv) this.vel.y += (-tv - this.vel.y) * (1 - Math.exp(-dt * 1.5));
      if (alt <= OPEN_AT) { this.phase = 'chute'; this.t = 0; this.onChute?.(); this.say('The parachute opens! A / D bank, W dives, S brakes.'); }
    } else {
      this.open = Math.min(1, this.open + dt / 1.6);
      const sink = CHUTE_V * (1 + dive * 0.6 - brake * 0.45);
      const goal = -sink * (alt < 14 ? 0.55 + alt / 31 : 1);                         // a gentle flare near the ground
      this.vel.y += (goal - this.vel.y) * (1 - Math.exp(-dt * (this.open < 1 ? 1.6 : 2.5)));
    }
    p.pos.x += this.vel.x * dt; p.pos.y += this.vel.y * dt; p.pos.z += this.vel.z * dt;
    p.vel.set(this.vel.x, this.vel.y, this.vel.z);
    this.wind(Math.min(1, Math.abs(this.vel.y) / TERMINAL) * (this.phase === 'free' ? 1 : 0.25));
    if (p.pos.y - Math.max(0, heightAt(p.pos.x, p.pos.z)) <= 0.08) {
      p.pos.y = Math.max(0, heightAt(p.pos.x, p.pos.z)) + 0.02;
      this.stop(p); this.onLand?.(); this.say('Touchdown!');
    }
    this.mine.visible = this.phase === 'chute';
    this.placeCanopy(this.mine, p.pos.x, p.pos.y, p.pos.z, p.yaw, this.open);
    // the readout
    const a = Math.max(0, Math.round(alt)), ts = Math.round(Math.abs(this.vel.y) * 3.6);
    this.hud.style.display = 'block';
    this.hud.textContent = this.phase === 'free' ? `Freefall · ${a} m · ${ts} km/h · chute opens at ${OPEN_AT} m · W dive · S brake` : `Parachute · ${a} m · ${ts} km/h · A/D bank · W dive · S brake`;
  }
  private placeCanopy(g: THREE.Group, x: number, y: number, z: number, yaw: number, open: number) {
    g.position.set(x, y + 3.6 + (1 - open) * 0.6, z); g.rotation.set(0, yaw, 0);
    g.scale.set(0.2 + 0.8 * open, 0.2 + 0.8 * open, 0.2 + 0.8 * open);
  }
  private stop(p: { seated: boolean; vel: PV; lastY?: number; pos: PV; onGround?: boolean }) {
    this.active = false; p.seated = false; p.vel.set(0, 0, 0); p.lastY = p.pos.y; p.onGround = true;
    this.mine.visible = false; this.hud.style.display = 'none'; this.wind(0);
  }
  /** other players who are skydiving (from the sync flags: 2048 dive, 4096 canopy open) */
  updateRemote(list: { id: number; x: number; y: number; z: number; yaw: number; flags: number }[]) {
    const seen = new Set<number>();
    for (const o of list) {
      if (!(o.flags & 2048) || !(o.flags & 4096)) continue;
      seen.add(o.id);
      let g = this.remote.get(o.id); if (!g) { g = canopy(); this.scene.add(g); this.remote.set(o.id, g); }
      this.placeCanopy(g, o.x, o.y, o.z, o.yaw, 1);
    }
    for (const [id, g] of this.remote) if (!seen.has(id)) { this.scene.remove(g); this.remote.delete(id); }
  }
}
