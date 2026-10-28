// Downloads the third-party assets used by the app into public/assets so the
// app can be served fully offline (otherwise they stream from GitHub at runtime).
//
//  - Sponza (Crytek, PBR textures by Alexandre Pestana) from the Khronos glTF Sample Assets repo
//  - "San Giuseppe Bridge" prefiltered HDR environment from the BabylonJS Assets repo
//  - "Forest Slope" HDRI (Poly Haven, CC0) via pmndrs/drei-assets, and Babylon's water bump map
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
const SPONZA = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Sponza/glTF/";
const ENV = "https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/sanGiuseppeBridge.env";

async function exists(p) {
    try {
        await access(p);
        return true;
    } catch {
        return false;
    }
}

async function download(url, dest) {
    if (await exists(dest)) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log("  ✓", dest.replace(root, "assets"));
}

async function main() {
    console.log("Fetching Sponza…");
    const gltfPath = join(root, "sponza", "Sponza.gltf");
    await download(SPONZA + "Sponza.gltf", gltfPath);
    const gltf = JSON.parse(await (await import("node:fs/promises")).readFile(gltfPath, "utf8"));
    const uris = [...gltf.buffers.map((b) => b.uri), ...gltf.images.map((i) => i.uri)];
    // Download in small parallel batches.
    for (let i = 0; i < uris.length; i += 8) {
        await Promise.all(uris.slice(i, i + 8).map((u) => download(SPONZA + u, join(root, "sponza", u))));
    }
    console.log("Fetching environment…");
    await download(ENV, join(root, "env", "sanGiuseppeBridge.env"));
    console.log("Fetching forest assets…");
    await download("https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/forest_slope_1k.hdr", join(root, "env", "forest_slope_1k.hdr"));
    await download("https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/waterbump.png", join(root, "forest", "waterbump.png"));
    console.log("Fetching island textures…");
    for (const f of ["sand.jpg", "rockyGround_basecolor.png", "rockyGround_normal.png"]) {
        await download(`https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/${f}`, join(root, "island", f));
    }
    console.log("Done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
