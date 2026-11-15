import { defineConfig } from "vitest/config";

// Unit tests for the pure parts of the game (no browser): npm test
export default defineConfig({
    define: { __CASTAWAY_VERSION__: JSON.stringify("v1.0 · test") },
    test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
