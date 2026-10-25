import {
    Matrix,
    type Mesh,
    MeshBuilder,
    PhysicsBody,
    PhysicsMotionType,
    PhysicsShapeSphere,
    Quaternion,
    type Scene,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import { ALL_LAYERS, Interaction as I, Layer } from "./config";
import type { Grabbable, Props } from "./props";

const MAX_FOLLOW_SPEED = 25; // m/s – keeps held objects from tunnelling through the world.

/**
 * Anything that can hold an object: a mouse/camera, a controller grip or a tracked hand.
 * Owners update `position`/`rotation` every frame, then call `grab`/`release`.
 */
export class Manipulator {
    readonly position = new Vector3();
    readonly rotation = new Quaternion();
    held: Grabbable | null = null;

    private readonly offsetPos = new Vector3();
    private readonly offsetRot = new Quaternion();
    /** For remote grabs the object flies into the hand: offset shrinks to `pullTarget`. */
    private pulling = false;
    private readonly history: Array<{ t: number; p: Vector3; q: Quaternion }> = [];
    private readonly target = new Vector3();
    private readonly targetRot = new Quaternion();
    /** Simulation clock (seconds) so throw velocities match the physics step, not wall time. */
    private clock = 0;

    constructor(
        readonly name: string,
        private readonly system: InteractionSystem,
    ) {}

    grab(g: Grabbable, remote = false): void {
        if (this.held) this.release();
        this.system.claim(g, this);
        const body = g.aggregate.body;
        body.setMotionType(PhysicsMotionType.ANIMATED);
        body.disablePreStep = true;
        g.aggregate.shape.filterMembershipMask = Layer.HELD;
        g.aggregate.shape.filterCollideMask = Layer.STATIC | Layer.DYNAMIC;

        // Store the object's transform relative to the manipulator.
        const inv = Quaternion.Inverse(this.rotation);
        g.mesh.absolutePosition.subtractToRef(this.position, this.offsetPos);
        this.offsetPos.rotateByQuaternionToRef(inv, this.offsetPos);
        inv.multiplyToRef(g.mesh.rotationQuaternion!, this.offsetRot);
        this.pulling = remote;
        this.history.length = 0;
        this.held = g;
    }

    /** Release, optionally overriding the throw velocity (desktop throw). */
    release(override?: Vector3): void {
        const g = this.held;
        if (!g) return;
        this.held = null;
        this.system.unclaim(g);
        const body = g.aggregate.body;
        body.setMotionType(PhysicsMotionType.DYNAMIC);
        g.aggregate.shape.filterMembershipMask = Layer.DYNAMIC;
        g.aggregate.shape.filterCollideMask = ALL_LAYERS;
        const { linear, angular } = this.estimateVelocity();
        body.setLinearVelocity(override ?? linear.scaleInPlace(I.throwBoost));
        body.setAngularVelocity(angular);
    }

    /** Offset of the held object along the manipulator's forward axis (desktop wheel). */
    adjustDistance(delta: number, min: number, max: number): void {
        const len = this.offsetPos.length();
        if (len < 1e-4) return;
        const next = Math.min(max, Math.max(min, len + delta));
        this.offsetPos.scaleInPlace(next / len);
    }

    setOffset(pos: Vector3): void {
        this.offsetPos.copyFrom(pos);
    }

    update(dt: number): void {
        const g = this.held;
        if (!g) return;
        if (this.pulling) {
            // Fly into the hand.
            const k = Math.min(1, dt * 10);
            this.offsetPos.scaleInPlace(1 - k);
            if (this.offsetPos.length() < 0.02) this.pulling = false;
        }
        this.offsetPos.rotateByQuaternionToRef(this.rotation, this.target);
        this.target.addInPlace(this.position);
        this.rotation.multiplyToRef(this.offsetRot, this.targetRot);

        // Clamp step length so a fast hand doesn't teleport the body through walls.
        const current = g.mesh.absolutePosition;
        const step = this.target.subtract(current);
        const maxStep = MAX_FOLLOW_SPEED * dt;
        if (step.length() > maxStep) this.target.copyFrom(current.add(step.normalize().scale(maxStep)));

        g.aggregate.body.setTargetTransform(this.target, this.targetRot);

        this.clock += dt;
        const now = this.clock;
        this.history.push({ t: now, p: this.target.clone(), q: this.targetRot.clone() });
        while (this.history.length > 2 && now - this.history[0].t > 0.1) this.history.shift();
    }

    private estimateVelocity(): { linear: Vector3; angular: Vector3 } {
        const h = this.history;
        if (h.length < 2) return { linear: Vector3.Zero(), angular: Vector3.Zero() };
        const a = h[0];
        const b = h[h.length - 1];
        const dt = Math.max(1e-3, b.t - a.t);
        const linear = b.p.subtract(a.p).scaleInPlace(1 / dt);
        const dq = b.q.multiply(Quaternion.Inverse(a.q));
        if (dq.w < 0) dq.scaleInPlace(-1);
        const angle = 2 * Math.acos(Math.min(1, dq.w));
        const s = Math.sqrt(Math.max(1e-8, 1 - dq.w * dq.w));
        const angular = new Vector3(dq.x / s, dq.y / s, dq.z / s).scaleInPlace(angle / dt);
        if (angular.length() > 40) angular.normalize().scaleInPlace(40);
        return { linear, angular };
    }
}

/**
 * Kinematic collider spheres (fingertips, palms, controllers) that push dynamic bodies.
 * They are ANIMATED bodies moved with setTargetTransform, so Havok derives a velocity
 * from the motion and pokes/knocks objects realistically.
 */
export class KinematicCollider {
    readonly node: TransformNode;
    private readonly body: PhysicsBody;
    private readonly prev = new Vector3();
    private enabled = true;
    private readonly debugMesh: Mesh | null;

    constructor(scene: Scene, name: string, radius: number, showDebug = false) {
        this.node = new TransformNode(name, scene);
        this.node.rotationQuaternion = Quaternion.Identity();
        this.body = new PhysicsBody(this.node, PhysicsMotionType.ANIMATED, false, scene);
        const shape = new PhysicsShapeSphere(Vector3.Zero(), radius, scene);
        shape.filterMembershipMask = Layer.HAND;
        shape.filterCollideMask = Layer.DYNAMIC;
        shape.material = { friction: 1.2, restitution: 0 };
        this.body.shape = shape;
        this.body.setMassProperties({ mass: 2, inertia: Vector3.Zero() });
        this.body.disablePreStep = true;
        this.debugMesh = showDebug ? MeshBuilder.CreateSphere(name + "Dbg", { diameter: radius * 2, segments: 8 }, scene) : null;
        if (this.debugMesh) {
            this.debugMesh.parent = this.node;
            this.debugMesh.isPickable = false;
        }
    }

    moveTo(position: Vector3, rotation?: Quaternion): void {
        if (!this.enabled) return;
        // Large jumps (tracking glitch, snap turn, respawn) teleport instead of sweeping through everything.
        if (Vector3.DistanceSquared(this.prev, position) > 0.25) {
            this.body.disablePreStep = false;
            this.node.position.copyFrom(position);
            this.node.getScene().onAfterPhysicsObservable.addOnce(() => (this.body.disablePreStep = true));
        } else {
            this.body.setTargetTransform(position, rotation ?? Quaternion.Identity());
        }
        this.prev.copyFrom(position);
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        this.body.shape!.filterCollideMask = enabled ? Layer.DYNAMIC : 0;
        if (this.debugMesh) this.debugMesh.setEnabled(enabled);
    }

    dispose(): void {
        this.body.shape?.dispose();
        this.body.dispose();
        this.node.dispose();
    }
}

/** Shared bookkeeping for all manipulators (one owner per object) + spatial queries. */
export class InteractionSystem {
    private readonly owners = new Map<Grabbable, Manipulator>();
    private readonly manipulators: Manipulator[] = [];
    private readonly tmpMat = new Matrix();
    private readonly tmpVec = new Vector3();

    constructor(
        private readonly scene: Scene,
        readonly props: Props,
    ) {
        scene.onBeforePhysicsObservable.add(() => {
            const dt = Math.min(0.1, (scene.deltaTime ?? 16) / 1000) || 1 / 60;
            for (const m of this.manipulators) m.update(dt);
        });
    }

    create(name: string): Manipulator {
        const m = new Manipulator(name, this);
        this.manipulators.push(m);
        return m;
    }

    claim(g: Grabbable, by: Manipulator): void {
        const prev = this.owners.get(g);
        if (prev && prev !== by) prev.held = null; // hand-to-hand transfer
        this.owners.set(g, by);
    }

    unclaim(g: Grabbable): void {
        this.owners.delete(g);
    }

    isHeld(g: Grabbable): boolean {
        return this.owners.has(g);
    }

    releaseAll(): void {
        for (const m of this.manipulators) m.release(Vector3.Zero());
    }

    /** Closest grabbable whose surface (approximated by its oriented bounding box) is within `radius`. */
    nearest(point: Vector3, radius: number): Grabbable | null {
        let best: Grabbable | null = null;
        let bestDist = radius;
        for (const g of this.props.grabbables) {
            const mesh = g.mesh;
            const box = mesh.getBoundingInfo().boundingBox;
            // Cheap reject using the world bounding sphere.
            const sphere = mesh.getBoundingInfo().boundingSphere;
            if (Vector3.Distance(point, sphere.centerWorld) - sphere.radiusWorld > radius) continue;
            // Exact distance to the OBB in local space.
            mesh.getWorldMatrix().invertToRef(this.tmpMat);
            Vector3.TransformCoordinatesToRef(point, this.tmpMat, this.tmpVec);
            const scale = mesh.absoluteScaling;
            const dx = Math.max(box.minimum.x - this.tmpVec.x, 0, this.tmpVec.x - box.maximum.x) * scale.x;
            const dy = Math.max(box.minimum.y - this.tmpVec.y, 0, this.tmpVec.y - box.maximum.y) * scale.y;
            const dz = Math.max(box.minimum.z - this.tmpVec.z, 0, this.tmpVec.z - box.maximum.z) * scale.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d <= bestDist) {
                bestDist = d;
                best = g;
            }
        }
        return best;
    }

    /** First grabbable along a ray (physics raycast against dynamic bodies). */
    raycast(from: Vector3, dir: Vector3, length: number): { grabbable: Grabbable; distance: number } | null {
        const to = from.add(dir.scale(length));
        const hit = this.scene.getPhysicsEngine()!.raycast(from, to, { collideWith: Layer.STATIC | Layer.DYNAMIC });
        if (!hit.hasHit || !hit.body) return null;
        const node = hit.body.transformNode as Mesh;
        const g = this.props.get(node);
        if (!g) return null;
        return { grabbable: g, distance: Vector3.Distance(from, hit.hitPointWorld) };
    }

    /** Radial impulse in a cone (desktop "force push"). */
    blast(origin: Vector3, dir: Vector3, range: number, strength: number): void {
        for (const g of this.props.grabbables) {
            if (this.isHeld(g)) continue;
            const to = g.mesh.absolutePosition.subtract(origin);
            const dist = to.length();
            if (dist > range || dist < 1e-3) continue;
            const cos = Vector3.Dot(to.scale(1 / dist), dir);
            if (cos < 0.6) continue;
            const falloff = (1 - dist / range) * cos;
            const mass = g.aggregate.body.getMassProperties().mass ?? 1;
            const impulse = to.normalize().addInPlace(new Vector3(0, 0.35, 0)).scaleInPlace(strength * falloff * Math.sqrt(mass));
            g.aggregate.body.applyImpulse(impulse, g.mesh.absolutePosition);
        }
    }
}
