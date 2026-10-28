import { Constants, EffectRenderer, EffectWrapper, RenderTargetTexture, type Scene, Texture, Vector2, Vector4 } from "@babylonjs/core";

export const MAX_DROPS = 16;

const SIM_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D prevState;
uniform vec2 texel;
uniform vec2 shift;
uniform vec4 drops[${MAX_DROPS}];
uniform float speed;
uniform float damping;

void main(void) {
    vec2 uv = vUV + shift;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
    vec2 s = texture2D(prevState, uv).rg;
    float avg = 0.25 * (texture2D(prevState, uv + vec2(texel.x, 0.0)).r + texture2D(prevState, uv - vec2(texel.x, 0.0)).r
                      + texture2D(prevState, uv + vec2(0.0, texel.y)).r + texture2D(prevState, uv - vec2(0.0, texel.y)).r);
    // Height/velocity wave equation: accelerate towards the neighbours' mean, then damp.
    float vel = (s.g + (avg - s.r) * speed) * damping;
    float h = (s.r + vel) * damping;
    for (int i = 0; i < ${MAX_DROPS}; i++) {
        vec4 d = drops[i];
        if (d.z <= 0.0) continue;
        float f = 1.0 - smoothstep(0.0, d.z, distance(vUV, d.xy));
        h += d.w * f * f;
    }
    // Absorb waves at the borders so nothing reflects back.
    float edge = smoothstep(0.0, 0.08, min(min(vUV.x, vUV.y), min(1.0 - vUV.x, 1.0 - vUV.y)));
    gl_FragColor = vec4(h * edge, vel * edge, 0.0, 1.0);
}`;

/**
 * Real-time interactive ripples: a height/velocity wave-equation simulation run on the GPU in a
 * ping-pong pair of half-float render targets. The simulated square follows the player (re-centred
 * in whole texels so the solution never smears), and anything touching the water injects "drops".
 */
export class RippleSimulation {
    readonly size: number;
    readonly worldSize: number;
    /** World-space min corner (x, z) of the simulated square. */
    readonly origin = new Vector2();
    enabled = true;
    private readonly targets: [RenderTargetTexture, RenderTargetTexture];
    private readonly renderer: EffectRenderer;
    private readonly wrapper: EffectWrapper;
    private current = 0;
    private readonly drops: Vector4[] = [];
    private readonly dropData = new Float32Array(MAX_DROPS * 4);
    private pendingShift = new Vector2();
    private placed = false;

    constructor(
        scene: Scene,
        size: number,
        worldSize: number,
    ) {
        this.size = size;
        this.worldSize = worldSize;
        const make = (name: string) => {
            const rt = new RenderTargetTexture(name, size, scene, { generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Texture.BILINEAR_SAMPLINGMODE });
            rt.wrapU = rt.wrapV = Texture.CLAMP_ADDRESSMODE;
            rt.refreshRate = 0;
            return rt;
        };
        this.targets = [make("ripplesA"), make("ripplesB")];
        this.renderer = new EffectRenderer(scene.getEngine());
        this.wrapper = new EffectWrapper({
            engine: scene.getEngine(),
            name: "rippleSim",
            fragmentShader: SIM_FRAGMENT,
            uniformNames: ["texel", "shift", "drops", "speed", "damping"],
            samplerNames: ["prevState"],
        });
        // Start from flat water.
        for (const t of this.targets) {
            scene.getEngine().bindFramebuffer(t.renderTarget!);
            scene.getEngine().clear({ r: 0, g: 0, b: 0, a: 1 } as never, true, false, false);
            scene.getEngine().unBindFramebuffer(t.renderTarget!);
        }
    }

    /** The texture holding the latest heights (R) and velocities (G). */
    get texture(): RenderTargetTexture {
        return this.targets[this.current];
    }

    get cellSize(): number {
        return this.worldSize / this.size;
    }

    /** Queue a disturbance at a world position. `strength` is metres of displacement per frame. */
    addDrop(x: number, z: number, radius: number, strength: number): void {
        if (this.drops.length >= MAX_DROPS) {
            // Keep the strongest ones.
            let weakest = 0;
            for (let i = 1; i < this.drops.length; i++) if (Math.abs(this.drops[i].w) < Math.abs(this.drops[weakest].w)) weakest = i;
            if (Math.abs(this.drops[weakest].w) >= Math.abs(strength)) return;
            this.drops.splice(weakest, 1);
        }
        const u = (x - this.origin.x) / this.worldSize;
        const v = (z - this.origin.y) / this.worldSize;
        if (u < 0 || v < 0 || u > 1 || v > 1) return;
        this.drops.push(new Vector4(u, v, radius / this.worldSize, strength));
    }

    /** Keep the simulation centred on (x, z), shifting the solution by whole texels. */
    follow(x: number, z: number): void {
        const cell = this.cellSize;
        const half = this.worldSize / 2;
        const ox = Math.round((x - half) / cell) * cell;
        const oz = Math.round((z - half) / cell) * cell;
        const dx = ox - this.origin.x;
        const dz = oz - this.origin.y;
        if (this.placed && Math.abs(dx) < cell * 8 && Math.abs(dz) < cell * 8) return;
        // A jump larger than the square (teleport/respawn) just starts from flat water.
        this.pendingShift.set(this.placed ? dx / this.worldSize : 2, this.placed ? dz / this.worldSize : 2);
        this.origin.set(ox, oz);
        this.placed = true;
    }

    step(): void {
        if (!this.enabled || !this.wrapper.effect.isReady()) return;
        const src = this.targets[this.current];
        const dst = this.targets[1 - this.current];
        this.dropData.fill(0);
        this.drops.forEach((d, i) => d.toArray(this.dropData, i * 4));
        const shift = this.pendingShift;
        this.wrapper.onApplyObservable.addOnce(() => {
            const e = this.wrapper.effect;
            e.setTexture("prevState", src);
            e.setFloat2("texel", 1 / this.size, 1 / this.size);
            e.setFloat2("shift", shift.x, shift.y);
            e.setArray4("drops", this.dropData as unknown as number[]);
            e.setFloat("speed", 0.6);
            e.setFloat("damping", 0.993);
        });
        this.renderer.render(this.wrapper, dst);
        this.current = 1 - this.current;
        this.drops.length = 0;
        this.pendingShift.set(0, 0);
    }

    dispose(): void {
        this.targets.forEach((t) => t.dispose());
        this.wrapper.dispose();
        this.renderer.dispose();
    }
}
