import type { TransformNode } from "@babylonjs/core";

/** Things that disturb water when they touch it (VR hands, fingertips, controllers). */
export const waterProbes = new Set<{ node: TransformNode; radius: number }>();
