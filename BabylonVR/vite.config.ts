import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// the game's version, shown on the main menu: 1.<number of commits>, the day and the commit, so every new build is easy
// to spot. Hosted builds (Cloudflare's) clone only the last commit, where a count means nothing: there the build's own
// date and time and the commit tell one build from the next. (No fetching of the history during a build: the repository
// is large, and that made deploys slow or fail.)
const version = (() => {
    const cwd = fileURLToPath(new URL(".", import.meta.url));
    const git = (c: string) => execSync(`git ${c}`, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim();
    try {
        const sha = (process.env.WORKERS_CI_COMMIT_SHA || git("rev-parse HEAD")).slice(0, 7);
        if (git("rev-parse --is-shallow-repository") !== "true") return `v1.${git("rev-list --count HEAD")} · ${git("log -1 --format=%cs")} · ${sha}`;
        const now = new Date().toISOString();
        return `v1 · ${now.slice(0, 10)} ${now.slice(11, 16)} · ${sha}`;
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
