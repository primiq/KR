import type { Material } from "@babylonjs/core";
import type * as THREE from "three";
import type { GatherKind } from "./items";

export type NodeKind = "palm" | "tree" | "stone" | "ore" | "berry";

/** One harvestable thing in the world (a tree, boulder, ore rock or berry bush). */
export interface ResNode {
    kind: NodeKind;
    name: string;
    gather: GatherKind | "berries";
    x: number; y: number; z: number;
    /** hit-sphere radius and the heights (above ground) of the spheres along the object */
    r: number;
    offs: number[];
    total: number;
    left: number;
    depleted: boolean;
    respawnAt: number;
    respawnTime: number;
    pool?: number;
    /** swaps instance matrices (and collision) between the full and the depleted look */
    setDepleted: (depleted: boolean) => void;
    /** hit reaction: tilt `ang` radians about the (ax,0,az) axis and scale by k, both about the footing */
    pose?: (ang: number, ax: number, az: number, k: number) => void;
    /** trees only: what to animate when felled */
    fall?: { geo: THREE.BufferGeometry; mat: Material; base: THREE.Matrix4 };
}
