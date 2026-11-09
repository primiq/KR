// Butterflies: a few dozen round you by day over the island's land, in many colours. Each flutters about on its own
// wandering path (bobbing a little with every wingbeat), now and then settles on the grass to rest with its wings
// slowly opening and closing, then takes off again. Ones you leave behind are moved to somewhere new round you.
// Cheap to draw: the left wings, the right wings and the bodies are three instanced meshes (one draw each, whatever the
// count), coloured per butterfly; only matrices change from frame to frame.
import * as THREE from 'three';
import { heightAt } from './island';

const N = 36, NEAR = 8, FAR = 34, LOSE = 46;
const PALETTE = ['#f28a1a', '#2f7bff', '#ffd23a', '#f4f1e6', '#ff6fb1', '#9be35a', '#e8452e', '#8f6cff', '#36d1c4'];

interface Fly { x: number; y: number; z: number; yaw: number; ph: number; speed: number; seed: number; rest: number; restY: number; alive: boolean }

/** one wing (the right one; the left is its mirror), hinged along the body (+z forward, wing out along +x) */
function wingGeometry(): THREE.BufferGeometry {
  // a fore wing and a hind wing, rounded, as one flat shape
  const s = new THREE.Shape();
  s.moveTo(0, 0.012);
  s.bezierCurveTo(0.03, 0.05, 0.075, 0.06, 0.085, 0.03);
  s.bezierCurveTo(0.09, 0.0, 0.06, -0.01, 0.035, -0.008);
  s.bezierCurveTo(0.065, -0.025, 0.06, -0.06, 0.03, -0.055);
  s.bezierCurveTo(0.012, -0.05, 0.004, -0.03, 0, -0.018);
  s.lineTo(0, 0.012);
  const g = new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);   // lie flat: the shape's y runs along -z
  g.scale(1, 1, -1);                                                    // (so the fore wing points ahead, +z)
  g.deleteAttribute('uv');
  return g;
}

export class Butterflies {
  readonly group = new THREE.Group();
  private flies: Fly[] = [];
  private wingR: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private body: THREE.InstancedMesh;
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private p = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  private base = new THREE.Matrix4(); private hinge = new THREE.Matrix4();

  constructor(scene: THREE.Object3D) {
    const wing = wingGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    this.wingR = new THREE.InstancedMesh(wing, mat, N);
    this.wingL = new THREE.InstancedMesh(wing.clone().scale(-1, 1, 1), mat, N);
    this.body = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.006, 0.05, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1d1712', roughness: 0.9 }), N);
    const c = new THREE.Color();
    for (const im of [this.wingR, this.wingL]) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    for (let i = 0; i < N; i++) {
      c.set(PALETTE[i % PALETTE.length]);
      this.wingR.setColorAt(i, c); this.wingL.setColorAt(i, c);
      this.flies.push({ x: 0, y: -1e4, z: 0, yaw: 0, ph: Math.random() * 10, speed: 0.9 + Math.random() * 0.8, seed: Math.random() * 100, rest: 0, restY: 0, alive: false });
    }
    for (const im of [this.wingR, this.wingL, this.body]) { im.frustumCulled = false; im.count = 0; this.group.add(im); }
    scene.add(this.group);
  }

  /** `me`: where you are; `day`: 0..1 how light it is; `away`: not on the island (a cave, a level...) */
  update(dt: number, me: { x: number; y: number; z: number }, day: number, away: boolean) {
    this.t += dt;
    const show = !away && day > 0.35;
    this.group.visible = show;
    if (!show) { for (const f of this.flies) f.alive = false; return; }
    dt = Math.min(dt, 0.05);
    let n = 0;
    for (const f of this.flies) {
      if (!f.alive || Math.hypot(f.x - me.x, f.z - me.z) > LOSE) this.place(f, me);
      if (!f.alive) continue;
      const t = this.t + f.seed;
      const ground = heightAt(f.x, f.z);
      if (f.rest > 0) {
        // resting on the grass: wings slowly opening and closing, then off again
        f.rest -= dt;
        f.y += (ground + 0.18 - f.y) * Math.min(1, dt * 4);
      } else {
        // a wandering heading (turning this way and that), a fluttering speed, bobbing with each beat
        f.yaw += (Math.sin(t * 0.7) * 1.3 + Math.sin(t * 1.9 + 1.3) * 0.8) * dt;
        const sp = f.speed * (0.7 + 0.5 * Math.max(0, Math.sin(t * 2.3)));
        const nx = f.x - Math.sin(f.yaw) * sp * dt, nz = f.z - Math.cos(f.yaw) * sp * dt;
        // (over land only: turn back at the water's edge)
        if (heightAt(nx, nz) > 0.3) { f.x = nx; f.z = nz; } else f.yaw += Math.PI * 0.6;
        const want = ground + 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(t * 0.37)) + 0.07 * Math.sin(t * 22);
        f.y += (want - f.y) * Math.min(1, dt * 2.5);
        if (Math.random() < dt * 0.025) f.rest = 3 + Math.random() * 6;
      }
      // the wings: quick beats in flight, slow open and shut at rest
      const flap = f.rest > 0 ? 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.6)) : 0.15 + 1.05 * (0.5 + 0.5 * Math.sin(t * 24 + f.ph));
      const pitch = f.rest > 0 ? 0 : -0.25 + 0.1 * Math.sin(t * 24 + f.ph);
      this.e.set(pitch, f.yaw + Math.PI, 0); this.q.setFromEuler(this.e);
      this.base.compose(this.p.set(f.x, f.y, f.z), this.q, this.one);
      this.body.setMatrixAt(n, this.base);
      this.hinge.makeRotationZ(flap); this.m.multiplyMatrices(this.base, this.hinge); this.wingR.setMatrixAt(n, this.m);
      this.hinge.makeRotationZ(-flap); this.m.multiplyMatrices(this.base, this.hinge); this.wingL.setMatrixAt(n, this.m);
      n++;
    }
    for (const im of [this.wingR, this.wingL, this.body]) { im.count = n; im.instanceMatrix.needsUpdate = true; }
  }

  /** somewhere new round you, over land (not in the water) */
  private place(f: Fly, me: { x: number; z: number }) {
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, d = NEAR + Math.random() * (FAR - NEAR), x = me.x + Math.cos(a) * d, z = me.z + Math.sin(a) * d, h = heightAt(x, z);
      if (h < 0.6 || h > 60) continue;
      f.x = x; f.z = z; f.y = h + 0.8 + Math.random(); f.yaw = Math.random() * Math.PI * 2; f.rest = 0; f.alive = true;
      return;
    }
    f.alive = false;
  }
}
