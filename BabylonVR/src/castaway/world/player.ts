import { Vector3 } from "@babylonjs/core";
import { clamp, smoothstep } from "../core/noise";
import type { Input } from "../core/input";
import { heightAt, WORLD_RADIUS } from "./island";
import type { ColliderGrid } from "./vegetation";

export type Mode = "walk" | "swim" | "fly";

/** steepest walkable rise over run (about 55 degrees) */
const SLOPE_BLOCK = 1.45;

export interface Body { eye: number; radius: number; walk: number; run: number; jump: number; step: number; height: number }
export const HUMAN: Body = { eye: 1.68, radius: 0.38, walk: 4.1, run: 7.0, jump: 5.6, step: 0.8, height: 1.75 };

/** Buildings: floors to stand on and walls to bump into. */
export interface WorldShape {
    ground(x: number, z: number, y?: number): number;
    resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }): void;
}

/**
 * Castaway's first-person controller, ported unchanged in feel: walking with slope limits and step-ups, wading,
 * floating and diving, and a debug fly mode. The terrain is analytic and trees / rocks / walls are circles and boxes,
 * so no physics engine is involved: it costs next to nothing, which matters most in a headset.
 *
 * World axes follow Castaway (right-handed, y up): yaw 0 faces -z, forward = (-sin yaw, 0, -cos yaw).
 */
export class Player {
    readonly pos = new Vector3(); // feet
    readonly vel = new Vector3();
    yaw = 0;
    pitch = 0;
    mode: Mode = "walk";
    onGround = false;
    canSprint = true;
    canJump = true;
    body: Body = HUMAN;
    sprinting = false;
    moving = false;
    jumped = false;
    diving = false;
    onLand: ((speed: number) => void) | null = null;
    readonly eye = new Vector3();
    waterDepth = 0;
    underwater = false;
    /** where the eyes point (set by the camera / headset each frame before update) */
    readonly look = new Vector3(0, 0, -1);
    /** VR: the headset moves the eyes itself, so no bob, shake or step easing */
    vr = false;
    world: WorldShape | null = null;
    /** something else carries the body (the warp level, a cannon seat, a boat): while it returns true the player stays put */
    ride: ((dt: number) => boolean) | null = null;
    /** something moves the body itself this frame (the skydive): like `ride`, but set and cleared by its owner */
    seated = false;
    /** underground: the cave replaces the island's ground, walls and water */
    cave: { floor(x: number, z: number, y: number): number; resolve(x: number, z: number, r: number, feetY: number, out: { x: number; z: number }): void } | null = null;
    /** sea surface height (waves) at a point */
    surfaceAt: (x: number, z: number) => number = () => 0;
    /** camera shake output (radians / metres), read by the camera rig */
    readonly shakeRot = new Vector3();
    shakeY = 0;

    private jumpBuf = 0;
    private swimAir = 0;
    private groundGrace = 0;
    private tmp = { x: 0, z: 0 };
    private stepOffset = 0;
    lastY = 0;
    private bob = 0;
    private shakeAmp = 0;
    private shakeT = 0;
    private bobAmt = 0;
    private time = 0;

    constructor(
        x: number,
        z: number,
        yaw: number,
        private colliders: ColliderGrid,
    ) {
        this.pos.set(x, heightAt(x, z), z);
        this.yaw = yaw;
        this.pitch = -0.05;
    }

    /** Ocean ripples / splashes read the body through these (see island/ocean.ts). */
    get position() { return this.pos; }
    get linearVelocity() { return this.vel; }
    water: { surfaceAt(x: number, z: number): number } | null = null;

    private gnd(x: number, z: number) { return this.cave ? this.cave.floor(x, z, this.pos.y) : this.world ? this.world.ground(x, z, this.pos.y) : heightAt(x, z); }

    respawn(x: number, z: number, yaw: number) {
        this.pos.set(x, this.gnd(x, z), z);
        this.lastY = this.pos.y;
        this.stepOffset = 0;
        this.vel.set(0, 0, 0);
        this.yaw = yaw;
        this.pitch = -0.05;
        this.mode = "walk";
        this.onGround = true;
    }

