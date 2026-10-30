import { DynamicTexture, type Scene, Texture } from "@babylonjs/core";

let LEAVES: DynamicTexture | null = null;

/**
 * The bushes' leaf cards: a sprig of leaves drawn once into a texture (pale, so each card's own green tints it), cut out
 * by its alpha. Its stem is at the bottom middle of the square from (0, 0) to (0.94, 0.94); a solid white patch in the top
 * right corner (LEAF_SOLID in world/geo.ts) is for the parts of a bush that are not cards.
 */
export function leafTexture(scene: Scene): DynamicTexture {
    if (LEAVES) return LEAVES;
    const S = 512, R = S * 0.94;
    const t = new DynamicTexture("bushLeaves", S, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = t.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, S, S);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // canvas y runs down; the sprite's bottom (v = 0) is the canvas bottom
    const x0 = R / 2, y0 = S - 2;
    const leaf = (x: number, y: number, ang: number, len: number, wid: number, shade: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        const g = ctx.createLinearGradient(0, 0, 0, -len);
        const a = Math.round(255 * shade), b = Math.round(255 * Math.min(1, shade + 0.18));
        g.addColorStop(0, `rgb(${a},${a},${a})`);
        g.addColorStop(1, `rgb(${b},${b},${b})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
        ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
        ctx.fill();
        // the midrib and a darker edge on one side, so the leaf has some form
        ctx.strokeStyle = `rgba(0,0,0,0.22)`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len * 0.92); ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-wid, -len * 0.25, -wid * 0.8, -len * 0.75, 0, -len);
        ctx.lineTo(0, 0);
        ctx.fill();
        ctx.restore();
    };
    // a few stems fanning up from the bottom, leaves alternating along them
    for (let s = 0; s < 3; s++) {
        const sa = (s - 1) * 0.42 + (rnd() - 0.5) * 0.15, sl = R * (0.78 + rnd() * 0.12);
        const ex = x0 + Math.sin(sa) * sl, ey = y0 - Math.cos(sa) * sl;
        ctx.strokeStyle = "rgb(150,140,110)";
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
        const n = 7;
        for (let i = 1; i <= n; i++) {
            const k = i / (n + 0.6), px = x0 + (ex - x0) * k, py = y0 + (ey - y0) * k;
            const side = i % 2 ? 1 : -1, len = R * (0.2 + 0.08 * (1 - k)) * (0.85 + rnd() * 0.3);
            leaf(px, py, sa + side * (0.75 + rnd() * 0.35), len, len * 0.36, 0.72 + rnd() * 0.22);
        }
        leaf(ex, ey, sa + (rnd() - 0.5) * 0.3, R * 0.2, R * 0.07, 0.85);
    }
    // the solid patch
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(S - 22, 0, 22, 22);
    t.hasAlpha = true;
    t.update(true);
    LEAVES = t;
    return t;
}
