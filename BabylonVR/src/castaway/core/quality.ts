import { isProbablyHeadset } from "../../config";
import type { Quality as Tier } from "../../environment";

/** Graphics budget. Gameplay (node counts, seeds, rules) never depends on it, so every player shares one world. */
export interface Quality {
    name: "high" | "medium" | "low";
    /** the playground's tier names, for the shared ocean / sky code */
    tier: Tier;
    shadows: boolean;
    /** terrain grid cells along each side of the 760 m map */
    terrainSegments: number;
    bushes: number;
    grass: number;
    /** draw distance for trees, rocks and bushes */
    treeCull: number;
    palmDetail: number;
    /** frame-buffer scale (1 = native; more than 1 renders fewer pixels and stretches them: blurry) */
    scale: number;
    /** the sea mirrors the island; bloom round bright things; ambient occlusion in the corners */
    reflect: boolean;
    bloom: boolean;
    ao: boolean;
    /** how far and how thick the grass is (its own tier) */
    grassTier: "high" | "medium" | "low";
}

/** the graphics menu's own choices, over the preset (each one left out follows the preset) */
export interface GfxCustom { shadows?: boolean; reflect?: boolean; bloom?: boolean; ao?: boolean; res?: number; grass?: "high" | "medium" | "low" }

export function isTouchDevice(): boolean {
    return "ontouchstart" in window && navigator.maxTouchPoints > 0 && !isProbablyHeadset();
}

export function pickQuality(pref = "auto", custom: GfxCustom = {}): Quality {
    const headset = isProbablyHeadset();
    // (a standalone headset is a phone-class GPU drawing two eyes at a high frame rate: low)
    let name: Quality["name"] = pref === "low" || pref === "medium" || pref === "high" ? pref : headset || isTouchDevice() ? "low" : "high";
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "low" || q === "medium" || q === "high") name = q;
    const base: Quality = name === "high"
        ? { name, tier: "high", shadows: true, terrainSegments: 384, bushes: 1400, grass: 9000, treeCull: 260, palmDetail: 1, scale: 1, reflect: true, bloom: true, ao: true, grassTier: "high" }
        : name === "medium"
            ? { name, tier: "medium", shadows: true, terrainSegments: 256, bushes: 900, grass: 4500, treeCull: 170, palmDetail: 0.7, scale: 1, reflect: true, bloom: true, ao: false, grassTier: "medium" }
            : { name, tier: "mobile", shadows: false, terrainSegments: 192, bushes: 500, grass: 1800, treeCull: 120, palmDetail: 0.5, scale: 1, reflect: false, bloom: false, ao: false, grassTier: "low" };
    if (custom.shadows !== undefined) base.shadows = custom.shadows;
    if (custom.reflect !== undefined) base.reflect = custom.reflect;
    if (custom.bloom !== undefined) base.bloom = custom.bloom;
    if (custom.ao !== undefined) base.ao = custom.ao;
    if (custom.grass) base.grassTier = custom.grass;
    if (custom.res) base.scale = 1 / Math.max(0.5, Math.min(1, custom.res));
    return base;
}
