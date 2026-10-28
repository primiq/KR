import {
    CharacterSupportedState,
    type CharacterSurfaceInfo,
    PhysicsCharacterController,
    type PhysicsEngineV2,
    PhysicsRaycastResult,
    Quaternion,
    type Scene,
    UniversalCamera,
    Vector2,
    Vector3,
    type WebXRCamera,
} from "@babylonjs/core";
import { Layer, Player as P } from "./config";

/** Per-frame intent, filled by keyboard/mouse or by XR controllers. */
export interface PlayerInput {
    /** x = strafe right, y = forward. Length <= 1. */
    move: Vector2;
    sprint: boolean;
    /** Edge-triggered: consumed on the next update. */
    jump: boolean;
    /** Held crouch (desktop key or VR "virtual crouch" button). */
    crouch: boolean;
    /** Edge-triggered snap turn: -1 left, +1 right. */
    snapTurn: number;
}

const UP = new Vector3(0, 1, 0);
const GRAVITY = new Vector3(0, P.gravity, 0);

/**
 * First-person character built on Havok's PhysicsCharacterController.
 * Supports jumping, crouching (capsule resize with head-room check), riding moving
 * platforms, pushing dynamic bodies, and room-scale XR where the capsule follows the headset.
 */
export class PlayerController {
    readonly desktopCamera: UniversalCamera;
    readonly input: PlayerInput = { move: new Vector2(), sprint: false, jump: false, crouch: false, snapTurn: 0 };
    xrCamera: WebXRCamera | null = null;
    onGround = false;
    /** Water surface sampler for the current location (null when there's no swimmable water). */
    water: { surfaceAt(x: number, z: number): number } | null = null;
    /** How far the feet are below the water surface (negative when out of the water). */
    waterDepth = Number.NEGATIVE_INFINITY;
    swimming = false;

    private readonly cc: PhysicsCharacterController;
    private capsuleHeight: number = P.standHeight;
    private viewHeight: number = P.standHeight;
    private coyote = 0;
    private velocity = new Vector3();
    private readonly spawn: Vector3;
    private readonly tmp = new Vector3();
    private readonly forward = new Vector3();
    private readonly right = new Vector3();
    private readonly desired = new Vector3();
    private readonly ray = new PhysicsRaycastResult();
    private support: CharacterSurfaceInfo | null = null;

    constructor(
        private readonly scene: Scene,
        floorY: number,
        spawn: Vector3,
        lookAt: Vector3,
    ) {
        this.spawn = new Vector3(spawn.x, floorY + P.standHeight / 2 + 0.05, spawn.z);
        this.cc = new PhysicsCharacterController(this.spawn.clone(), { capsuleHeight: P.standHeight, capsuleRadius: P.radius }, scene);
        this.cc.maxStepHeight = 0.22;
        this.cc.characterStrength = 900;
        this.cc.characterMass = 75;
        this.cc.acceleration = 1.2;
        this.cc.maxAcceleration = 60;
        this.applyFilter();

        const cam = new UniversalCamera("desktopCam", this.eyePosition(), scene);
        cam.minZ = 0.03;
        cam.maxZ = 2000;
        cam.fov = 1.15;
        cam.inertia = 0.35;
        cam.angularSensibility = 900;
        cam.inputs.removeByType("FreeCameraKeyboardMoveInput");
        cam.inputs.removeByType("FreeCameraTouchInput");
        cam.setTarget(new Vector3(lookAt.x, this.eyePosition().y, lookAt.z));
        this.desktopCamera = cam;

        scene.onAfterPhysicsObservable.add(() => this.update(scene.deltaTime / 1000));
    }

    get position(): Vector3 {
        return this.cc.getPosition();
    }

    /** Current velocity of the character (m/s). */
    get linearVelocity(): Vector3 {
        return this.velocity;
    }

    get footY(): number {
        return this.cc.getPosition().y - this.capsuleHeight / 2;
    }

    get isCrouched(): boolean {
        return this.capsuleHeight < P.standHeight - 0.2;
    }

    respawn(): void {
        this.cc.setPosition(this.spawn.clone());
        this.cc.setVelocity(Vector3.Zero());
        this.velocity.setAll(0);
    }

