import {
    type Material,
    Mesh,
    MeshBuilder,
    PBRMaterial,
    PhysicsAggregate,
    PhysicsMotionType,
    PhysicsShapeType,
    Quaternion,
    type Scene,
    Vector3,
} from "@babylonjs/core";
import { ALL_LAYERS, Layer } from "./config";
import type { Environment } from "./environment";
import type { MaterialLibrary } from "./materials";

export interface Grabbable {
    mesh: Mesh;
    aggregate: PhysicsAggregate;
    home: { position: Vector3; rotation: Quaternion };
}

/** Builds the playground: physics blocks, a parkour run, a crouch tunnel and glass showcase pieces. */
export class Props {
    readonly grabbables: Grabbable[] = [];
    readonly staticMeshes: Mesh[] = [];
    private readonly byMesh = new Map<Mesh, Grabbable>();
    private rng = mulberry32(1337);

    constructor(
        private readonly scene: Scene,
        private readonly env: Environment,
        private readonly mats: MaterialLibrary,
    ) {
        // Sponza's central corridor runs along X, between the curtain lines at z ≈ -2.1 and 1.5.
        // The floor isn't perfectly flat, so each structure sits on the highest point under its footprint.
        const z0 = -0.3;
        const at = (x: number, z: number, hx: number, hz: number) => new Vector3(x, this.floorUnder(x, z, hx, hz), z);
        this.buildCrouchTunnel(at(-7.4, z0, 1.2, 0.8));
        this.buildBrickWall(at(-3.0, z0, 0.15, 1.3), 6, 5);
        this.buildHeavyCrates(at(-1.9, z0 - 1.05, 0.9, 0.35));
        this.buildDominoes(at(-2.0, z0 + 0.75, 0.1, 0.3), 15);
        this.buildShowcase(at(2.6, z0 - 1.3, 1.6, 0.25));
        this.buildBlockTower(at(2.4, z0 + 0.45, 0.65, 0.65), 4, 0.32);
        this.buildBlockTower(at(4.3, z0 + 0.2, 0.6, 0.6), 3, 0.4);
        this.buildParkour(at(6.6, z0, 0.5, 0.5));
    }

    get(mesh: Mesh | null | undefined): Grabbable | undefined {
        let m: Mesh | null | undefined = mesh;
        while (m) {
            const g = this.byMesh.get(m);
            if (g) return g;
            m = m.parent instanceof Mesh ? m.parent : null;
        }
        return undefined;
    }

    resetAll(): void {
        for (const g of this.grabbables) {
            const body = g.aggregate.body;
            body.setMotionType(PhysicsMotionType.DYNAMIC);
            body.disablePreStep = false;
            g.mesh.position.copyFrom(g.home.position);
            g.mesh.rotationQuaternion!.copyFrom(g.home.rotation);
            body.setLinearVelocity(Vector3.Zero());
            body.setAngularVelocity(Vector3.Zero());
            this.scene.onAfterPhysicsObservable.addOnce(() => (body.disablePreStep = true));
        }
    }

    // ---------------------------------------------------------------------------

