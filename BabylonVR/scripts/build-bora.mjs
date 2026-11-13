// Builds the game's Bora character (public/models/bora.glb) from the artist's Blender export (assets-src/Bora.glb).
//
// The export carries Blender's whole control rig (990 bones: controls, mechanism and original bones next to the 69 that
// bend the body) and very dense hair and beard. The game needs only the deforming body bones, so this:
//  - keeps the body's deform bones (spine to head, legs, arms, hands and fingers), re-parented straight to each other;
//    the face's many small bones are folded into the head (the game does not move the face),
//  - re-weights every vertex onto the kept bones (each removed bone's weight goes to the kept bone it belongs to),
//  - simplifies the hair and the beard, drops the one-frame "animation" and the rig's widget shapes,
//  - writes a small GLB the game loads (and clones per player).
// Run: node scripts/build-bora.mjs   (the output is committed, so the build does not need this step)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, simplifyPrimitive, weldPrimitive, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets-src", "Bora.glb"), OUT = join(root, "public", "models", "bora.glb");

// ---- 4x4 column-major matrix helpers (glTF order)
const mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
};
const inv = (m) => {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return [
        (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
        (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
        (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
        (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
    ];
};

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const R = doc.getRoot();

for (const a of R.listAnimations()) a.dispose();

const skin = R.listSkins().find((s) => s.getName() === "rig.001");
const joints = skin.listJoints();
const byName = new Map(R.listNodes().map((n) => [n.getName(), n]));
const parentOf = new Map();
for (const n of R.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);

// the body's deform bones (the face's are left out: they fold into the head)
const FACE = /^DEF-(ear|nose|lid|eye|teeth|tongue|jaw|chin|lip|brow|cheek|forehead|temple)/;
const PALM = /^DEF-palm/;
const keep = joints.filter((j) => j.getName().startsWith("DEF-") && !FACE.test(j.getName()) && !PALM.test(j.getName()));
const keepSet = new Set(keep);
console.log("bones kept:", keep.length);

/** the kept bone a node's weight goes to: itself, its DEF twin (ORG-/MCH- x -> DEF- x), or the nearest such ancestor */
const target = (n) => {
    for (let m = n; m; m = parentOf.get(m)) {
        if (keepSet.has(m)) return m;
        const base = m.getName().replace(/^(ORG|MCH|DEF)-/, "");
        const twin = byName.get("DEF-" + base);
        if (twin && keepSet.has(twin)) return twin;
        // (a palm bone goes to its hand)
        if (/^palm/.test(base)) return byName.get("DEF-hand" + base.slice(base.lastIndexOf("."), base.length).replace(/^\.\d+/, ""));
    }
    return byName.get("DEF-spine");
};
// (the palms' side suffix: DEF-palm.01.L -> DEF-hand.L)
const palmHand = (n) => byName.get("DEF-hand." + n.getName().split(".").pop());

// ---- the kept bones: their rest pose in the world, then a hierarchy of their own
const world = new Map(keep.map((j) => [j, j.getWorldMatrix()]));
const ibmAcc = skin.getInverseBindMatrices();
const ibm = new Map(joints.map((j, i) => [j, Array.from(ibmAcc.getElement(i, new Array(16)))]));
const rig = doc.createNode("bora_rig");
const scene = R.listScenes()[0];
scene.addChild(rig);
for (const j of keep) {
    let p = parentOf.get(j), kp = null;
    while (p) { if (keepSet.has(p)) { kp = p; break; } p = parentOf.get(p); }
    const local = kp ? mul(inv(world.get(kp)), world.get(j)) : world.get(j);
    parentOf.get(j)?.removeChild(j);
    (kp ?? rig).addChild(j);
    j.setMatrix(local);
}
// (setMatrix decomposes into TRS: the kept bones keep their rest pose exactly)

const newSkin = doc.createSkin("bora").setSkeleton(rig);
for (const j of keep) newSkin.addJoint(j);
const buf = R.listBuffers()[0];
const ibmArr = new Float32Array(keep.length * 16);
keep.forEach((j, i) => ibmArr.set(ibm.get(j), i * 16));
newSkin.setInverseBindMatrices(doc.createAccessor("boraIBM").setType("MAT4").setArray(ibmArr).setBuffer(buf));

// ---- every vertex re-weighted onto the kept bones (up to four, largest first, summing to one)
const idxOf = new Map(keep.map((j, i) => [j, i]));
const mapIdx = joints.map((j) => idxOf.get(PALM.test(j.getName()) ? palmHand(j) : target(j)));
const meshNodes = R.listNodes().filter((n) => n.getMesh() && n.getSkin() === skin);
for (const n of meshNodes) {
    for (const prim of n.getMesh().listPrimitives()) {
        const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0"), cnt = J.getCount();
        const nj = new Uint8Array(cnt * 4), nw = new Float32Array(cnt * 4), j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
        for (let v = 0; v < cnt; v++) {
            J.getElement(v, j4); W.getElement(v, w4);
            const acc = new Map();
            for (let k = 0; k < 4; k++) if (w4[k] > 0) { const t = mapIdx[j4[k]]; acc.set(t, (acc.get(t) ?? 0) + w4[k]); }
            const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, x) => s + x[1], 0) || 1;
            top.forEach(([t, w], k) => { nj[v * 4 + k] = t; nw[v * 4 + k] = w / sum; });
            if (!top.length) { nj[v * 4] = idxOf.get(byName.get("DEF-spine")); nw[v * 4] = 1; }
        }
        prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(nj).setBuffer(buf));
        prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(nw).setBuffer(buf));
    }
    n.setSkin(newSkin);
    parentOf.get(n)?.removeChild(n);
    rig.addChild(n);
    n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// ---- the rest goes: the old skins, the control rig, the metarig, the widget shapes
for (const s of R.listSkins()) if (s !== newSkin) s.dispose();
for (const n of [...scene.listChildren()]) if (n !== rig) n.dispose();
for (const n of R.listNodes()) if (!keepSet.has(n) && n !== rig && !meshNodes.includes(n)) n.dispose();

/** smooth vertex normals (area-weighted) for a welded, indexed primitive */
function smoothNormals(prim) {
    const P = prim.getAttribute("POSITION"), I = prim.getIndices(), n = P.getCount(), N = new Float32Array(n * 3);
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let t = 0; t < I.getCount(); t += 3) {
        const i0 = I.getScalar(t), i1 = I.getScalar(t + 1), i2 = I.getScalar(t + 2);
        P.getElement(i0, a); P.getElement(i1, b); P.getElement(i2, c);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [i0, i1, i2]) { N[i * 3] += nx; N[i * 3 + 1] += ny; N[i * 3 + 2] += nz; }
    }
    for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
    prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(N).setBuffer(R.listBuffers()[0]));
}