    /** Called when an XR session starts so the headset begins where the desktop camera was. */
    attachXR(camera: WebXRCamera | null): void {
        this.xrCamera = camera;
    }

    // ---------------------------------------------------------------------------

    private applyFilter(): void {
        const shape = this.cc.shape;
        shape.filterMembershipMask = Layer.PLAYER;
        shape.filterCollideMask = Layer.STATIC | Layer.DYNAMIC;
    }

    private eyePosition(): Vector3 {
        const p = this.cc.getPosition();
        return new Vector3(p.x, p.y - this.capsuleHeight / 2 + this.viewHeight - P.eyeFromTop, p.z);
    }

    private update(dt: number): void {
        if (!(dt > 0)) dt = 1 / 60;
        dt = Math.min(dt, 0.1); // matches the physics engine clamp
        const xr = this.xrCamera;

        // Room-scale: move the capsule (with collisions) to where the headset physically went.
        if (xr) this.followHead(xr);

        this.updateCrouch(dt, xr);
        this.locomotion(dt, xr);

        if (this.cc.getPosition().y < -30) this.respawn();

        if (xr) {
            this.syncXRCamera(xr);
        } else {
            this.desktopCamera.position.copyFrom(this.eyePosition());
        }
        this.input.jump = false;
        this.input.snapTurn = 0;
    }

    private followHead(xr: WebXRCamera): void {
        const p = this.cc.getPosition();
        const dx = xr.position.x - p.x;
        const dz = xr.position.z - p.z;
        if (dx * dx + dz * dz < 1e-6) return;
        // moveWithCollisions overwrites the controller velocity, so preserve locomotion velocity around it.
        const keep = this.cc.getVelocity().clone();
        this.cc.moveWithCollisions(new Vector3(dx, 0, dz));
        this.cc.setVelocity(keep);
    }

    private updateCrouch(dt: number, xr: WebXRCamera | null): void {
        let target: number;
        if (xr) {
            // Physical crouching shrinks the capsule; the crouch button adds a virtual offset for seated play.
            const head = xr.realWorldHeight || P.standHeight - P.eyeFromTop;
            const virtual = this.input.crouch ? P.vrVirtualCrouch : 0;
            target = clamp(head - virtual + P.eyeFromTop, P.crouchHeight * 0.75, P.standHeight);
        } else {
            target = this.input.crouch ? P.crouchHeight : P.standHeight;
        }

        // Don't stand up into a ceiling.
        if (target > this.capsuleHeight + 0.01) {
            const p = this.cc.getPosition();
            const top = p.y + this.capsuleHeight / 2;
            const from = new Vector3(p.x, top - 0.05, p.z);
            const to = new Vector3(p.x, top + (target - this.capsuleHeight) + 0.05, p.z);
            (this.scene.getPhysicsEngine() as PhysicsEngineV2).raycastToRef(from, to, this.ray, { collideWith: Layer.STATIC | Layer.DYNAMIC });
            if (this.ray.hasHit) target = Math.max(this.capsuleHeight, this.ray.hitPointWorld.y - (p.y - this.capsuleHeight / 2) - 0.06);
        }

        // Desktop view height eases; XR follows the real head instantly.
        this.viewHeight = xr ? target : this.viewHeight + (target - this.viewHeight) * Math.min(1, dt * 12);
        const h = xr ? target : this.viewHeight;
        if (Math.abs(h - this.capsuleHeight) > 0.03) {
            this.capsuleHeight = h;
            this.cc.setShapeOptions({ capsuleHeight: h, capsuleRadius: P.radius }, true);
            this.applyFilter();
        }
    }