    private floorUnder(x: number, z: number, hx: number, hz: number): number {
        const physics = this.scene.getPhysicsEngine()!;
        let top = Number.NEGATIVE_INFINITY;
        for (const [dx, dz] of [[0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [-hx, 0], [hx, 0], [0, -hz], [0, hz]]) {
            const hit = physics.raycast(new Vector3(x + dx, this.env.floorY + 1, z + dz), new Vector3(x + dx, this.env.floorY - 1, z + dz), { collideWith: Layer.STATIC });
            // Ignore planters/bases: only count floor-level hits.
            if (hit.hasHit && hit.hitPointWorld.y < this.env.floorY + 0.08) top = Math.max(top, hit.hitPointWorld.y);
        }
        return Number.isFinite(top) ? top + 0.004 : this.env.floorY;
    }

    private dynamic(mesh: Mesh, type: PhysicsShapeType, mass: number, material: Material, opts: { friction?: number; restitution?: number } = {}): Grabbable {
        mesh.material = material;
        mesh.rotationQuaternion ??= Quaternion.FromEulerVector(mesh.rotation);
        const aggregate = new PhysicsAggregate(
            mesh,
            type,
            // Start asleep so stacks stay perfectly still until something touches them.
            { mass, friction: opts.friction ?? 0.6, restitution: opts.restitution ?? 0.15, startAsleep: true },
            this.scene,
        );
        aggregate.shape.filterMembershipMask = Layer.DYNAMIC;
        aggregate.shape.filterCollideMask = ALL_LAYERS;
        aggregate.body.setLinearDamping(0.05);
        aggregate.body.setAngularDamping(0.1);
        const g: Grabbable = { mesh, aggregate, home: { position: mesh.position.clone(), rotation: mesh.rotationQuaternion.clone() } };
        this.grabbables.push(g);
        this.byMesh.set(mesh, g);
        this.env.addShadowCaster(mesh);
        this.addToProbe(mesh, material);
        return g;
    }

    private solid(mesh: Mesh, material: Material, motion: "static" | "animated" = "static"): PhysicsAggregate {
        mesh.material = material;
        const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, this.scene);
        aggregate.shape.filterMembershipMask = Layer.STATIC;
        aggregate.shape.filterCollideMask = ALL_LAYERS;
        if (motion === "animated") {
            aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
        } else {
            mesh.freezeWorldMatrix();
        }
        this.staticMeshes.push(mesh);
        this.env.addShadowCaster(mesh);
        this.addToProbe(mesh, material);
        return aggregate;
    }

    private addToProbe(mesh: Mesh, material: Material): void {
        // Materials sampling the probe can't be rendered into it (feedback loop).
        const usesProbe = material instanceof PBRMaterial && (material.subSurface.isRefractionEnabled || material.reflectionTexture === this.env.probe.cubeTexture);
        if (!usesProbe) this.env.probe.renderList!.push(mesh);
    }

    private pick<T>(list: T[]): T {
        return list[Math.floor(this.rng() * list.length)];
    }

    private neonStrip(name: string, from: Vector3, size: Vector3, material: Material): Mesh {
        const strip = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
        strip.position.copyFrom(from);
        strip.material = material;
        strip.isPickable = false;
        strip.freezeWorldMatrix();
        return strip;
    }

