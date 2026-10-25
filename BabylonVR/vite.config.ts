import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:https` serves over self-signed HTTPS on the LAN, which WebXR
// requires when the headset is not on localhost.
export default defineConfig(({ mode }) => ({
    base: "./",
    plugins: mode === "https" ? [basicSsl()] : [],
    server: { host: true },
    optimizeDeps: { exclude: ["@babylonjs/havok"] },
    // Keep bundled code apart from public/assets (Sponza + HDR fetched by `npm run fetch-assets`).
    build: { target: "es2022", assetsDir: "bundle", chunkSizeWarningLimit: 8000 },
}));