    private locomotion(dt: number, xr: WebXRCamera | null): void {
        const cam = xr ?? this.desktopCamera;
        cam.getDirectionToRef(Vector3.Forward(), this.forward);
        this.forward.y = 0;
        if (this.forward.lengthSquared() < 1e-4) this.forward.set(0, 0, 1);
        this.forward.normalize();
        Vector3.CrossToRef(UP, this.forward, this.right);

        const speed = this.isCrouched ? P.crouchSpeed : this.input.sprint ? P.sprintSpeed : P.walkSpeed;
        const m = this.input.move;
        this.desired.copyFrom(this.forward).scaleInPlace(m.y * speed);
        this.right.scaleToRef(m.x * speed, this.tmp);
        this.desired.addInPlace(this.tmp);

        this.support = this.cc.checkSupport(dt, new Vector3(0, -1, 0));
        const supported = this.support.supportedState === CharacterSupportedState.SUPPORTED;

        // Water: wading drags you down; deep enough and you float and swim.
        const pos = this.cc.getPosition();
        const foot = pos.y - this.capsuleHeight / 2;
        const surface = this.water ? this.water.surfaceAt(pos.x, pos.z) : Number.NEGATIVE_INFINITY;
        this.waterDepth = surface - foot;
        if (this.waterDepth > 0.2) this.desired.scaleInPlace(clamp(1 - (this.waterDepth - 0.2) * 0.45, 0.4, 1));
        this.swimming = this.waterDepth > P.swimDepth && !(supported && this.waterDepth < P.swimDepth + 0.15);
        if (this.swimming) {
            this.swim(dt, surface, foot);
            return;
        }
        this.coyote = supported ? 0.12 : Math.max(0, this.coyote - dt);
        const current = this.cc.getVelocity();

        if (supported && this.velocity.y <= 0.5) {
            const n = this.support.averageSurfaceNormal;
            const sv = this.support.averageSurfaceVelocity;
            const out = this.cc.calculateMovement(dt, this.forward, n, current, sv, this.desired, UP);
            // Keep the motion tangent to the surface (sample-style slope handling).
            out.subtractInPlace(sv);
            if (out.dot(UP) > 1e-3) {
                const len = out.length();
                out.normalizeFromLength(len);
                const horiz = len / Math.max(0.1, n.dot(UP));
                const c = n.cross(out);
                out.copyFrom(c.cross(UP)).scaleInPlace(horiz);
            }
            out.addInPlace(sv);
            this.velocity.copyFrom(out);
        } else {
            // Airborne: limited control, gravity.
            this.velocity.copyFrom(current);
            const k = Math.min(1, P.airControl * dt * 8);
            this.velocity.x += (this.desired.x - this.velocity.x) * k;
            this.velocity.z += (this.desired.z - this.velocity.z) * k;
            this.velocity.addInPlace(GRAVITY.scale(dt));
        }

        if (this.input.jump && this.coyote > 0 && !this.isCrouched) {
            this.velocity.y = Math.max(this.velocity.y, 0) + P.jumpSpeed;
            this.coyote = 0;
        }
        this.onGround = supported;

        this.cc.setVelocity(this.velocity);
        this.cc.integrate(dt, this.support, GRAVITY);
    }

    /** Buoyant swimming: float with the eyes just above the surface; Jump is a strong upward stroke. */
    private swim(dt: number, surface: number, foot: number): void {
        const v = this.cc.getVelocity().clone();
        const k = Math.min(1, dt * 3);
        v.x += (this.desired.x * P.swimSpeedFactor - v.x) * k;
        v.z += (this.desired.z * P.swimSpeedFactor - v.z) * k;
        const targetFoot = surface - P.swimDepth - 0.05;
        // Critically damped float towards the target depth.
        v.y += ((targetFoot - foot) * 36 - v.y * 12) * dt;
        if (this.input.jump) v.y = Math.max(v.y, 3.2);
        this.velocity.copyFrom(v);
        this.onGround = false;
        this.coyote = 0;
        this.cc.setVelocity(v);
        this.cc.integrate(dt, this.support!, Vector3.ZeroReadOnly);
    }

    private syncXRCamera(xr: WebXRCamera): void {
        if (this.input.snapTurn !== 0) {
            const turn = Quaternion.RotationAxis(UP, (this.input.snapTurn * P.snapTurnDegrees * Math.PI) / 180);
            xr.rotationQuaternion = turn.multiply(xr.rotationQuaternion);
        }
        const p = this.cc.getPosition();
        const head = xr.realWorldHeight || P.standHeight - P.eyeFromTop;
        const virtual = this.input.crouch ? P.vrVirtualCrouch : 0;
        const y = this.footY + head - virtual;
        const pos = xr.position;
        if (Math.abs(pos.x - p.x) > 1e-4 || Math.abs(pos.z - p.z) > 1e-4 || Math.abs(pos.y - y) > 1e-4) {
            xr.position.set(p.x, y, p.z);
        }
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
