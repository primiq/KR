import { type AbstractMesh, Frustum, type Plane, type RenderTargetTexture, type Scene } from "@babylonjs/core";

/**
 * Frustum culling for a render target with a fixed render list (the sea's reflection, the sun's shadow map).
 * Babylon draws every mesh of such a list in every pass, wherever it is; this keeps only those whose bounds reach the
 * pass's own view (the mirrored camera; each shadow cascade). Nothing that could show is dropped, so the picture is the
 * same: only the draws that would have been clipped away anyway are skipped.
 * `keepNear`: ignore the near plane (a shadow cascade with depth clamping: casters between the sun and the cascade
 * still throw their shadow into it).
 */
export function cullRenderTarget(rtt: RenderTargetTexture, scene: Scene, keepNear = false, include?: (m: AbstractMesh) => boolean) {
    // (?nocull: no frustum test, to compare)
    const noCull = typeof location !== "undefined" && /[?&]nocull\b/.test(location.search);
    const out: AbstractMesh[] = [];
    const planes: Plane[] = Frustum.GetPlanes(scene.getTransformMatrix());
    rtt.getCustomRenderList = (_pass, list, len) => {
        // (by now the pass has set its own view: the mirror's, or the cascade's)
        Frustum.GetPlanesToRef(scene.getTransformMatrix(), planes);
        // (Babylon's test always reads all six planes: an "ignored" near plane is one that lets everything through)
        if (keepNear) { planes[0].normal.set(0, 0, 0); planes[0].d = 1; }
        out.length = 0;
        if (!list) return null;
        for (let i = 0; i < len; i++) {
            const m = list[i] as AbstractMesh;
            if (!m.isEnabled() || !m.isVisible || (include && !include(m))) continue;
            if (noCull || m.alwaysSelectAsActiveMesh || m.isInFrustum(planes)) out.push(m);
        }
        return out;
    };
}
