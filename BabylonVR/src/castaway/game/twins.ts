// The Twins: two small pale girls who fade into view somewhere in the dark, holding hands and singing "la la la la".
// They never do anything; if you walk up to them they are simply gone. The host simulates, clients mirror.
// Babylon port: Castaway's code, drawn by render/mirror.ts.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';
import { heightAt, slopeAt } from '../world/island';

type TState = 'hidden' | 'show' | 'fade';
const CODES: TState[] = ['hidden', 'show', 'fade'];

function girl(side: number) {
  const m = new Mesher();
  const dress = '#dfe7ee', skin = '#eef1f4', hair = '#0a0b0f';
  m.cyl(0.07, 0.21, 0.64, dress, 0, 0.4, 0, 1, 1, 12);                  // long nightgown
  m.cyl(0.065, 0.075, 0.22, dress, 0, 0.82, 0, 1, 1, 10);               // chest
  m.sph(0.096, skin, 0, 1.0, 0.0, 1, 1.08, 1, 12);                      // head
  m.sph(0.104, hair, 0, 1.025, -0.03, 1.02, 1.08, 1.0, 12);             // hair, pulled low over the back of the head
  m.box(0.17, 0.5, 0.05, hair, 0, 0.76, -0.085);                        // long hair down the back
  for (const sx of [-1, 1]) m.sph(0.023, '#000000', sx * 0.038, 1.0, 0.085, 1, 1.5, 0.7, 6); // hollow eyes
  m.sph(0.017, '#000000', 0, 0.945, 0.09, 1, 1.6, 0.7, 6);              // a small round "la"
  m.cyl(0.022, 0.018, 0.55, skin, -side * 0.095, 0.7, 0.02, 1, 1, 6, 0, 0, side * 0.08);  // outer arm, hanging
  m.cyl(0.022, 0.018, 0.23, skin, -side * 0.115, 0.76, 0.02, 1, 1, 6, 0, 0, Math.PI / 2 + 0.2 * side); // inner arm out to her sister's hand
  const mesh = m.build(false);
  mesh.castShadow = false;
  return mesh;
}

export class Twins {
  readonly group = new THREE.Group();
  remote = false;
  state: TState = 'hidden';
  x = 0; z = 0; y = 0; yaw = 0; alpha = 0;
  onSound: ((s: 'sing', x: number, z: number) => void) | null = null;
  nearFire: ((x: number, z: number, r: number) => boolean) | null = null;
  private girls: THREE.Mesh[];
  private mat: THREE.MeshBasicMaterial;
  private clock = 0; private t = 0; private life = 20; private cool = 50; private sing = 0;
  private net?: { x: number; z: number; yaw: number; st: number; a: number };

  constructor(scene: THREE.Object3D) {
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.girls = [girl(1), girl(-1)];
    this.girls.forEach((g) => { g.material = this.mat; this.group.add(g); });
    this.group.visible = false;
    scene.add(this.group);
  }

  get active() { return this.state !== 'hidden'; }

  update(dt: number, targets: { x: number; y: number; z: number }[], night: boolean) {
    this.clock += dt;
    const sdt = Math.min(dt, 0.1);
    if (this.remote) { this.puppet(sdt); return; }
    if (this.state === 'hidden') {
      this.cool -= sdt;
      if (night && this.cool <= 0 && targets.length) this.trySpawn(targets);
    } else {
      this.t += sdt;
      let d = Infinity;
      for (const q of targets) d = Math.min(d, Math.hypot(q.x - this.x, q.z - this.z));
      if (this.state === 'show') {
        this.alpha = Math.min(1, this.alpha + sdt / 3);
        this.sing -= sdt;
        if (this.sing <= 0 && this.alpha > 0.5) { this.onSound?.('sing', this.x, this.z); this.sing = 6.5 + Math.random() * 3; }
        // watch the nearest player
        let best = targets[0]; for (const q of targets) if (Math.hypot(q.x - this.x, q.z - this.z) < d + 1e-6) best = q;
        if (best) { const want = Math.atan2(best.x - this.x, best.z - this.z); let dy = want - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; this.yaw += dy * Math.min(1, sdt * 1.2); }
        if (this.t > this.life || d < 5.5 || !night || this.nearFire?.(this.x, this.z, 12) || d > 45) { this.state = 'fade'; this.t = 0; }
      } else {
        this.alpha -= sdt / (d < 7 ? 0.45 : 2.2);
        if (this.alpha <= 0) { this.alpha = 0; this.state = 'hidden'; this.cool = 80 + Math.random() * 100; }
      }
    }
    this.apply();
  }

  private trySpawn(targets: { x: number; y: number; z: number }[]) {
    const T = targets[Math.floor(Math.random() * targets.length)];
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 9;
      const x = T.x + Math.sin(a) * r, z = T.z + Math.cos(a) * r;
      if (heightAt(x, z) < 1.2 || slopeAt(x, z) > 0.35 || this.nearFire?.(x, z, 16)) continue;
      this.x = x; this.z = z; this.y = heightAt(x, z); this.yaw = Math.atan2(T.x - x, T.z - z);
      this.state = 'show'; this.t = 0; this.alpha = 0; this.life = 18 + Math.random() * 10; this.sing = 2 + Math.random() * 2;
      return;
    }
    this.cool = 10;
  }

  private apply() {
    this.group.visible = this.state !== 'hidden' && this.alpha > 0.01;
    if (!this.group.visible) return;
    const k = this.clock;
    const flick = Math.random() < 0.04 ? 0.35 : 1; // an occasional stutter, like a bad signal
    this.mat.opacity = this.alpha * 0.62 * (0.88 + Math.sin(k * 2.3) * 0.1) * flick;
    this.group.position.set(this.x, this.y + 0.1 + Math.sin(k * 1.4) * 0.05, this.z);
    this.group.rotation.set(0, this.yaw, Math.sin(k * 0.9) * 0.025);
    this.girls[0].position.x = 0.2; this.girls[1].position.x = -0.2;
    this.girls[0].rotation.z = Math.sin(k * 1.1) * 0.04; this.girls[1].rotation.z = Math.sin(k * 1.1 + 1.4) * 0.04;
  }

  exportState(): number[] { return this.state === 'hidden' ? [] : [+this.x.toFixed(2), +this.z.toFixed(2), +this.yaw.toFixed(2), CODES.indexOf(this.state), +this.alpha.toFixed(2)]; }
  importState(r: number[]) {
    if (!r.length) { if (this.net) this.net.st = 0; return; }
    const [x, z, yaw, st, a] = r;
    if (this.state === 'hidden') { this.x = x; this.z = z; this.yaw = yaw; }
    this.net = { x, z, yaw, st, a };
  }
  private puppet(dt: number) {
    const n = this.net; if (!n) return;
    const st = CODES[n.st] ?? 'hidden';
    if (st === 'hidden') { this.state = 'hidden'; this.alpha = 0; this.apply(); return; }
    if (this.state === 'hidden') { this.x = n.x; this.z = n.z; this.alpha = 0; }
    const k = Math.min(1, dt * 6);
    this.x += (n.x - this.x) * k; this.z += (n.z - this.z) * k;
    let dy = n.yaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * k; this.y = heightAt(this.x, this.z);
    this.alpha += (n.a - this.alpha) * k; this.state = st;
    this.apply();
  }
  promote() { this.remote = false; this.state = 'hidden'; this.alpha = 0; this.net = undefined; this.group.visible = false; this.cool = 60; }
}
