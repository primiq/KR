import { Color3, Constants, Effect, type Material, type Scene, ShaderMaterial, VertexBuffer } from "@babylonjs/core";
import type * as THREE from "three";
import { rockMaterial } from "../render/materials";

// Castaway's node-material effects for the stone circle, as GLSL: a carved spiral that glows (pink when the sky is cursed),
// and the funnel of pink light wound up over the altar while Mario is summoned.
Effect.ShadersStore["druidGlowVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec2 vUV;
void main() {
    #include<instancesVertex>
    vUV = uv;
    gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
}`;
Effect.ShadersStore["druidRuneFragmentShader"] = `
precision highp float;
uniform vec3 hue;
uniform float glow;
uniform float curse;
uniform float time;
varying vec2 vUV;
void main() {
    vec2 p = (vUV - 0.5) * 2.0;
    float r = length(p), a = atan(p.y, p.x);
    float spiral = smoothstep(0.16, 0.0, abs(fract(r * 2.6 - a / 6.283) - 0.5)) * smoothstep(0.95, 0.75, r) * smoothstep(0.05, 0.15, r);
    float pulse = sin(time * 3.0) * 0.25 + 0.75;
    vec3 c = mix(hue, vec3(1.0, 0.247, 0.682), curse * 0.6) * spiral * glow * pulse * 1.6;
    gl_FragColor = vec4(c * spiral * glow * 0.95, 1.0);
}`;
Effect.ShadersStore["druidVortexFragmentShader"] = `
precision highp float;
uniform float vortex;
uniform float time;
varying vec2 vUV;
void main() {
    float swirl = sin(vUV.x * 6.283 * 5.0 + vUV.y * 14.0 - time * 6.0) * 0.5 + 0.5;
    vec3 c = vec3(1.0, 0.25, 0.7) * (swirl * 0.8 + 0.3);
    float a = vortex * (swirl * 0.6 + 0.2) * smoothstep(0.0, 0.15, vUV.y) * smoothstep(1.0, 0.6, vUV.y);
    gl_FragColor = vec4(c * a, 1.0);
}`;

function glowMaterial(scene: Scene, frag: "druidRune" | "druidVortex", uniforms: string[], bind: (m: ShaderMaterial) => void): ShaderMaterial {
    const m = new ShaderMaterial(frag, scene, { vertex: "druidGlow", fragment: frag }, {
        attributes: [VertexBuffer.PositionKind, VertexBuffer.UVKind],
        uniforms: ["world", "viewProjection", "time", ...uniforms],
        defines: [],
    });
    // additive light, drawn after the opaque world, never writing depth
    m.alphaMode = Constants.ALPHA_ADD;
    m.needAlphaBlending = () => true;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    m.onBindObservable.add(() => { m.setFloat("time", performance.now() / 1000); bind(m); });
    return m;
}

/** the Babylon material for one of the stone circle's three.js stand-ins (or null: the mirror's default) */
export function druidMaterial(scene: Scene, src: THREE.Material): Material | null {
    if (src.name === "druidRock") return rockMaterial(scene, false);
    const u = src.userData as { glow?: { value: number }; hex?: string; curse?: { value: number }; vortex?: { value: number } };
    if (src.name === "rune" && u.glow) {
        const hue = Color3.FromHexString(u.hex ?? "#ffffff");
        return glowMaterial(scene, "druidRune", ["hue", "glow", "curse"], (m) => {
            m.setColor3("hue", hue);
            m.setFloat("glow", u.glow!.value);
            m.setFloat("curse", u.curse?.value ?? 0);
        });
    }
    if (src.name === "vortex" && u.vortex) return glowMaterial(scene, "druidVortex", ["vortex"], (m) => m.setFloat("vortex", u.vortex!.value));
    return null;
}
