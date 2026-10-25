// Procedural tree geometry, ported from ez-tree by Daniel Greenheck (MIT)
// https://github.com/dgreenheck/ez-tree — the branching/leaf algorithm is kept as in the
// original (it uses three.js' Euler/Quaternion conventions, so those math classes are reused);
// output is plain arrays converted to Babylon's left-handed system by `toBabylon`.
import { Euler, Quaternion, Vector3 } from "three";

export interface TreePreset {
    seed: number;
    type: "deciduous" | "evergreen";
    bark: { type: string; tint: number; textureScale: { x: number; y: number } };
    branch: {
        levels: number;
        angle: Record<string, number>;
        children: Record<string, number>;
        force: { direction: { x: number; y: number; z: number }; strength: number };
        gnarliness: Record<string, number>;
        length: Record<string, number>;
        radius: Record<string, number>;
        sections: Record<string, number>;
        segments: Record<string, number>;
        start: Record<string, number>;
        taper: Record<string, number>;
        twist: Record<string, number>;
    };
    leaves: { type: string; billboard: "single" | "double"; angle: number; count: number; start: number; size: number; sizeVariance: number; tint: number; alphaTest: number };
}

export interface GeometryArrays {
    positions: number[];
    normals: number[];
    uvs: number[];
    indices: number[];
}

export interface TreeGeometry {
    branches: GeometryArrays;
    leaves: GeometryArrays;
    /** Radius of the trunk at its base, in generator units. */
    trunkRadius: number;
}

class RNG {
    private w: number;
    private z: number;
    constructor(seed: number) {
        this.w = (123456789 + seed) & 0xffffffff;
        this.z = (987654321 - seed) & 0xffffffff;
    }
    random(max = 1, min = 0): number {
        this.z = (36969 * (this.z & 65535) + (this.z >> 16)) & 0xffffffff;
        this.w = (18000 * (this.w & 65535) + (this.w >> 16)) & 0xffffffff;
        const result = (((this.z << 16) + (this.w & 65535)) >>> 0) / 4294967296;
        return (max - min) * result + min;
    }
}

interface Branch {
    origin: Vector3;
    orientation: Euler;
    length: number;
    radius: number;
    level: number;
    sectionCount: number;
    segmentCount: number;
}

interface Section {
    origin: Vector3;
    orientation: Euler;
    radius: number;
}

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/**
 * Generates tree geometry. `detail` (0..1] scales radial segments, sections and leaf count
 * so distant/low-end variants can be produced from the same preset.
 */
