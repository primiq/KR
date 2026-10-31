import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// the game's version, shown on the main menu: 1.<number of commits> and the day it was built, so a new build is easy to spot
const version = (() => {
    try {
        const n = execSync("git rev-list --count HEAD", { cwd: fileURLToPath(new URL(".", import.meta.url)) }).toString().trim();
        const d = execSync("git log -1 --format=%cs", { cwd: fileURLToPath(new URL(".", import.meta.url)) }).toString().trim();
        return `v1.${n} · ${d}`;
    } catch { return "v1 · dev"; }
})();

// `npm run dev:https` serves over self-signed HTTPS on the LAN, which WebXR
// requires when the headset is not on localhost.
export default defineConfig(({ mode }) => ({
    base: "./",
    define: { __CASTAWAY_VERSION__: JSON.stringify(version) },
    plugins: mode === "https" ? [basicSsl()] : [],
    // ez-tree's bark/leaf textures, grass, flowers and rocks (MIT package; textures CC0).
    resolve: { alias: { "@eztree": fileURLToPath(new URL("./node_modules/@dgreenheck/ez-tree/src", import.meta.url)) } },
    server: { host: true },
    // Castaway's 3D models (Mario) are bundled like its sound files (imported with ?inline)
    assetsInclude: ["**/*.glb"],
    optimizeDeps: { exclude: ["@babylonjs/havok"] },
    // Keep bundled code apart from public/assets (Sponza + HDR fetched by `npm run fetch-assets`).
    build: {
        target: "es2022",
        assetsDir: "bundle",
        chunkSizeWarningLimit: 8000,
        // Two pages: the Castaway survival game (the main page) and the VR playground.
        rollupOptions: { input: { main: fileURLToPath(new URL("./index.html", import.meta.url)), playground: fileURLToPath(new URL("./playground.html", import.meta.url)) } },
    },
}));
