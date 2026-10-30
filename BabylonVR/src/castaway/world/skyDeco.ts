// What hangs in Castaway's sky besides the scattering itself: drifting clouds lit by the sun (and the moon), the night dome
// with the Milky Way, real constellations among a few thousand twinkling stars that wheel round the pole through the night,
// and a glowing moon with maria and craters. All of it is drawn round the camera (infinite distance), in front of the
// scattering sky and behind everything else, so the sea's reflection picks it up too.
import { type Color3, Constants, Effect, Matrix, Mesh, MeshBuilder, type Scene, ShaderMaterial, Vector2, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { NOISE_GLSL } from "../render/materials";

const R = 450;               // the sky shell: inside the 1000 m sky box (whose faces are 500 m away), so it is not hidden behind it
const LAT = (14 * Math.PI) / 180; // a tropical island: the pole stands 14 degrees up in the north

// [right ascension (deg), declination (deg), magnitude, colour index: 0 blue-white .. 1 white .. 2 yellow .. 3 orange .. 4 red]
const BRIGHT: [number, number, number, number][] = [
    // Orion
    [88.8, 7.4, 0.5, 4], [78.6, -8.2, 0.1, 0], [81.3, 6.3, 1.6, 0], [86.9, -9.7, 2.1, 0], [85.2, -1.9, 1.8, 0], [84.1, -1.2, 1.7, 0], [83.0, -0.3, 2.2, 0], [83.8, 9.9, 3.4, 0],
    // the Plough
    [165.9, 61.8, 1.8, 3], [165.5, 56.4, 2.4, 1], [178.5, 53.7, 2.4, 1], [183.9, 57.0, 3.3, 1], [193.5, 56.0, 1.8, 1], [201.0, 54.9, 2.2, 1], [206.9, 49.3, 1.9, 0],
    // Cassiopeia
    [10.1, 56.5, 2.2, 3], [2.3, 59.1, 2.3, 1], [14.2, 60.7, 2.2, 0], [21.5, 60.2, 2.7, 1], [28.6, 63.7, 3.4, 0],
    // the Southern Cross and the Pointers
    [186.6, -63.1, 0.8, 0], [191.9, -59.7, 1.3, 0], [187.8, -57.1, 1.6, 4], [183.8, -58.7, 2.8, 0], [219.9, -60.8, -0.3, 2], [211.0, -60.4, 0.6, 0],
    // Scorpius
    [247.4, -26.4, 1.0, 4], [240.1, -22.6, 2.3, 0], [241.4, -19.8, 2.6, 0], [245.3, -25.6, 2.9, 0], [252.5, -34.3, 2.3, 2], [253.1, -38.0, 3.0, 0],
    [258.0, -43.2, 3.3, 0], [264.3, -43.0, 1.9, 1], [266.9, -40.1, 2.4, 0], [263.4, -37.1, 1.6, 0], [262.7, -37.3, 2.7, 0],
    // the Summer Triangle, the Swan's neck
    [279.2, 38.8, 0.0, 0], [310.4, 45.3, 1.3, 0], [297.7, 8.9, 0.8, 1], [305.6, 40.3, 2.2, 2], [292.7, 27.9, 3.1, 3], [311.6, 33.97, 2.5, 3],
    // the Pleiades
    [56.75, 24.1, 2.9, 0], [56.2, 24.1, 3.7, 0], [56.5, 24.4, 3.9, 0], [56.9, 23.9, 4.2, 0], [57.3, 24.05, 3.6, 0], [56.3, 24.5, 4.3, 0], [55.7, 24.4, 4.3, 0],
    // the brightest of the rest
    [101.3, -16.7, -1.5, 0], [114.8, 5.2, 0.4, 1], [69.0, 16.5, 0.9, 3], [37.95, 89.3, 2.0, 2], [213.9, 19.2, -0.05, 3], [79.2, 46.0, 0.1, 2],
    [96.0, -52.7, -0.7, 1], [201.3, -11.2, 1.0, 0], [116.3, 28.0, 1.1, 3], [113.6, 31.9, 1.6, 1], [152.1, 12.0, 1.4, 0], [344.4, -29.6, 1.2, 0],
    [24.4, -57.2, 0.5, 0], [104.7, -28.97, 1.5, 0], [139.3, -59.3, 1.7, 1], [125.6, -59.5, 1.9, 4],
];
const TINT = [[0.72, 0.82, 1.0], [0.95, 0.96, 1.0], [1.0, 0.95, 0.82], [1.0, 0.78, 0.55], [1.0, 0.55, 0.42]];

/** a unit direction for (right ascension, declination), in the sky's own frame (y towards the celestial pole) */
function eq(ra: number, dec: number): [number, number, number] {
    const a = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180;
    return [Math.cos(d) * Math.cos(a), Math.sin(d), Math.cos(d) * Math.sin(a)];
}

Effect.ShadersStore["skyDomeVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = viewProjection * (world * vec4(position, 1.0)); }`;

// the haze along the horizon: the colour the far sea and the fog fade into, rising a few degrees up the sky, so there is no
// seam where the sea ends. Drawn at the far plane: it only shows where nothing nearer was drawn (never over the island)
Effect.ShadersStore["skyHorizonVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = viewProjection * (world * vec4(position, 1.0)); gl_Position.z = gl_Position.w; }`;
Effect.ShadersStore["skyHorizonFragmentShader"] = `
precision highp float;
uniform vec3 hzAway;
uniform vec3 hzSun;
uniform vec2 sunXZ;
varying vec3 vDir;
void main() {
    vec3 d = normalize(vDir);
    float a = 1.0 - smoothstep(-0.01, 0.1, d.y);
    float ts = pow(max(dot(normalize(d.xz + vec2(1e-5)), sunXZ), 0.0), 2.0);
    gl_FragColor = vec4(mix(hzAway, hzSun, ts), a * a * (3.0 - 2.0 * a));
}`;

// the night: a deep navy gradient and the Milky Way (its band follows the galactic plane, turned with the stars)
Effect.ShadersStore["skyNightFragmentShader"] = `
precision highp float;
uniform float night;
uniform mat4 skyRot;
varying vec3 vDir;
${NOISE_GLSL}
void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(vec3(0.020, 0.045, 0.11), vec3(0.002, 0.006, 0.022), pow(up, 0.55));
    // the galactic plane: the galactic pole is at RA 192.9, Dec 27.1
    vec3 gp = normalize((skyRot * vec4(-0.8676, 0.4559, -0.1981, 0.0)).xyz);
    vec3 gc = normalize((skyRot * vec4(-0.0548, -0.4838, -0.8734, 0.0)).xyz);  // towards the galactic centre (Sagittarius)
    float b = dot(d, gp);
    float n = cNoise(d * 6.0) * 0.5 + 0.5, n2 = cNoise(d * 17.0 + 3.1) * 0.5 + 0.5;
    float band = exp(-b * b / 0.018) * (0.55 + 0.45 * n) * (0.75 + 0.25 * n2);
    float bulge = pow(max(dot(d, gc), 0.0), 3.0);
    // a dark rift down the middle, brighter towards the centre
    float rift = 1.0 - 0.7 * exp(-pow((b - 0.02 * (n - 0.5)) / 0.035, 2.0)) * smoothstep(0.3, 0.9, n2);
    col += vec3(0.19, 0.2, 0.27) * band * rift * (0.6 + 1.4 * bulge);
    col *= smoothstep(-0.06, 0.12, d.y);
    gl_FragColor = vec4(col, night * smoothstep(-0.05, 0.05, d.y));
}`;

// clouds: rolling masses drifting with the wind, lit from the sun's side, warm at sunset, silver under the moon
Effect.ShadersStore["skyCloudsFragmentShader"] = `
precision highp float;
uniform float time;
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float day;
uniform float low;
uniform float moonUp;
uniform float cover;
uniform vec2 wind;
varying vec3 vDir;
${NOISE_GLSL}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < OCTAVES; i++) { s += a * (cNoise(p) * 0.5 + 0.5); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
void main() {
    vec3 d = normalize(vDir);
    if (d.y < 0.0) discard;
    // a flat cloud deck seen from below: the pattern stretches towards the horizon as it would
    vec2 p = d.xz / (d.y + 0.12) * 1.15 + wind * time;
    float t = time * 0.012;
    float n = fbm(vec3(p * 0.95, t));
    // fine detail eats into the edges (cauliflower tops, wispy fringes)
    float det = cNoise(vec3(p * 6.5, t * 2.0)) * 0.5 + 0.5;
    n -= (det - 0.5) * 0.09 * (1.0 - smoothstep(cover, cover + 0.3, n));
    float shape = smoothstep(cover, cover + 0.11, n);
    if (shape < 0.003) discard;
    // self-shadow: how much more cloud lies a little towards the light
    vec3 L = day > 0.02 ? sunDir : moonDir;
#ifdef LITE
    float nl = n - 0.04;
#else
    vec2 lp = p + normalize(L.xz + 1e-4) * 0.09;
    float nl = fbm(vec3(lp * 0.95, t));
#endif
    float lit = clamp(1.0 - (nl - n) * 3.2, 0.25, 1.15);
    float thick = smoothstep(cover, cover + 0.3, n);
    // towards the sun the edges glow (forward scattering)
    float toward = pow(max(dot(d, L), 0.0), 6.0);
    vec3 sunCol = mix(vec3(1.0, 0.98, 0.95), vec3(1.0, 0.55, 0.3), low);
    vec3 dayCol = sunCol * (lit * 1.25 + toward * (1.0 - thick) * 1.6) * mix(1.0, 0.72, thick);
    vec3 shade = mix(vec3(0.55, 0.62, 0.74), vec3(0.42, 0.3, 0.38), low);
    dayCol = mix(shade * 0.9, dayCol, lit * 0.85 + 0.15);
    vec3 nightCol = vec3(0.05, 0.065, 0.1) * (0.6 + 0.8 * lit * moonUp) + vec3(0.25, 0.3, 0.42) * toward * moonUp * (1.0 - thick) * 0.6;
    vec3 col = mix(nightCol, dayCol * 2.4, day);
    float fade = smoothstep(0.015, 0.22, d.y);
    gl_FragColor = vec4(col, shape * fade * mix(0.75, 0.95, thick));
}`;

// stars: camera-facing quads round the sky, each with its own colour, size and twinkle; turned round the pole with the hour
Effect.ShadersStore["skyStarsVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec4 star;        // corner x, corner y, size, twinkle phase
attribute vec4 tint;        // rgb, brightness
uniform mat4 viewProjection;
uniform mat4 skyRot;
uniform vec3 cameraPos;
uniform vec3 camRight;
uniform vec3 camUp;
uniform float time;
varying vec2 vUV;
varying vec4 vTint;
void main() {
    vec3 dir = normalize((skyRot * vec4(position, 0.0)).xyz);
    float tw = 0.72 + 0.28 * sin(time * (2.0 + fract(star.w * 7.3) * 4.0) + star.w * 40.0) * (0.6 + 0.4 * sin(time * 0.7 + star.w * 13.0));
    // low stars twinkle more and dim in the thicker air
    float alt = dir.y;
    tw = mix(tw, 1.0, smoothstep(0.0, 0.6, alt) * 0.4);
    vTint = vec4(tint.rgb, tint.a * tw * smoothstep(-0.02, 0.12, alt));
    vUV = star.xy;
    vec3 c = cameraPos + dir * ${R.toFixed(1)};
    vec3 p = c + (camRight * star.x + camUp * star.y) * star.z;
    gl_Position = viewProjection * vec4(p, 1.0);
}`;
Effect.ShadersStore["skyStarsFragmentShader"] = `
precision highp float;
uniform float night;
varying vec2 vUV;
varying vec4 vTint;
void main() {
    float r = length(vUV);
    float core = exp(-r * r * 18.0), glow = exp(-r * r * 4.0) * 0.35;
    float a = (core + glow) * vTint.a * night;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vTint.rgb * a * 6.0, a);
}`;

// the moon: a billboard with maria, a few craters, a darker limb and a soft halo
Effect.ShadersStore["skyMoonVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 cameraPos;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 moonDir;
varying vec2 vUV;
void main() {
    vUV = uv * 2.0 - 1.0;
    vec3 c = cameraPos + moonDir * ${(R - 20).toFixed(1)};
    vec3 p = c + (camRight * position.x + camUp * position.y) * 120.0;
    gl_Position = viewProjection * vec4(p, 1.0);
}`;
Effect.ShadersStore["skyMoonFragmentShader"] = `
precision highp float;
uniform float moonVis;
uniform float day;
varying vec2 vUV;
${NOISE_GLSL}
void main() {
    vec2 p = vUV;
    float r = length(p);
    const float Rm = 0.24;
    float disc = 1.0 - smoothstep(Rm - 0.008, Rm, r);
    vec2 q = p / Rm;
    // maria: broad dark seas; craters: small rings
    float n = cNoise(vec3(q * 2.2, 3.0)) * 0.5 + 0.5, n2 = cNoise(vec3(q * 5.5, 9.0)) * 0.5 + 0.5;
    float maria = smoothstep(0.48, 0.66, n * 0.75 + n2 * 0.35) * 0.42;
    float craters = 0.0;
    for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = vec2(cHash(vec3(fi, 1.0, 2.0)), cHash(vec3(fi, 5.0, 7.0))) * 1.5 - 0.75;
        float cr = 0.07 + 0.1 * cHash(vec3(fi, 3.0, 1.0));
        float dd = length(q - c);
        craters += (smoothstep(cr, cr * 0.75, dd) * 0.18 - smoothstep(cr * 1.2, cr, dd) * smoothstep(cr, cr * 1.05, dd) * 0.12);
    }
    float zr = sqrt(max(0.0, 1.0 - dot(q, q)));
    float limb = 0.55 + 0.45 * pow(zr, 0.6);
    vec3 surf = vec3(0.95, 0.96, 1.0) * (1.0 - maria - craters) * limb * (0.85 + 0.15 * n2);
    float halo = pow(max(1.0 - r, 0.0), 4.0) * 0.55 + pow(max(1.0 - r / 0.5, 0.0), 2.0) * 0.35;
    vec3 col = surf * disc * 2.6 + vec3(0.45, 0.58, 1.0) * halo * (1.0 - disc) * mix(1.0, 0.15, day);
    float a = clamp(disc + halo, 0.0, 1.0) * moonVis;
    if (a < 0.002) discard;
    gl_FragColor = vec4(col * moonVis, a);
}`;

// the sun: a round, camera-facing disc where the scattering sky has its sun, white-hot by day, swollen and red at the horizon
Effect.ShadersStore["skySunVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 cameraPos;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float size;
varying vec2 vUV;
void main() {
    vUV = uv * 2.0 - 1.0;
    vec3 c = cameraPos + sunDir * ${(R - 30).toFixed(1)};
    vec3 p = c + (camRight * position.x + camUp * position.y) * size;
    gl_Position = viewProjection * vec4(p, 1.0);
}`;
Effect.ShadersStore["skySunFragmentShader"] = `
precision highp float;
uniform vec3 sunCol;
uniform float sunVis;
varying vec2 vUV;
void main() {
    float r = length(vUV);
    const float Rs = 0.16;
    float disc = 1.0 - smoothstep(Rs - 0.015, Rs, r);
    float limb = 0.8 + 0.2 * sqrt(max(0.0, 1.0 - (r * r) / (Rs * Rs)));
    float glow = pow(max(1.0 - r, 0.0), 5.0) * 0.6;
    // (bright enough to bloom softly; much brighter and the bloom's blur turns it into a square)
    vec3 col = sunCol * (disc * limb * 5.0 + glow * 1.2);
    float a = clamp(disc + glow, 0.0, 1.0) * sunVis;
    if (a < 0.002) discard;
    gl_FragColor = vec4(col * sunVis, a);
}`;

export class SkyDeco {
    private night: Mesh;
    private nightMat: ShaderMaterial;
    private clouds: Mesh;
    private cloudMat: ShaderMaterial;
    private stars: Mesh;
    private starMat: ShaderMaterial;
    private moon: Mesh;
    private moonMat: ShaderMaterial;
    private horizon: Mesh;
    private horizonMat: ShaderMaterial;
    private sun: Mesh;
    private sunMat: ShaderMaterial;
    private time = 0;
    private skyRot = Matrix.Identity();
    private right = new Vector3();
    private up = new Vector3();
    /** fair-weather cloud cover: 0.62 a few puffs .. 0.4 a lot (the storm dome covers the rest) */
    cover = 0.56;

    /** `lite`: low quality and headsets: fewer noise octaves and no self-shadowing in the clouds (they fill the sky, per pixel) */
    constructor(private readonly scene: Scene, lite = false) {
        const shell = (name: string, frag: string, uniforms: string[], alphaIndex: number, vert = "skyDome") => {
            const m = MeshBuilder.CreateSphere(name, { diameter: R * 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
            const mat = new ShaderMaterial(`${name}Mat`, scene, { vertex: vert, fragment: frag }, { attributes: [VertexBuffer.PositionKind], uniforms: ["world", "viewProjection", ...uniforms], needAlphaBlending: true, defines: lite ? ["#define LITE", "#define OCTAVES 3"] : ["#define OCTAVES 5"] });
            mat.backFaceCulling = false;
            mat.disableDepthWrite = true;
            m.material = mat; m.infiniteDistance = true; m.isPickable = false; m.applyFog = false; m.alphaIndex = alphaIndex;
            m.alwaysSelectAsActiveMesh = true;
            return { m, mat };
        };
        ({ m: this.night, mat: this.nightMat } = shell("skyNight", "skyNight", ["night", "skyRot"], 0));
        // (after the night sky and the stars, before the sun and the moon: they still set into the haze, not behind it)
        ({ m: this.horizon, mat: this.horizonMat } = shell("skyHorizon", "skyHorizon", ["hzAway", "hzSun", "sunXZ"], 1.5, "skyHorizon"));
        ({ m: this.clouds, mat: this.cloudMat } = shell("skyClouds", "skyClouds", ["time", "sunDir", "moonDir", "day", "low", "moonUp", "cover", "wind"], 3));

        // ---- stars: the constellations, then a few thousand fainter ones crowding towards the Milky Way
        const pos: number[] = [], star: number[] = [], tint: number[] = [], idx: number[] = [];
        let seed = 11;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const add = (d: [number, number, number], size: number, col: number[], bright: number) => {
            const b = pos.length / 3, ph = rnd();
            for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(d[0], d[1], d[2]); star.push(cx, cy, size, ph); tint.push(col[0], col[1], col[2], bright); }
            idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        };
        for (const [ra, dec, mag, ci] of BRIGHT) {
            const k = Math.pow(2.512, -mag);   // relative flux
            add(eq(ra, dec), 1.6 + 1.8 * Math.min(1.6, Math.sqrt(k)), TINT[ci], Math.min(1.8, 0.6 + 0.65 * Math.sqrt(k)));
        }
        const gp = new Vector3(...eq(192.86, 27.13));
        for (let i = 0; i < 6000; i++) {
            let d: [number, number, number];
            // half the faint stars lie near the galactic plane
            for (;;) {
                const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
                d = [Math.cos(t) * r, u, Math.sin(t) * r];
                const b = Math.abs(d[0] * gp.x + d[1] * gp.y + d[2] * gp.z);
                if (i % 2 === 0 || rnd() < Math.exp(-b * b / 0.04)) break;
            }
            const m = rnd();
            const ci = m < 0.25 ? 0 : m < 0.7 ? 1 : m < 0.88 ? 2 : m < 0.97 ? 3 : 4;
            const f = Math.pow(rnd(), 2.6);
            add(d, 0.75 + 1.0 * f, TINT[ci], 0.22 + 0.6 * f);
        }
        this.stars = new Mesh("skyStars", scene);
        const vd = new VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(this.stars);
        this.stars.setVerticesData("star", star, false, 4);
        this.stars.setVerticesData("tint", tint, false, 4);
        this.starMat = new ShaderMaterial("skyStarsMat", scene, { vertex: "skyStars", fragment: "skyStars" }, {
            attributes: [VertexBuffer.PositionKind, "star", "tint"], uniforms: ["viewProjection", "skyRot", "cameraPos", "camRight", "camUp", "time", "night"], needAlphaBlending: true,
        });
        this.starMat.alphaMode = Constants.ALPHA_ADD;
        this.starMat.disableDepthWrite = true;
        this.starMat.backFaceCulling = false;
        this.stars.material = this.starMat;
        this.stars.alwaysSelectAsActiveMesh = true; this.stars.isPickable = false; this.stars.applyFog = false; this.stars.alphaIndex = 1;

        // ---- the moon
        this.moon = MeshBuilder.CreatePlane("skyMoon", { size: 2 }, scene);
        this.moonMat = new ShaderMaterial("skyMoonMat", scene, { vertex: "skyMoon", fragment: "skyMoon" }, {
            attributes: [VertexBuffer.PositionKind, VertexBuffer.UVKind], uniforms: ["viewProjection", "cameraPos", "camRight", "camUp", "moonDir", "moonVis", "day"], needAlphaBlending: true,
        });
        this.moonMat.alphaMode = Constants.ALPHA_ADD;
        this.moonMat.disableDepthWrite = true;
        this.moonMat.backFaceCulling = false;
        this.moon.material = this.moonMat;
        this.moon.alwaysSelectAsActiveMesh = true; this.moon.isPickable = false; this.moon.applyFog = false; this.moon.alphaIndex = 2;

        // ---- the sun
        this.sun = MeshBuilder.CreatePlane("skySun", { size: 2 }, scene);
        this.sunMat = new ShaderMaterial("skySunMat", scene, { vertex: "skySun", fragment: "skySun" }, {
            attributes: [VertexBuffer.PositionKind, VertexBuffer.UVKind], uniforms: ["viewProjection", "cameraPos", "camRight", "camUp", "sunDir", "size", "sunCol", "sunVis"], needAlphaBlending: true,
        });
        this.sunMat.alphaMode = Constants.ALPHA_ADD;
        this.sunMat.disableDepthWrite = true;
        this.sunMat.backFaceCulling = false;
        this.sun.material = this.sunMat;
        this.sun.alwaysSelectAsActiveMesh = true; this.sun.isPickable = false; this.sun.applyFog = false; this.sun.alphaIndex = 2;

        scene.onBeforeRenderObservable.add(() => this.bindCamera());
    }

    /** the meshes (for the sea's reflection) */
    get meshes() { return [this.night, this.stars, this.moon, this.sun, this.clouds, this.horizon]; }

    private bindCamera() {
        const cam = this.scene.activeCamera; if (!cam) return;
        const v = cam.getViewMatrix().m;
        // camera right and up in world space (the rows of the view matrix's rotation)
        this.right.set(v[0], v[4], v[8]);
        this.up.set(v[1], v[5], v[9]);
        const p = cam.globalPosition;
        for (const m of [this.starMat, this.moonMat, this.sunMat]) { m.setVector3("cameraPos", p); m.setVector3("camRight", this.right); m.setVector3("camUp", this.up); }
    }

    /**
     * Once a frame. `hour` turns the stars; `sunDir` points at the sun; `day` 0..1; `low` how close to the horizon the sun is
     * (sunset colours); `overcast` dims everything behind the storm dome.
     */
    /** the horizon haze: its colour looking away from the sun and towards it */
    setHorizon(away: Color3, toSun: Color3, sunDir: Vector3) {
        this.horizonMat.setColor3("hzAway", away);
        this.horizonMat.setColor3("hzSun", toSun);
        const l = Math.hypot(sunDir.x, sunDir.z) || 1;
        this.horizonMat.setVector2("sunXZ", new Vector2(sunDir.x / l, sunDir.z / l));
    }

    update(dt: number, hour: number, sunDir: Vector3, day: number, low: number, overcast: number) {
        this.time += dt;
        const night = (1 - Math.min(1, Math.max(0, (sunDir.y + 0.2) / 0.25))) * (1 - overcast);
        // the sky turns once a day round the celestial pole, which stands LAT above the northern horizon
        const turn = Matrix.RotationY(-(hour / 24) * Math.PI * 2 + 1.2);
        const tilt = Matrix.RotationX(-(Math.PI / 2 - LAT));
        turn.multiplyToRef(tilt, this.skyRot);
        const moonDir = sunDir.scale(-1);
        const moonUp = Math.min(1, Math.max(0, (moonDir.y + 0.04) / 0.2));
        this.nightMat.setFloat("night", night * 0.95);
        this.nightMat.setMatrix("skyRot", this.skyRot);
        this.night.setEnabled(night > 0.005);
        this.starMat.setFloat("night", night);
        this.starMat.setMatrix("skyRot", this.skyRot);
        this.starMat.setFloat("time", this.time);
        this.stars.setEnabled(night > 0.005);
        this.moonMat.setVector3("moonDir", moonDir);
        this.moonMat.setFloat("moonVis", moonUp * (1 - overcast) * (0.35 + 0.65 * (1 - day)));
        this.moonMat.setFloat("day", day);
        this.moon.setEnabled(moonUp > 0.01 && overcast < 0.98);
        // the sun: bigger and redder near the horizon, gone below it and behind a storm
        const sy = sunDir.y, warm = Math.min(1, Math.max(0, 1 - (sy - 0.02) / 0.3));
        this.sunMat.setVector3("sunDir", sunDir);
        this.sunMat.setFloat("size", 85 * (1 + 0.25 * warm));
        this.sunMat.setColor3("sunCol", { r: 1.0, g: 0.93 - 0.55 * warm, b: 0.8 - 0.7 * warm } as never);
        const sunVis = Math.min(1, Math.max(0, (sy + 0.03) / 0.05)) * (1 - overcast);
        // (dimmer low down, so the tone mapping keeps its colour instead of washing it out to white)
        this.sunMat.setFloat("sunVis", sunVis * (1 - 0.55 * warm));
        this.sun.setEnabled(sunVis > 0.005);
        const cm = this.cloudMat;
        cm.setFloat("time", this.time);
        cm.setVector3("sunDir", sunDir);
        cm.setVector3("moonDir", moonDir);
        cm.setFloat("day", day);
        cm.setFloat("low", low);
        cm.setFloat("moonUp", moonUp);
        cm.setFloat("cover", this.cover - overcast * 0.3);
        cm.setVector2("wind", { x: 0.010, y: 0.004 } as never);
    }
}
