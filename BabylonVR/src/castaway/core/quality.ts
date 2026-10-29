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
    /** frame-buffer scale (1 = native) */
    scale: number;
}

export function isTouchDevice(): boolean {
    return "ontouchstart" in window && navigator.maxTouchPoints > 0 && !isProbablyHeadset();
}

export function pickQuality(pref = "auto"): Quality {
    const headset = isProbablyHeadset();
    let name: Quality["name"] = pref === "low" || pref === "medium" || pref === "high" ? pref : headset ? "medium" : isTouchDevice() ? "low" : "high";
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "low" || q === "medium" || q === "high") name = q;
    if (name === "high") return { name, tier: "high", shadows: true, terrainSegments: 384, bushes: 1400, grass: 9000, treeCull: 260, palmDetail: 1, scale: 1 };
    if (name === "medium") return { name, tier: "medium", shadows: true, terrainSegments: 256, bushes: 900, grass: 4500, treeCull: 170, palmDetail: 0.7, scale: 1 };
    return { name, tier: "mobile", shadows: false, terrainSegments: 192, bushes: 500, grass: 1800, treeCull: 120, palmDetail: 0.5, scale: 1.5 };
}
