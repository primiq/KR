import { CubeMapToSphericalPolynomialTools, HDRFiltering, Mesh, MeshBuilder, ReflectionProbe, RenderTargetTexture, type Scene, Vector3 } from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials";
import type { Quality } from "../environment";

/**
 * Physically based atmospheric sky (Rayleigh/Mie scattering) that also lights the scene:
 * the sky is rendered once into an HDR cube map, its diffuse irradiance is projected to
 * spherical harmonics and its specular mips are GGX-prefiltered, so PBR materials and the
 * ocean reflect exactly the sky you see.
 */
export async function createSky(scene: Scene, sunDirection: Vector3, quality: Quality): Promise<{ skybox: Mesh; env: RenderTargetTexture }> {
    const sky = new SkyMaterial("sky", scene);
    sky.backFaceCulling = false;
    sky.useSunPosition = true;
    sky.sunPosition = sunDirection.normalizeToNew().scaleInPlace(-100);
    sky.turbidity = 5;
    sky.rayleigh = 3;
    sky.mieCoefficient = 0.005;
    sky.mieDirectionalG = 0.85;
    // With raw HDR output, luminance is a linear radiance scale; calibrated against the sun light (6.5).
    sky.luminance = 0.12;
    sky.fogEnabled = false;
    // Physical radiance into our HDR pipeline (tone mapping happens once, at the end).
    sky.rawHdrOutput = true;

    const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000, sideOrientation: Mesh.BACKSIDE }, scene);
    skybox.material = sky;
    skybox.infiniteDistance = true;
    skybox.isPickable = false;
    skybox.applyFog = false;

    const probe = new ReflectionProbe("skyProbe", quality === "mobile" ? 128 : 256, scene, true, true, true);
    probe.renderList!.push(skybox);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    const cube = probe.cubeTexture;

    await sky.forceCompilationAsync(skybox);
    cube.render();
    cube.sphericalPolynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(cube);
    await new HDRFiltering(scene.getEngine()).prefilter(cube);
    scene.environmentTexture = cube;
    return { skybox, env: cube };
}
