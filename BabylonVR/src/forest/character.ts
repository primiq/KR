import {
    type AbstractMesh,
    Color3,
    ImportMeshAsync,
    PBRMaterial,
    PhysicsBody,
    PhysicsMotionType,
    PhysicsShapeCapsule,
    Quaternion,
    type Scene,
    Texture,
    TransformNode,
    Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { ALL_LAYERS, Layer } from "../config";

/** Outfit colour applied to the vest, skirt and bra. */
const OUTFIT_BLUE = new Color3(0.11, 0.35, 0.69).toLinearSpace();

/**
 * Loads the full-resolution woman figure (converted from the supplied 3DS with
 * scripts/3ds2glb.py, ~394k triangles, Draco-compressed), scales it to `height` metres,
 * stands it at `position` facing `facing` (radians about Y), and gives it a capsule collider.
 */
export async function loadCharacter(scene: Scene, position: Vector3, facing: number, height: number, addShadowCaster: (m: AbstractMesh) => void): Promise<TransformNode> {
    const url = new URL("models/woman.glb", document.baseURI).href;
    const result = await ImportMeshAsync(url, scene);
    const root = new TransformNode("woman", scene);
    result.meshes[0].parent = root;

    const meshes = result.meshes.filter((m) => m.getTotalVertices() > 0);
    const { min, max } = result.meshes[0].getHierarchyBoundingVectors(true);
    const scale = height / (max.y - min.y);
    root.scaling.setAll(scale);
    root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), facing);
    root.position.set(position.x, position.y - min.y * scale, position.z);

    for (const mesh of meshes) {
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        addShadowCaster(mesh);
        tuneMaterial(mesh.material as PBRMaterial | null);
    }
    root.computeWorldMatrix(true);
    for (const mesh of meshes) mesh.freezeWorldMatrix();

    // Solid to the player and to thrown props.
    const collider = new TransformNode("womanCollider", scene);
    collider.position.copyFrom(position);
    const body = new PhysicsBody(collider, PhysicsMotionType.STATIC, false, scene);
    const shape = new PhysicsShapeCapsule(new Vector3(0, 0.25, 0), new Vector3(0, height - 0.25, 0), 0.25, scene);
    shape.filterMembershipMask = Layer.STATIC;
    shape.filterCollideMask = ALL_LAYERS;
    body.shape = shape;
    return root;
}

function tuneMaterial(m: PBRMaterial | null): void {
    if (!m) return;
    const name = m.name;
    for (const t of [m.albedoTexture, m.bumpTexture]) if (t instanceof Texture) t.anisotropicFilteringLevel = 16;

    if (name.startsWith("wire") || name.startsWith("tfabric")) {
        // Blue outfit: soft fabric with a velvet-like sheen.
        m.albedoColor = OUTFIT_BLUE;
        m.roughness = 0.75;
        m.sheen.isEnabled = true;
        m.sheen.intensity = 0.6;
        m.sheen.color = new Color3(0.55, 0.75, 1);
        m.sheen.roughness = 0.4;
    } else if (name.startsWith("Skin") || name.startsWith("Nipples") || name.startsWith("Lips")) {
        // Light scattering through skin.
        m.roughness = name.startsWith("Lips") ? 0.35 : 0.55;
        m.subSurface.isTranslucencyEnabled = true;
        m.subSurface.translucencyIntensity = 0.25;
        m.subSurface.tintColor = new Color3(1, 0.45, 0.35);
    } else if (name.startsWith("hair")) {
        m.roughness = 0.45;
        m.sheen.isEnabled = true;
        m.sheen.intensity = 0.4;
        m.sheen.color = new Color3(1, 0.95, 0.85);
    } else if (name.startsWith("Neck") || name.startsWith("Metal") || name.startsWith("ZapN")) {
        m.metallic = 1;
        m.roughness = 0.15;
        m.albedoColor = new Color3(0.95, 0.93, 0.9);
    } else if (/Eyewhite|Iris|Pupil|Teeth/.test(name)) {
        m.roughness = 0.1;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 0.8;
    } else if (name.startsWith("body") || name.startsWith("strap") || name.startsWith("sole") || name.startsWith("heel")) {
        // Shoes: glossy patent leather.
        m.roughness = 0.25;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 1;
        m.clearCoat.roughness = 0.05;
    }
}
