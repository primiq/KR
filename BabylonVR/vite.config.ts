import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";

// `npm run dev:https` serves over self-signed HTTPS on the LAN, which WebXR
// requires when the headset is not on localhost.
export default defineConfig(({ mode }) => ({
    base: "./",
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
