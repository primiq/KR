import { Color3, Mesh, type Scene, Vector3, VertexData } from "@babylonjs/core";

export interface PalmGeometry {
    trunk: Mesh;
    fronds: Mesh;
    coconuts: Mesh;
    /** Crown position relative to the base (for colliders and coconut drops). */
    crown: Vector3;
    trunkRadius: number;
}

function rng(seed: number): () => number {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

/**
 * Builds one coconut palm: a curved, ringed trunk, a crown of drooping pinnate fronds (each
 * leaflet its own quad, coloured per-vertex from deep green to sun-bleached tips) and a coconut
 * cluster. `detail` scales tessellation for lower quality tiers.
 */
export function buildPalm(scene: Scene, name: string, seed: number, height: number, detail: number): PalmGeometry {
    const random = rng(seed);
    const lean = 0.15 + random() * 0.25;
    const leanDir = random() * Math.PI * 2;
    const curve = (t: number) => {
        // Trunk leans then curves back up towards the light.
        const off = lean * height * (t * t * 0.9 - t * t * t * 0.35);
        return new Vector3(Math.cos(leanDir) * off, t * height, Math.sin(leanDir) * off);
    };

    // ---- Trunk ----------------------------------------------------------------
    const rings = Math.max(8, Math.round(36 * detail));
    const sides = Math.max(6, Math.round(12 * detail));
    const tp: number[] = [];
    const tn: number[] = [];
    const tuv: number[] = [];
    const ti: number[] = [];
    const baseR = 0.2 + random() * 0.05;
    for (let r = 0; r <= rings; r++) {
        const t = r / rings;
        const c = curve(t);
        const next = curve(Math.min(1, t + 0.01));
        const prev = curve(Math.max(0, t - 0.01));
        const tangent = next.subtract(prev).normalize();
        const side = Vector3.Cross(tangent, Vector3.Right()).normalize();
        const bin = Vector3.Cross(tangent, side).normalize();
        // Flared base, gentle taper, and the characteristic leaf-scar rings.
        const ringBulge = 1 + 0.06 * Math.pow(Math.abs(Math.sin(t * height * 3.2)), 6);
        const radius = baseR * (1 + 0.6 * Math.exp(-t * 18)) * (1 - t * 0.35) * ringBulge;
        for (let s = 0; s <= sides; s++) {
            const a = (s / sides) * Math.PI * 2;
            const n = side.scale(Math.cos(a)).addInPlace(bin.scale(Math.sin(a)));
            const p = c.add(n.scale(radius));
            tp.push(p.x, p.y, p.z);
            tn.push(n.x, n.y, n.z);
            tuv.push(s / sides, t * height * 0.7);
        }
    }
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < sides; s++) {
            const a = r * (sides + 1) + s;
            const b = a + sides + 1;
            ti.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const trunk = new Mesh(`${name}Trunk`, scene);
    Object.assign(new VertexData(), { positions: tp, normals: tn, uvs: tuv, indices: ti }).applyToMesh(trunk);

    // ---- Fronds ---------------------------------------------------------------------
    const crown = curve(1);
    const fp: number[] = [];
    const fn: number[] = [];
    const fc: number[] = [];
    const fi: number[] = [];
    const frondCount = Math.max(8, Math.round((11 + random() * 5) * Math.min(1, detail + 0.3)));
    const segs = Math.max(10, Math.round(26 * detail));
    const dark = new Color3(0.08, 0.26, 0.05);
    const mid = new Color3(0.2, 0.45, 0.1);
    const dry = new Color3(0.55, 0.52, 0.25);
    const push = (p: Vector3, n: Vector3, col: Color3) => {
        fp.push(p.x, p.y, p.z);
        fn.push(n.x, n.y, n.z);
        fc.push(col.r, col.g, col.b, 1);
        return fp.length / 3 - 1;
    };
    for (let f = 0; f < frondCount; f++) {
        const yaw = (f / frondCount) * Math.PI * 2 + random() * 0.4;
        const pitch = 0.15 + random() * 0.85; // initial upward angle
        const len = 3.2 + random() * 1.8;
        const droop = 0.9 + random() * 0.8;
        const dirH = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
        const sideDir = new Vector3(-dirH.z, 0, dirH.x);
        const dryness = random() < 0.15 ? 0.6 : random() * 0.25;
        let prevSpine = crown.clone();
        for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            // Spine: arcs up then droops under its own weight.
            const spine = crown
                .add(dirH.scale(t * len * Math.cos(pitch * (1 - t))))
                .addInPlace(new Vector3(0, t * len * Math.sin(pitch) - droop * t * t * len * 0.55, 0));
            const along = spine.subtract(prevSpine);
            prevSpine = spine;
            if (s === 0) continue;
            const leafLen = (0.15 + Math.sin(Math.PI * Math.min(1, t * 1.08)) * 0.75) * (len / 4.2);
            const along1 = along.normalize();
            const col = Color3.Lerp(Color3.Lerp(dark, mid, t), dry, dryness * t + 0.25 * t * t);
            for (const sgn of [-1, 1]) {
                // Leaflets hang down and slightly forward, in a V around the spine.
                const out = sideDir.scale(sgn).addInPlace(along1.scale(0.35)).addInPlace(new Vector3(0, -0.55, 0)).normalize();
                const tip = spine.add(out.scale(leafLen));
                const w = along.scale(0.55);
                const n = Vector3.Cross(out, along1).normalize().scaleInPlace(sgn);
                if (n.y < 0) n.scaleInPlace(-1);
                const a = push(spine.subtract(w), n, col);
                const b = push(spine.add(w), n, col);
                const c = push(tip.add(w.scale(0.2)), n, Color3.Lerp(col, dry, 0.25));
                const d = push(tip.subtract(w.scale(0.2)), n, Color3.Lerp(col, dry, 0.25));
                fi.push(a, b, c, a, c, d);
            }
        }
    }
    const fronds = new Mesh(`${name}Fronds`, scene);
    Object.assign(new VertexData(), { positions: fp, normals: fn, colors: fc, indices: fi }).applyToMesh(fronds);

    // ---- Coconut cluster ---------------------------------------------------------------
    const nuts: VertexData[] = [];
    const sphere = (p: Vector3, r: number) => {
        const v = VertexData.CreateSphere({ diameter: r * 2, segments: Math.max(4, Math.round(8 * detail)) });
        for (let i = 0; i < v.positions!.length; i += 3) {
            v.positions![i] += p.x;
            v.positions![i + 1] += p.y;
            v.positions![i + 2] += p.z;
        }
        return v;
    };
    const nutCount = 3 + Math.floor(random() * 4);
    for (let i = 0; i < nutCount; i++) {
        const a = random() * Math.PI * 2;
        nuts.push(sphere(crown.add(new Vector3(Math.cos(a) * 0.22, -0.25 - random() * 0.2, Math.sin(a) * 0.22)), 0.12 + random() * 0.03));
    }
    const coconuts = new Mesh(`${name}Coconuts`, scene);
    const merged = nuts[0];
    merged.merge(nuts.slice(1));
    merged.colors = new Array((merged.positions!.length / 3) * 4).fill(0).map((_, i) => [0.32, 0.22, 0.1, 1][i % 4]);
    merged.applyToMesh(coconuts);

    return { trunk, fronds, coconuts, crown, trunkRadius: baseR };
}