export function generateTree(p: TreePreset, detail = 1, seedOffset = 0): TreeGeometry {
    const rng = new RNG(p.seed + seedOffset);
    const b = p.branch;
    const branches: GeometryArrays = { positions: [], normals: [], uvs: [], indices: [] };
    const leaves: GeometryArrays = { positions: [], normals: [], uvs: [], indices: [] };
    const scaleCount = (n: number, min: number) => Math.max(min, Math.round(n * detail));
    const queue: Branch[] = [
        {
            origin: new Vector3(),
            orientation: new Euler(),
            length: b.length[0],
            radius: b.radius[0],
            level: 0,
            sectionCount: scaleCount(b.sections[0], 3),
            segmentCount: scaleCount(b.segments[0], 4),
        },
    ];

    // Low-detail variants use fewer, proportionally larger leaves so the canopy keeps its volume.
    const leafScale = 1 / Math.sqrt(Math.min(1, detail));
    const generateLeaf = (origin: Vector3, orientation: Euler) => {
        let i = leaves.positions.length / 3;
        const size = p.leaves.size * leafScale * (1 + rng.random(p.leaves.sizeVariance, -p.leaves.sizeVariance));
        const W = size;
        const L = size;
        const createLeaf = (rotation: number) => {
            const v = [new Vector3(-W / 2, L, 0), new Vector3(-W / 2, 0, 0), new Vector3(W / 2, 0, 0), new Vector3(W / 2, L, 0)].map((q) =>
                q.applyEuler(new Euler(0, rotation, 0)).applyEuler(orientation).add(origin),
            );
            for (const q of v) leaves.positions.push(q.x, q.y, q.z);
            const n = new Vector3(0, 0, 1).applyEuler(orientation);
            for (let k = 0; k < 4; k++) leaves.normals.push(n.x, n.y, n.z);
            leaves.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
            leaves.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
            i += 4;
        };
        createLeaf(0);
        if (p.leaves.billboard === "double") createLeaf(Math.PI / 2);
    };

    const interpolate = (sections: Section[], t: number) => {
        const index = Math.floor(t * (sections.length - 1));
        const a = sections[index];
        const c = index === sections.length - 1 ? a : sections[index + 1];
        const alpha = (t - index / (sections.length - 1)) / (1 / (sections.length - 1));
        const origin = new Vector3().lerpVectors(a.origin, c.origin, alpha);
        const qA = new Quaternion().setFromEuler(a.orientation);
        const qB = new Quaternion().setFromEuler(c.orientation);
        const orientation = new Euler().setFromQuaternion(qB.slerp(qA, alpha));
        return { origin, orientation, radius: (1 - alpha) * a.radius + alpha * c.radius };
    };

    const childOrientation = (parent: Euler, angleDeg: number, radialAngle: number) => {
        const q1 = new Quaternion().setFromAxisAngle(X, angleDeg / (180 / Math.PI));
        const q2 = new Quaternion().setFromAxisAngle(Y, radialAngle);
        const q3 = new Quaternion().setFromEuler(parent);
        return new Euler().setFromQuaternion(q3.multiply(q2.multiply(q1)));
    };

    const generateLeaves = (sections: Section[]) => {
        const radialOffset = rng.random();
        const count = scaleCount(p.leaves.count, 1);
        for (let i = 0; i < count; i++) {
            const s = interpolate(sections, rng.random(1.0, p.leaves.start));
            generateLeaf(s.origin, childOrientation(s.orientation, p.leaves.angle, 2 * Math.PI * (radialOffset + i / count)));
        }
    };

    const generateChildren = (fullCount: number, level: number, sections: Section[]) => {
        // The outermost branch levels are thinned for low-detail variants.
        const count = level >= 2 ? Math.max(1, Math.round(fullCount * Math.sqrt(Math.min(1, detail)))) : fullCount;
        const radialOffset = rng.random();
        for (let i = 0; i < count; i++) {
            const start = rng.random(1.0, b.start[level]);
            const s = interpolate(sections, start);
            queue.push({
                origin: s.origin,
                orientation: childOrientation(s.orientation, b.angle[level], 2 * Math.PI * (radialOffset + i / count)),
                length: b.length[level] * (p.type === "evergreen" ? 1.0 - start : 1.0),
                radius: b.radius[level] * s.radius,
                level,
                sectionCount: scaleCount(b.sections[level], 2),
                segmentCount: scaleCount(b.segments[level], 3),
            });
        }
    };

    const generateBranch = (branch: Branch) => {
        const indexOffset = branches.positions.length / 3;
        const sectionOrientation = branch.orientation.clone();
        const sectionOrigin = branch.origin.clone();
        const sectionLength = branch.length / branch.sectionCount;
        const sections: Section[] = [];

        for (let i = 0; i <= branch.sectionCount; i++) {
            let sectionRadius = branch.radius;
            if (i === branch.sectionCount && branch.level === b.levels) sectionRadius = 0.001;
            else if (p.type === "deciduous") sectionRadius *= 1 - b.taper[branch.level] * (i / branch.sectionCount);
            else sectionRadius *= 1 - i / branch.sectionCount;

            let first: { v: Vector3; n: Vector3; y: number } | null = null;
            for (let j = 0; j < branch.segmentCount; j++) {
                const angle = (2.0 * Math.PI * j) / branch.segmentCount;
                const v = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(sectionRadius).applyEuler(sectionOrientation).add(sectionOrigin);
                const n = new Vector3(Math.cos(angle), 0, Math.sin(angle)).applyEuler(sectionOrientation).normalize();
                const uvY = i % 2 === 0 ? 0 : 1;
                branches.positions.push(v.x, v.y, v.z);
                branches.normals.push(n.x, n.y, n.z);
                branches.uvs.push(j / branch.segmentCount, uvY);
                if (j === 0) first = { v, n, y: uvY };
            }
            // Duplicate the first vertex so the UV seam wraps cleanly.
            branches.positions.push(first!.v.x, first!.v.y, first!.v.z);
            branches.normals.push(first!.n.x, first!.n.y, first!.n.z);
            branches.uvs.push(1, first!.y);

            sections.push({ origin: sectionOrigin.clone(), orientation: sectionOrientation.clone(), radius: sectionRadius });
            sectionOrigin.add(new Vector3(0, sectionLength, 0).applyEuler(sectionOrientation));

            const gnarliness = Math.max(1, 1 / Math.sqrt(sectionRadius)) * b.gnarliness[branch.level];
            sectionOrientation.x += rng.random(gnarliness, -gnarliness);
            sectionOrientation.z += rng.random(gnarliness, -gnarliness);

            const qSection = new Quaternion().setFromEuler(sectionOrientation);
            const qTwist = new Quaternion().setFromAxisAngle(Y, b.twist[branch.level]);
            const qForce = new Quaternion().setFromUnitVectors(Y, new Vector3(b.force.direction.x, b.force.direction.y, b.force.direction.z));
            qSection.multiply(qTwist);
            qSection.rotateTowards(qForce, b.force.strength / sectionRadius);
            sectionOrientation.setFromQuaternion(qSection);
        }

        // Indices for the cylinder (no end caps).
        const N = branch.segmentCount + 1;
        for (let i = 0; i < branch.sectionCount; i++) {
            for (let j = 0; j < branch.segmentCount; j++) {
                const v1 = indexOffset + i * N + j;
                const v2 = v1 + 1;
                const v3 = v1 + N;
                const v4 = v2 + N;
                branches.indices.push(v1, v3, v2, v2, v3, v4);
            }
        }

        if (p.type === "deciduous") {
            const last = sections[sections.length - 1];
            if (branch.level < b.levels) {
                queue.push({
                    origin: last.origin,
                    orientation: last.orientation,
                    length: b.length[branch.level + 1],
                    radius: last.radius,
                    level: branch.level + 1,
                    sectionCount: branch.sectionCount,
                    segmentCount: branch.segmentCount,
                });
            } else {
                generateLeaf(last.origin, last.orientation);
            }
        }

        if (branch.level === b.levels) generateLeaves(sections);
        else if (branch.level < b.levels) generateChildren(b.children[branch.level], branch.level + 1, sections);
    };

    while (queue.length > 0) generateBranch(queue.shift()!);
    return { branches, leaves, trunkRadius: b.radius[0] };
}

/**
 * Converts right-handed (three.js) arrays to Babylon's left-handed system in place:
 * mirror Z and flip triangle winding.
 */
export function toBabylon(g: GeometryArrays): GeometryArrays {
    for (let i = 2; i < g.positions.length; i += 3) {
        g.positions[i] = -g.positions[i];
        g.normals[i] = -g.normals[i];
    }
    for (let i = 0; i < g.indices.length; i += 3) {
        const t = g.indices[i + 1];
        g.indices[i + 1] = g.indices[i + 2];
        g.indices[i + 2] = t;
    }
    return g;
}
