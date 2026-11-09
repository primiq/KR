// Seagulls: out at sea a few of them wheel over the nearest islet (or follow your boat when there is none near), gliding
// on long wings, now and then flapping, drifting over to the next islet as you sail on. By the island they leave it to the
// island's own birds. Cosmetic and local to each player.
// Cheap to draw: wings and bodies are instanced meshes (a handful of draws whatever the count), only matrices change.
import * as THREE from "three";

const N = 10;

interface Gull { a: number; r: number; h: number; v: number; ph: number; flapT: number; cx: number; cz: number; k: number }

export class Gulls {
  readonly group = new THREE.Group();
  private gulls: Gull[] = [];
  private body: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private tips: THREE.InstancedMesh[] = [];
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, "YXZ");
  private p = new THREE.Vector3(); private s = new THREE.Vector3(1, 1, 1);
  private base = new THREE.Matrix4(); private hinge = new THREE.Matrix4(); private off = new THREE.Matrix4(); private bend = new THREE.Matrix4();

  constructor(scene: THREE.Object3D) {
    const white = new THREE.MeshStandardMaterial({ color: "#f3f1ea", roughness: 0.8 }), grey = new THREE.MeshStandardMaterial({ color: "#b9c0c6", roughness: 0.8, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: "#222428", roughness: 0.8, side: THREE.DoubleSide });
    // body along -z (the head forward), a wing out along +x from the shoulder; the tip is its own part (black)
    const bodyG = new THREE.SphereGeometry(1, 8, 6).scale(0.09, 0.08, 0.3);
    const wing = (sx: number) => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.08), new THREE.Vector3(0.42 * sx, 0, -0.05), new THREE.Vector3(0.42 * sx, 0, 0.1), new THREE.Vector3(0, 0, 0.12)]).setIndex([0, 1, 2, 0, 2, 3]);
    const tip = (sx: number) => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0.3 * sx, 0, 0.04), new THREE.Vector3(0, 0, 0.1)]).setIndex([0, 1, 2]);
    const wl = wing(-1), wr = wing(1), tl = tip(-1), tr = tip(1);
    for (const g of [wl, wr, tl, tr]) g.computeVertexNormals();
    this.body = new THREE.InstancedMesh(bodyG, white, N);
    this.wingL = new THREE.InstancedMesh(wl, grey, N);
    this.wingR = new THREE.InstancedMesh(wr, grey, N);
    this.tips = [new THREE.InstancedMesh(tl, dark, N), new THREE.InstancedMesh(tr, dark, N)];
    for (const im of [this.body, this.wingL, this.wingR, ...this.tips]) { im.frustumCulled = false; im.count = 0; this.group.add(im); }
    for (let i = 0; i < N; i++) this.gulls.push({ a: Math.random() * Math.PI * 2, r: 14 + Math.random() * 18, h: 9 + Math.random() * 9, v: (Math.random() < 0.5 ? 1 : -1) * (0.25 + Math.random() * 0.15), ph: Math.random() * 10, flapT: 0, cx: 0, cz: 0, k: 0 });
    scene.add(this.group);
  }

  /** `home`: where they wheel now (the nearest islet, or you); `show`: out at sea, by day */
  update(dt: number, home: { x: number; z: number } | null, show: boolean) {
    this.t += dt;
    dt = Math.min(dt, 0.05);
    let n = 0;
    for (const g of this.gulls) {
      // (they come and go gently: grow in from nothing, shrink away)
      g.k = Math.max(0, Math.min(1, g.k + (show && home ? dt : -dt) / 3));
      if (g.k <= 0) { if (home) { g.cx = home.x; g.cz = home.z; } continue; }
      if (home) { g.cx += (home.x - g.cx) * Math.min(1, dt * 0.25); g.cz += (home.z - g.cz) * Math.min(1, dt * 0.25); }
      g.a += (g.v * 12) / g.r * dt;
      const x = g.cx + Math.cos(g.a) * g.r, z = g.cz + Math.sin(g.a) * g.r, y = g.h + 1.5 * Math.sin(this.t * 0.3 + g.ph);
      // heading along the circle, banking into the turn
      const yaw = Math.atan2(Math.sin(g.a) * Math.sign(g.v), Math.cos(g.a) * Math.sign(g.v)) * -1 + (g.v > 0 ? 0 : Math.PI);
      // mostly gliding; a few beats now and then
      g.flapT -= dt; if (g.flapT < -4 - (g.ph % 3)) g.flapT = 1.2;
      const flap = g.flapT > 0 ? 0.55 * Math.sin(this.t * 14 + g.ph) : 0.08 * Math.sin(this.t * 1.5 + g.ph);
      this.e.set(0, yaw, -0.35 * Math.sign(g.v)); this.q.setFromEuler(this.e);
      this.base.compose(this.p.set(x, y, z), this.q, this.s.setScalar(g.k));
      this.body.setMatrixAt(n, this.base);
      this.hinge.makeRotationZ(-flap); this.m.multiplyMatrices(this.base, this.hinge); this.wingL.setMatrixAt(n, this.m);
      this.m.copy(this.base).multiply(this.hinge.makeRotationZ(-flap)).multiply(this.off.makeTranslation(-0.42, 0, 0)).multiply(this.bend.makeRotationZ(-flap * 0.8));
      this.tips[0].setMatrixAt(n, this.m);
      this.m.copy(this.base).multiply(this.hinge.makeRotationZ(flap)); this.wingR.setMatrixAt(n, this.m);
      this.m.copy(this.base).multiply(this.hinge.makeRotationZ(flap)).multiply(this.off.makeTranslation(0.42, 0, 0)).multiply(this.bend.makeRotationZ(flap * 0.8));
      this.tips[1].setMatrixAt(n, this.m);
      n++;
    }
    for (const im of [this.body, this.wingL, this.wingR, ...this.tips]) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    this.group.visible = n > 0;
  }
}
