// The narrator is a mosquito. It hovers around you in the campaign rooms (and the Locations room), drifts into view and faces
// you when it talks, and its voice comes from where it is (narrator.ts plays the line through a 3D panner at mosquito.pos).
// Every client has its own mosquito by its own player: narration is local, so the mosquito is too.
import * as THREE from 'three';
import { Mesher } from '../net/playerModel';

const S = 1.0;   // a storybook mosquito, about 12 cm long: big enough to see, small enough to be a mosquito

export class Mosquito {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private body = new THREE.Group();
  private wings: THREE.Mesh[] = [];
  private vel = new THREE.Vector3();
  private t = Math.random() * 100;
  private fresh = true;
  private target = new THREE.Vector3();
  private look = new THREE.Vector3();
  /** keeps the mosquito out of the walls (world in / world out), set by whoever owns the room */
  clamp: ((p: THREE.Vector3) => void) | null = null;
  private buzz: { osc: OscillatorNode; g: GainNode; pan: PannerNode } | null = null;

  constructor(scene: THREE.Scene) {
    const M = new Mesher();
    const grey = '#5a5048', dark = '#2e2824', stripe = '#cfc4b0';
    M.sph(0.018 * S, grey, 0, 0, 0, 1, 0.9, 1.2, 10);                                                  // thorax
    for (let i = 0; i < 4; i++) M.sph(0.013 * S * (1 - i * 0.12), i % 2 ? stripe : grey, 0, -0.004 * S - i * 0.002, 0.022 * S + i * 0.016 * S, 1, 0.85, 1.25, 8);   // abdomen, banded
    M.sph(0.011 * S, dark, 0, 0.004 * S, -0.024 * S, 1, 1, 1, 8);                                     // head
    M.sph(0.0055 * S, '#b8202a', -0.006 * S, 0.008 * S, -0.031 * S, 1, 1, 1, 6); M.sph(0.0055 * S, '#b8202a', 0.006 * S, 0.008 * S, -0.031 * S, 1, 1, 1, 6);   // big red eyes
    M.cyl(0.0012 * S, 0.0008 * S, 0.034 * S, dark, 0, -0.004 * S, -0.048 * S, 1, 1, 5, Math.PI / 2 + 0.25);                   // proboscis
    for (const s of [-1, 1]) M.cyl(0.0008 * S, 0.0008 * S, 0.02 * S, dark, s * 0.006 * S, 0.016 * S, -0.03 * S, 1, 1, 4, 0.3, 0, s * 0.5);   // feelers
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {                                            // six long legs, bent down
      const z = -0.008 * S + i * 0.01 * S;
      M.cyl(0.0009 * S, 0.0009 * S, 0.03 * S, dark, s * 0.016 * S, -0.008 * S, z, 1, 1, 4, 0, 0, s * 1.0);
      M.cyl(0.0008 * S, 0.0008 * S, 0.036 * S, dark, s * 0.03 * S, -0.03 * S, z + (i - 1) * 0.006 * S, 1, 1, 4, (i - 1) * 0.3, 0, s * 0.2);
    }
    M.box(0.012 * S, 0.006 * S, 0.004 * S, '#c8343a', 0, -0.01 * S, -0.02 * S); M.sph(0.003 * S, '#8a1a20', 0, -0.01 * S, -0.0185 * S);   // the bow tie
    const m = M.build(false); m.frustumCulled = false; this.body.add(m);
    const wmat = new THREE.MeshBasicMaterial({ color: '#dfe9f2', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    for (const s of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.05 * S, 0.016 * S); g.translate(s * 0.025 * S, 0, 0);
      const w = new THREE.Mesh(g, wmat); w.rotation.x = -Math.PI / 2; w.position.set(s * 0.005 * S, 0.012 * S, -0.002 * S); w.frustumCulled = false;
      this.body.add(w); this.wings.push(w);
    }
    this.group.add(this.body);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** eye: the player's eyes; yaw: where they face; talking: come into view and face them */
  update(dt: number, eye: THREE.Vector3, yaw: number, talking: boolean, small: boolean, ctx: AudioContext | null, muted: boolean) {
    if (!this.group.visible) { this.fresh = true; this.setBuzz(ctx, 0); return; }
    this.t += dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const k = small ? 0.45 : 1;                                      // a cat's mosquito stays closer and lower
    if (talking) {
      // in front of you, a little to the right and up, bobbing
      const f = 0.75 * k, r = 0.28 * k + Math.sin(this.t * 0.9) * 0.08 * k, u = 0.06 * k + Math.sin(this.t * 2.1) * 0.03;
      this.target.set(eye.x + fx * f + rx * r, eye.y + u, eye.z + fz * f + rz * r);
    } else {
      // wander around your head (a lazy figure of eight, sometimes darting)
      const a = this.t * 0.45, R = (1.25 + 0.4 * Math.sin(this.t * 0.31)) * k;
      this.target.set(eye.x + Math.cos(a) * R, eye.y + 0.15 * k + Math.sin(this.t * 0.83) * 0.35 * k, eye.z + Math.sin(a * 2) * R * 0.6);
    }
    if (this.fresh) { this.pos.copy(this.target); this.vel.set(0, 0, 0); this.fresh = false; }
    // a springy chase with a bit of jitter: mosquitoes never fly straight
    const ax = (this.target.x - this.pos.x) * 9 - this.vel.x * 4.5 + (Math.random() - 0.5) * 3;
    const ay = (this.target.y - this.pos.y) * 9 - this.vel.y * 4.5 + (Math.random() - 0.5) * 3;
    const az = (this.target.z - this.pos.z) * 9 - this.vel.z * 4.5 + (Math.random() - 0.5) * 3;
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.distanceTo(eye) > 4) this.pos.lerp(this.target, 0.5);
    this.clamp?.(this.pos);
    this.group.position.copy(this.pos);
    // face you while talking, otherwise where it is flying
    if (talking) this.look.set(eye.x, this.pos.y, eye.z); else this.look.copy(this.pos).addScaledVector(this.vel, 1);
    this.look.y = this.pos.y;
    if (this.look.distanceToSquared(this.pos) > 1e-6) {
      const want = Math.atan2(-(this.look.x - this.pos.x), -(this.look.z - this.pos.z));
      let d = want - this.body.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.body.rotation.y += d * Math.min(1, dt * 6);
    }
    this.body.rotation.x = Math.max(-0.4, Math.min(0.4, this.vel.y * 0.3));
    this.body.rotation.z = Math.sin(this.t * 3.1) * 0.12;
    const flap = Math.sin(this.t * 95) * 0.7;
    this.wings[0].rotation.z = flap; this.wings[1].rotation.z = -flap;
    // a faint whine when it is close and quiet
    const d = this.pos.distanceTo(eye);
    this.setBuzz(ctx, muted || talking ? 0 : Math.max(0, 0.02 * (1 - d / 2.5)));
  }
  private setBuzz(ctx: AudioContext | null, v: number) {
    if (!ctx) return;
    if (!this.buzz && v > 0) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 610;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 7; lg.gain.value = 25; lfo.connect(lg); lg.connect(osc.frequency); lfo.start();
      const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 2;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 0.5; pan.rolloffFactor = 1;
      osc.connect(lp); lp.connect(g); g.connect(pan); pan.connect(ctx.destination); osc.start();
      this.buzz = { osc, g, pan };
    }
    if (!this.buzz) return;
    this.buzz.g.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
    setPannerPos(this.buzz.pan, ctx, this.pos);
  }
}

export function setPannerPos(p: PannerNode, ctx: AudioContext, v: THREE.Vector3) {
  if (p.positionX) { const t = ctx.currentTime; p.positionX.setTargetAtTime(v.x, t, 0.03); p.positionY.setTargetAtTime(v.y, t, 0.03); p.positionZ.setTargetAtTime(v.z, t, 0.03); }
  else (p as any).setPosition(v.x, v.y, v.z);
}
/** put the WebAudio listener at the camera (so the mosquito's voice comes from the right side) */
export function setListener(ctx: AudioContext, cam: THREE.Camera) {
  const l = ctx.listener, p = _p, f = _f, u = _u;
  cam.getWorldPosition(p); cam.getWorldDirection(f); u.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_q));
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
    l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
    l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
  } else { (l as any).setPosition(p.x, p.y, p.z); (l as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
}
const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
