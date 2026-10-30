import { ShaderStore } from "@babylonjs/core";

const ACES = `
vec3 hsAces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }`;

function wrap(src: string): string {
    if (src.includes("hsMainRaw")) return src;
    const re = /void\s+main\s*\(\s*(void)?\s*\)/;
    if (!re.test(src)) return src;
    // (the new main goes where the old one was: Babylon declares WebGL2's colour output just before the first main)
    return src.replace(re, `void hsMainRaw();\n${ACES}\nvoid main(void) { hsMainRaw(); vec3 c = hsAces(max(gl_FragColor.rgb, vec3(0.0)) * 0.8); c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.35); gl_FragColor.rgb = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }\nvoid hsMainRaw()`);
}

/**
 * A headset draws straight to its eyes, without the post-processing chain that tone-maps the picture on a screen (the
 * standard materials do it themselves then). This gives the game's own shaders (the sea, the sky, the rain, the big wave...)
 * the same: every fragment shader of a ShaderMaterial, and the scattering sky's, ends with the filmic curve, a touch of
 * extra saturation (the screen's colour grading) and gamma.
 * (Done where Babylon looks the shader up, so ones registered later, like the sea's, are caught too.)
 */
export function toneMapOwnShaders() {
    const store = ShaderStore.ShadersStore;
    const cache = new Map<string, string>();
    ShaderStore.ShadersStore = new Proxy(store, {
        get(t, k) {
            const v = t[k as string];
            if (typeof k !== "string" || typeof v !== "string" || !(k.endsWith("FragmentShader") || k === "skyPixelShader")) return v;
            let w = cache.get(v);
            if (w === undefined) { w = wrap(v); cache.set(v, w); }
            return w;
        },
    });
}