// ---- hair and beard much lighter (they were most of the vertices); the body a little
const RATIO = { Hair: 0.45, Beard: 0.45, Body: 0.7 };
for (const n of meshNodes) {
    const r = RATIO[n.getName()];
    if (!r) continue;
    for (const prim of n.getMesh().listPrimitives()) {
        const before = prim.getAttribute("POSITION").getCount();
        // (the hair and the beard have no texture: without their UVs and normals the tufts weld into one surface)
        if (n.getName() !== "Body") { prim.setAttribute("TEXCOORD_0", null); prim.setAttribute("TEXCOORD_1", null); prim.setAttribute("NORMAL", null); }
        weldPrimitive(prim, {});
        // (the hair and beard are many small separate tufts, all border: they are let go a little further)
        const tufts = n.getName() !== "Body";
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: r, error: tufts ? 0.006 : 0.002, lockBorder: !tufts });
        if (!prim.getAttribute("NORMAL")) smoothNormals(prim);
        console.log(n.getName(), before, "->", prim.getAttribute("POSITION").getCount());
    }
}

await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }));
await io.write(OUT, doc);
let v = 0;
for (const m of R.listMeshes()) for (const p of m.listPrimitives()) v += p.getAttribute("POSITION").getCount();
console.log("vertices:", v, "->", OUT);