    private buildBlockTower(base: Vector3, levels: number, s: number): void {
        for (let level = 0; level < levels; level++) {
            const n = levels - level;
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    const box = MeshBuilder.CreateBox("block", { size: s * 0.98 }, this.scene);
                    box.position.set(base.x + (i - (n - 1) / 2) * s, base.y + s / 2 + level * s + 0.002, base.z + (j - (n - 1) / 2) * s);
                    this.dynamic(box, PhysicsShapeType.BOX, 1.5, this.pick(this.mats.blockPalette));
                }
            }
        }
    }

    private buildBrickWall(base: Vector3, cols: number, rows: number): void {
        const w = 0.42;
        const h = 0.21;
        const d = 0.21;
        for (let r = 0; r < rows; r++) {
            const offset = r % 2 ? w / 2 : 0;
            for (let c = 0; c < cols; c++) {
                const brick = MeshBuilder.CreateBox("brick", { width: d, height: h * 0.98, depth: w * 0.98 }, this.scene);
                brick.position.set(base.x, base.y + h / 2 + r * h + 0.002, base.z + (c - (cols - 1) / 2) * w + offset);
                const mat = r === rows - 1 ? this.mats.gold : c % 3 === 0 ? this.mats.carPaint : this.mats.marble;
                this.dynamic(brick, PhysicsShapeType.BOX, 1.2, mat);
            }
        }
    }

    private buildDominoes(start: Vector3, count: number): void {
        for (let i = 0; i < count; i++) {
            const domino = MeshBuilder.CreateBox("domino", { width: 0.06, height: 0.5, depth: 0.25 }, this.scene);
            const a = i * 0.11;
            domino.position.set(start.x + i * 0.22, start.y + 0.251, start.z + Math.sin(a * 2) * 0.25);
            domino.rotation.y = -Math.cos(a * 2) * 0.5;
            this.dynamic(domino, PhysicsShapeType.BOX, 0.6, i % 2 ? this.mats.iridescent : this.mats.pearlCoat, { friction: 0.4 });
        }
    }

    private buildParkour(base: Vector3): void {
        // Rising steps to jump up, along the -Z side of the corridor.
        const steps = [0.35, 0.7, 1.05, 1.4];
        steps.forEach((h, i) => {
            const step = MeshBuilder.CreateBox("step", { width: 0.9, height: h, depth: 1.0 }, this.scene);
            step.position.set(base.x + i * 1.1, base.y + h / 2, base.z - 1.0);
            this.solid(step, i % 2 ? this.mats.darkStone : this.mats.marble);
            this.neonStrip("stepEdge", new Vector3(step.position.x - 0.45, base.y + h + 0.01, step.position.z), new Vector3(0.02, 0.02, 1.0), this.mats.neonCyan);
        });

        // High platform beside the last step: a small gap to jump across.
        const top = MeshBuilder.CreateBox("platform", { width: 1.4, height: 0.2, depth: 1.2 }, this.scene);
        top.position.set(base.x + 3.3, base.y + 1.6, base.z + 0.75);
        this.solid(top, this.mats.brushedSteel);
        const pillar = MeshBuilder.CreateCylinder("pillar", { height: 1.5, diameter: 0.3 }, this.scene);
        pillar.position.set(top.position.x, base.y + 0.75, top.position.z);
        this.solid(pillar, this.mats.chrome);

        // A kinematic moving platform to ride (or jump down onto from the high platform).
        const mover = MeshBuilder.CreateBox("mover", { width: 1.1, height: 0.15, depth: 1.1 }, this.scene);
        mover.position.set(base.x - 0.9, base.y + 0.8, base.z + 0.75);
        const moverAgg = this.solid(mover, this.mats.velvet, "animated");
        this.neonStrip("moverGlow", new Vector3(0, -0.085, 0), new Vector3(1.0, 0.02, 1.0), this.mats.neonMagenta).parent = mover;
        // Driven with target transforms so Havok gives it a real velocity the player can ride on.
        const start = base.x - 0.9;
        const travel = 2.9;
        const pos = mover.position.clone();
        const rot = Quaternion.Identity();
        let time = 0;
        this.scene.onBeforePhysicsObservable.add(() => {
            time += this.scene.deltaTime / 1000;
            pos.x = start + travel * (0.5 - 0.5 * Math.cos(time * 0.5));
            moverAgg.body.setTargetTransform(pos, rot);
        });

        // A few blocks on top to knock off.
        for (let i = 0; i < 3; i++) {
            const c = MeshBuilder.CreateBox("topCrate", { size: 0.3 }, this.scene);
            c.position.set(top.position.x + 0.3, base.y + 1.86, top.position.z - 0.4 + i * 0.4);
            this.dynamic(c, PhysicsShapeType.BOX, 1, this.pick([this.mats.glass, this.mats.gold, this.mats.crate]));
        }
    }

    private buildCrouchTunnel(base: Vector3): void {
        const length = 2.4;
        const clearance = 1.15;
        const width = 1.3;
        for (const side of [-1, 1]) {
            const wall = MeshBuilder.CreateBox("tunnelWall", { width: length, height: clearance, depth: 0.15 }, this.scene);
            wall.position.set(base.x, base.y + clearance / 2, base.z + side * (width / 2 + 0.075));
            this.solid(wall, this.mats.darkStone);
            this.neonStrip("tunnelGlow", new Vector3(base.x, base.y + 0.05, base.z + side * (width / 2 - 0.005)), new Vector3(length, 0.03, 0.02), this.mats.neonAmber);
        }
        const roof = MeshBuilder.CreateBox("tunnelRoof", { width: length, height: 0.25, depth: width + 0.3 }, this.scene);
        roof.position.set(base.x, base.y + clearance + 0.125, base.z);
        this.solid(roof, this.mats.frostedGlass);
        this.neonStrip("tunnelRoofGlow", new Vector3(base.x - length / 2 - 0.01, base.y + clearance - 0.02, base.z), new Vector3(0.02, 0.03, width), this.mats.neonAmber);
        this.neonStrip("tunnelRoofGlow", new Vector3(base.x + length / 2 + 0.01, base.y + clearance - 0.02, base.z), new Vector3(0.02, 0.03, width), this.mats.neonAmber);

        // A low beam to duck under before the tunnel.
        const beam = MeshBuilder.CreateBox("duckBeam", { width: 0.2, height: 0.2, depth: 2.4 }, this.scene);
        beam.position.set(base.x + 2.0, base.y + 1.3, base.z);
        this.solid(beam, this.mats.brushedSteel);
        for (const side of [-1, 1]) {
            const post = MeshBuilder.CreateCylinder("beamPost", { height: 1.3, diameter: 0.12 }, this.scene);
            post.position.set(beam.position.x, base.y + 0.65, base.z + side * 1.15);
            this.solid(post, this.mats.chrome);
        }
    }

    private buildShowcase(base: Vector3): void {
        const items: Array<{ mesh: Mesh; type: PhysicsShapeType; mat: Material; mass: number }> = [
            { mesh: MeshBuilder.CreatePolyhedron("diamond", { type: 1, size: 0.12 }, this.scene), type: PhysicsShapeType.CONVEX_HULL, mat: this.mats.diamond, mass: 0.5 },
            { mesh: MeshBuilder.CreateSphere("glassOrb", { diameter: 0.26, segments: 48 }, this.scene), type: PhysicsShapeType.SPHERE, mat: this.mats.glass, mass: 1 },
            { mesh: MeshBuilder.CreateTorusKnot("amberKnot", { radius: 0.1, tube: 0.035, radialSegments: 160, tubularSegments: 24 }, this.scene), type: PhysicsShapeType.CONVEX_HULL, mat: this.mats.amberGlass, mass: 0.8 },
            { mesh: MeshBuilder.CreateIcoSphere("jadeGem", { radius: 0.13, subdivisions: 2, flat: true }, this.scene), type: PhysicsShapeType.CONVEX_HULL, mat: this.mats.jade, mass: 0.8 },
            { mesh: MeshBuilder.CreateCylinder("waxCandle", { height: 0.3, diameter: 0.12, tessellation: 40 }, this.scene), type: PhysicsShapeType.CYLINDER, mat: this.mats.wax, mass: 0.4 },
            { mesh: MeshBuilder.CreateSphere("chromeBall", { diameter: 0.22, segments: 48 }, this.scene), type: PhysicsShapeType.SPHERE, mat: this.mats.chrome, mass: 2 },
        ];
        items.forEach((item, i) => {
            const x = base.x + (i - (items.length - 1) / 2) * 0.62;
            const plinth = MeshBuilder.CreateCylinder("plinth", { height: 0.9, diameterTop: 0.36, diameterBottom: 0.46, tessellation: 48 }, this.scene);
            plinth.position.set(x, base.y + 0.45, base.z);
            this.solid(plinth, this.mats.marble);
            this.neonStrip("plinthRing", new Vector3(x, base.y + 0.905, base.z), new Vector3(0.3, 0.008, 0.3), this.mats.neonCyan).scaling.set(1, 1, 1);
            item.mesh.position.set(x, base.y + 1.1, base.z);
            this.dynamic(item.mesh, item.type, item.mass, item.mat, { restitution: item.mesh.name === "chromeBall" ? 0.6 : 0.2 });
        });
    }

    private buildHeavyCrates(base: Vector3): void {
        for (let i = 0; i < 3; i++) {
            const crate = MeshBuilder.CreateBox("heavyCrate", { size: 0.6 }, this.scene);
            crate.position.set(base.x + i * 0.68, base.y + 0.301, base.z);
            this.dynamic(crate, PhysicsShapeType.BOX, 25, this.mats.crate, { friction: 0.9 });
        }
        const big = MeshBuilder.CreateBox("heavyCrate", { size: 0.6 }, this.scene);
        big.position.set(base.x + 0.34, base.y + 0.902, base.z);
        this.dynamic(big, PhysicsShapeType.BOX, 25, this.mats.crate, { friction: 0.9 });
    }
}

/** Small deterministic PRNG so the block palette layout is stable between runs. */
function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
