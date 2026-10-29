import { Color3, type Material, MirrorTexture, Plane, type Scene, StandardMaterial } from "@babylonjs/core";

let MAT: StandardMaterial | null = null;

/**
 * The secret room's mirror (Castaway draws the room a second time from the reflected eye; here it is a Babylon
 * MirrorTexture). It reflects what is in and around the room: the walls, the doors, and the other players.
 */
export function skyMirrorMaterial(scene: Scene): Material {
    if (MAT) return MAT;
    const m = new StandardMaterial("skyMirror", scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.08, 0.1, 0.11);
    const mt = new MirrorTexture("skyMirrorTex", { ratio: 0.5 }, scene, true);
    // the plane of the east wall's inner face, facing into the room (-x)
    mt.mirrorPlane = new Plane(1, 0, 0, -(4 - 0.075));
    // (only the room and the people in it: drawing the island again for a mirror would be far too slow)
    mt.renderListPredicate = (mesh) => mesh.isEnabled() && mesh.material !== m && (mesh.metadata?.skyroom === true || mesh.metadata?.avatar === true);
    mt.refreshRate = 2;
    mt.level = 0.92;
    m.reflectionTexture = mt;
    MAT = m;
    return m;
}
