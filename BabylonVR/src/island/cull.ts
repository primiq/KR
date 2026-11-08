import { type AbstractMesh, Frustum, type Plane, type RenderTargetTexture, type Scene } from "@babylonjs/core";

/**
 * Frustum culling for a render target with a fixed render list (the sea's reflection, the sun's shadow map).
 * Babylon draws every mesh of such a list in every pass, wherever it is; this keeps only those whose bounds reach the
 * pass's own view (the mirrored camera; each shadow cascade). Nothing that could show is dropped, so the picture is the
 * same: only the draws that would have been clipped away anyway are skipped.
 * `keepNear`: ignore the near plane (a shadow cascade with depth clamping: casters between the sun and the cascade
 * still throw their shadow into it).
 */
export function cullRenderTarget(rtt: RenderTargetTexture, scene: Scene, keepNear = false) {
    // (?nocull: draw the whole list as before, to compare)
    if (typeof location !== "undefined" && /[?&]nocull\b/.test(location.search)) return;
    const out: AbstractMesh[] = [];
    const planes: Plane[] = Frustum.GetPlanes(scene.getTransformMatrix());
    rtt.getCustomRenderList = (_pass, list, len) => {
        // (by now the pass has set its own view: the mirror's, or the cascade's)
        Frustum.GetPlanesToRef(scene.getTransformMatrix(), planes);
        const use = keepNear ? planes.slice(1) : planes;
        out.length = 0;
        if (!list) return null;
        for (let i = 0; i < len; i++) {
            const m = list[i] as AbstractMesh;
            if (!m.isEnabled() || !m.isVisible) continue;
            if (m.alwaysSelectAsActiveMesh || m.isInFrustum(use)) out.push(m);
        }
        return out;
    };
}
