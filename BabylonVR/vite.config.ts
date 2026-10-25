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
    optimizeDeps: { exclude: ["@babylonjs/havok"] },
    // Keep bundled code apart from public/assets (Sponza + HDR fetched by `npm run fetch-assets`).
    build: { target: "es2022", assetsDir: "bundle", chunkSizeWarningLimit: 8000 },
}));