    teleport(x: number, y: number, z: number, yaw: number) {
        this.pos.set(x, y, z);
        this.lastY = y;
        this.stepOffset = 0;
        this.vel.set(0, 0, 0);
        this.yaw = yaw;
        this.mode = "walk";
        this.onGround = true;
    }

    /** Camera shake (0..1+). Decays by itself. */
    shake(amount: number) { this.shakeAmp = Math.min(2.5, Math.max(this.shakeAmp, amount)); }

    update(dt: number, input: Input) {
        this.time += dt;
        const time = this.time;
        // ---- look (in VR the headset turns the view; snap / smooth turning is applied to yaw by the VR rig)
        const { dx, dy } = input.consumeLook();
        const sens = input.touch ? 0.0042 : 0.0022;
        this.yaw -= dx * sens;
        if (!this.vr) this.pitch = clamp(this.pitch - dy * sens, -1.52, 1.52);

        if (input.flyToggle) {
            input.flyToggle = false;
            this.mode = this.mode === "fly" ? "walk" : "fly";
            this.vel.set(0, 0, 0);
        }

        if (this.ride || this.seated) {
            if (this.seated || this.ride!(dt)) {
                this.mode = "walk"; this.onGround = true; this.moving = false; this.sprinting = false; this.jumped = false;
                this.vel.set(0, 0, 0);
                this.eye.set(this.pos.x, this.pos.y + this.body.eye, this.pos.z);
                const sf = this.surfaceAt(this.eye.x, this.eye.z);
                this.waterDepth = Math.max(0, sf - heightAt(this.pos.x, this.pos.z));
                this.underwater = this.eye.y < sf - 0.03 && this.waterDepth > 0;
                this.lastY = this.pos.y; this.stepOffset = 0; input.jumpQueued = false;
                return;
            }
            this.ride = null; this.onGround = false; this.lastY = this.pos.y;
        }
        const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
        const mx = input.move.x, my = input.move.y;
        const wishX = -sinY * my + cosY * mx;
        const wishZ = -cosY * my + -sinY * mx;
        this.moving = mx !== 0 || my !== 0;
        const sprintNow = input.wantsSprint && this.canSprint && this.moving;
        this.sprinting = sprintNow;
        this.jumped = false;
        this.jumpBuf = input.jumpQueued ? 0.18 : Math.max(0, this.jumpBuf - dt);
        this.groundGrace = this.onGround ? 0.12 : Math.max(0, this.groundGrace - dt);

        const ground = this.gnd(this.pos.x, this.pos.z);
        this.waterDepth = this.cave ? 0 : -ground;
        const surface = this.surfaceAt(this.pos.x, this.pos.z);
        const look = this.look;

        if (this.mode === "fly") {
            const sp = input.wantsSprint ? 40 : 14;
            this.pos.x += (look.x * my + cosY * mx) * sp * dt;
            this.pos.y += look.y * my * sp * dt + (input.jumpHeld ? sp * 0.5 * dt : 0);
            this.pos.z += (look.z * my - sinY * mx) * sp * dt;
        } else {
            const swimDepth = 1.25;
            const inDeep = this.waterDepth > swimDepth;
            if (inDeep && this.mode === "walk" && this.pos.y < surface - 0.15) this.mode = "swim";
            else if (!inDeep && this.mode === "swim" && this.waterDepth < swimDepth - 0.25) { this.mode = "walk"; this.diving = false; }
            if (this.mode !== "swim") this.diving = false;

            const target0 = surface - this.body.eye + 0.18;
            if (this.mode === "swim" && !this.diving && this.swimAir <= 0 && this.waterDepth > 1.7 && ((my > 0.3 && look.y < -0.45) || input.wantsDive)) {
                this.diving = true;
                this.vel.y = Math.min(this.vel.y, -1.2);
            }
            if (this.mode === "swim" && this.diving) {
                // under water you swim where you look; jump rises, dive sinks; you drift up a little on your own
                const sp = sprintNow ? 4.8 : this.canSprint ? 3.4 : 2.2;
                let wx = look.x * my + cosY * mx, wy = look.y * my, wz = look.z * my - sinY * mx;
                if (input.jumpHeld) wy += 0.9;
                if (input.wantsDive) wy -= 0.9;
                const wl = Math.hypot(wx, wy, wz);
                if (wl > 1) { wx /= wl; wy /= wl; wz /= wl; }
                const k = Math.min(1, 4 * dt);
                this.vel.x += (wx * sp - this.vel.x) * k;
                this.vel.z += (wz * sp - this.vel.z) * k;
                this.vel.y += (wy * sp + 0.25 - this.vel.y) * k;
                if (this.pos.y >= target0 && this.vel.y > -0.2 && !input.wantsDive && !(my > 0.3 && look.y < -0.45)) {
                    this.diving = false;
                    this.pos.y = Math.min(this.pos.y, target0 + 0.05);
                }
                this.onGround = false;
                input.jumpQueued = false;
            } else if (this.mode === "swim") {
                const sp = sprintNow ? 6.0 : this.canSprint ? 4.0 : 2.6;
                const accel = 6;
                this.vel.x += (wishX * sp - this.vel.x) * Math.min(1, accel * dt);
                this.vel.z += (wishZ * sp - this.vel.z) * Math.min(1, accel * dt);
                const target = surface - this.body.eye + 0.18 + Math.sin(time * 1.6) * 0.03;
                if (this.jumpBuf > 0 && this.canJump && this.pos.y < target + 0.25) { this.vel.y = 6.2; this.swimAir = 0.25; this.jumped = true; this.jumpBuf = 0; }
                if (this.swimAir > 0) {
                    this.swimAir -= dt;
                    this.vel.y -= 16 * dt;
                    if (this.swimAir <= 0 && this.pos.y > target + 0.05) this.swimAir = 0.001;
                } else {
                    if (input.jumpHeld) this.vel.y += 12 * dt;
                    this.vel.y += (target - this.pos.y) * 6 * dt - this.vel.y * 3.5 * dt;
                }
                if (this.swimAir > 0 && this.vel.y < 0 && this.pos.y <= target) this.swimAir = 0;
                this.onGround = false;
            } else {
                const wading = smoothstep(0.1, 1.2, this.waterDepth);
                const base = sprintNow ? this.body.run : this.body.walk;
                const sp = base * (1 - 0.3 * wading);
                const accel = this.onGround ? 14 : 4;
                this.vel.x += (wishX * sp - this.vel.x) * Math.min(1, accel * dt);
                this.vel.z += (wishZ * sp - this.vel.z) * Math.min(1, accel * dt);
                this.vel.y -= 16 * dt;
                if (this.jumpBuf > 0 && (this.onGround || this.groundGrace > 0) && this.vel.y < 1 && this.canJump) {
                    this.vel.y = this.body.jump * (1 - 0.3 * wading);
                    this.onGround = false;
                    this.jumped = true;
                    this.jumpBuf = 0;
                    this.groundGrace = 0;
                }
            }
            input.jumpQueued = false;

            // ---- horizontal move with slope + obstacle handling
            let nx = this.pos.x + this.vel.x * dt;
            let nz = this.pos.z + this.vel.z * dt;
            if (this.mode === "walk") {
                // cliffs and gullies cannot be walked up; steep hillsides are slow going
                const px0 = this.pos.x, pz0 = this.pos.z, mv = Math.hypot(nx - px0, nz - pz0);
                if (mv > 1e-5) {
                    const h0 = heightAt(px0, pz0);
                    const rise = (tx: number, tz: number) => {
                        const l = Math.hypot(tx - px0, tz - pz0);
                        if (l < 1e-6) return 0;
                        const k = 0.5 / l;
                        return (heightAt(px0 + (tx - px0) * k, pz0 + (tz - pz0) * k) - h0) / 0.5;
                    };
                    const up = rise(nx, nz);
                    if (up > SLOPE_BLOCK) {
                        if (rise(nx, pz0) <= SLOPE_BLOCK) { nz = pz0; this.vel.z = 0; }
                        else if (rise(px0, nz) <= SLOPE_BLOCK) { nx = px0; this.vel.x = 0; }
                        else { nx = px0; nz = pz0; this.vel.x = this.vel.z = 0; }
                    } else if (up > 0.5) {
                        const f = 1 - 0.55 * smoothstep(0.5, SLOPE_BLOCK, up);
                        nx = px0 + (nx - px0) * f;
                        nz = pz0 + (nz - pz0) * f;
                    }
                }
                const gNew = this.gnd(nx, nz);
                const climb = gNew - this.pos.y;
                if (this.onGround && climb > this.body.step + 1.2 * Math.hypot(this.vel.x, this.vel.z) * dt) {
                    const gx = this.gnd(nx, this.pos.z) - this.pos.y, gz = this.gnd(this.pos.x, nz) - this.pos.y;
                    if (gx > 0.6) { nx = this.pos.x; this.vel.x = 0; }
                    if (gz > 0.6) { nz = this.pos.z; this.vel.z = 0; }
                }
            }
            if (this.cave) this.cave.resolve(nx, nz, this.body.radius, this.pos.y, this.tmp);
            else this.colliders.resolve(nx, nz, this.body.radius, this.tmp);
            nx = this.tmp.x;
            nz = this.tmp.z;
            if (this.world && !this.cave) {
                this.world.resolve(nx, nz, this.body.radius, this.pos.y, this.tmp);
                nx = this.tmp.x;
                nz = this.tmp.z;
            }
            // soft world boundary (somebody who swam further out may come back in, never further out)
            const r = Math.hypot(nx, nz), lim = Math.max(WORLD_RADIUS, Math.hypot(this.pos.x, this.pos.z));
            if (!this.cave && r > lim) { nx *= lim / r; nz *= lim / r; }
            this.pos.x = nx;
            this.pos.z = nz;
            this.pos.y += this.vel.y * dt;

            const g = this.gnd(this.pos.x, this.pos.z);
            if (this.mode === "swim") {
                if (this.pos.y < g) { this.pos.y = g; this.vel.y = Math.max(0, this.vel.y); }
            } else if (this.pos.y <= g) {
                if (!this.onGround && this.vel.y < -14) this.onLand?.(-this.vel.y);
                this.pos.y = g;
                this.vel.y = Math.max(0, this.vel.y);
                this.onGround = true;
            } else if (this.pos.y - g > 0.08) this.onGround = false;
            else { this.pos.y = g; this.onGround = true; }
        }

        // ---- head bob, step easing and shake (flat screens only: in a headset these make people ill)
        const speed = Math.hypot(this.vel.x, this.vel.z);
        this.bobAmt += ((this.onGround && this.mode === "walk" && !this.vr ? Math.min(1, speed / 5) : 0) - this.bobAmt) * Math.min(1, 8 * dt);
        this.bob += speed * dt * 2.2;
        const bobY = Math.sin(this.bob * 2) * 0.035 * this.bobAmt;
        if (!this.vr && this.onGround && this.mode === "walk" && this.pos.y - this.lastY > 0.15 && this.pos.y - this.lastY < 1.2) this.stepOffset -= this.pos.y - this.lastY;
        this.lastY = this.pos.y;
        this.stepOffset *= Math.exp(-11 * dt);
        this.eye.set(this.pos.x, this.pos.y + this.body.eye + bobY + this.stepOffset, this.pos.z);
        this.shakeT += dt;
        if (this.shakeAmp > 0.002 && !this.vr) {
            const a = this.shakeAmp;
            this.shakeRot.set(Math.sin(this.shakeT * 53) * 0.012 * a, Math.sin(this.shakeT * 41 + 1.3) * 0.009 * a, Math.sin(this.shakeT * 37) * 0.018 * a);
            this.shakeY = Math.sin(this.shakeT * 61) * 0.02 * a;
            this.shakeAmp *= Math.exp(-7 * dt);
        } else {
            this.shakeRot.set(0, 0, 0);
            this.shakeY = 0;
            this.shakeAmp = 0;
        }
        this.underwater = !this.cave && this.eye.y < this.surfaceAt(this.eye.x, this.eye.z) - 0.03 && this.waterDepth > 0;
    }
}
