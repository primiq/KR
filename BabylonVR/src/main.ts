import { Engine, HavokPlugin, Scene, Vector3, type WebXRDefaultExperience } from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { isProbablyHeadset } from "./config";
import { DesktopControls } from "./desktop";
import { createEnvironment } from "./environment";
import { Graphics } from "./graphics";
import { InteractionSystem } from "./interaction";
import { MaterialLibrary } from "./materials";
import { PlayerController } from "./player";
import { Props } from "./props";
import { DesktopHud, Stats, VRMenu } from "./ui";
import { XRSystem } from "./xr";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function progress(fraction: number, label: string): void {
    $("loading-bar").style.width = `${Math.round(fraction * 100)}%`;
    $("loading-text").textContent = label;
}

async function main(): Promise<void> {
    const canvas = $<HTMLCanvasElement>("renderCanvas");
    const engine = new Engine(canvas, true, { xrCompatible: true, stencil: true, antialias: true, powerPreference: "high-performance" }, true);
    engine.enableOfflineSupport = false;
    window.addEventListener("resize", () => engine.resize());

    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true; // we do our own picking; saves raycasts against Sponza
    scene.clearColor.set(0.02, 0.02, 0.03, 1);
    // Debug: `?fixedstep` simulates at a constant 16 ms per frame (useful on slow/software GPUs).
    if (new URLSearchParams(location.search).has("fixedstep")) scene.useConstantAnimationDeltaTime = true;

    progress(0.02, "Starting Havok physics…");
    const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

    const env = await createEnvironment(scene, progress);
    progress(0.65, "Building playground…");
    const mats = new MaterialLibrary(scene, env.probe);
    const props = new Props(scene, env, mats);

    const player = new PlayerController(scene, env.floorY, new Vector3(-0.9, 0, -0.35), new Vector3(8, 0, -0.6));
    scene.activeCamera = player.desktopCamera;

    const graphics = new Graphics(scene, env);
    graphics.attach(player.desktopCamera);

    const interaction = new InteractionSystem(scene, props);
    const reset = () => {
        interaction.releaseAll();
        props.resetAll();
    };
    const desktop = new DesktopControls(scene, canvas, player, interaction, reset);

    const stats = new Stats(engine, scene);
    const status = () => `player   ${player.onGround ? "grounded" : "airborne"}${player.isCrouched ? ", crouched" : ""}\nbodies   ${props.grabbables.length}`;
    const hud = new DesktopHud(scene, graphics, stats, status);
    const vrMenu = new VRMenu(scene, graphics, stats, reset, status);

    // ---- WebXR ------------------------------------------------------------------
    progress(0.75, "Checking for a VR headset…");
    const xrSupported = !!navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr").catch(() => false));
    let xrSystem: XRSystem | null = null;
    if (xrSupported) {
        const xr: WebXRDefaultExperience = await scene.createDefaultXRExperienceAsync({
            disableDefaultUI: true,
            disableTeleportation: true,
            disableNearInteraction: true,
            floorMeshes: env.sponzaMeshes,
            handSupportOptions: { jointMeshes: { enablePhysics: false } },
        });
        // Only the menu needs ray picking; avoids per-frame ray tests against Sponza's 260k triangles.
        xr.pointerSelection.raySelectionPredicate = (mesh) => mesh === vrMenu.plane;
        xrSystem = new XRSystem(xr, scene, player, interaction, {
            onEnter: () => {
                desktop.enabled = false;
                hud.show(false);
                $("start").hidden = true;
                graphics.useProfile("xr");
                graphics.attach(xr.baseExperience.camera);
            },
            onExit: () => {
                vrMenu.setVisible(false, player.desktopCamera);
                desktop.enabled = true;
                graphics.useProfile("desktop");
                scene.activeCamera = player.desktopCamera;
                graphics.attach(player.desktopCamera);
                showStart();
            },
            onToggleMenu: () => vrMenu.toggle(xr.baseExperience.camera),
            onReset: reset,
            isPointerOverUI: (id) => vrMenu.visible && xr.pointerSelection.getMeshUnderPointer(id) === vrMenu.plane,
        });
    }

    // ---- Start screen -------------------------------------------------------------
    progress(0.85, "Compiling shaders…");
    await scene.whenReadyAsync();
    progress(1, "Ready");
    $("loading").hidden = true;

    const enterVR = async () => {
        if (!xrSystem) return;
        try {
            await xrSystem.enter();
        } catch (e) {
            $("xr-status").textContent = `Could not start VR: ${(e as Error).message}`;
        }
    };
    const enterDesktop = () => {
        $("start").hidden = true;
        hud.show(true);
        canvas.focus();
        canvas.requestPointerLock?.();
    };
    function showStart(): void {
        $("start").hidden = false;
        hud.show(false);
    }

    $("enter-vr").hidden = !xrSupported;
    $("enter-vr").addEventListener("click", enterVR);
    $("enter-desktop").addEventListener("click", enterDesktop);
    $("xr-status").textContent = xrSupported
        ? "VR headset detected — hand tracking and controllers are supported."
        : "No WebXR VR device found. Use a headset browser (Quest, Pico, Vision Pro…) over HTTPS for VR.";
    showStart();

    if (xrSupported) {
        // Browsers need a user gesture to start an immersive session, except when the session is
        // "granted" by navigating from another immersive page. Handle both, and on a headset turn
        // the very first tap anywhere into "enter VR".
        navigator.xr!.addEventListener("sessiongranted", () => void enterVR());
        if (isProbablyHeadset()) {
            $("start").addEventListener("click", (e) => {
                if (e.target !== $("enter-desktop")) void enterVR();
            });
            void enterVR().catch(() => undefined);
        }
    }

    engine.runRenderLoop(() => scene.render());

    // Expose for debugging in the console.
    Object.assign(window, { scene, engine, player, props, graphics, interaction, xrSystem, vrMenu });
}

main().catch((e) => {
    console.error(e);
    progress(1, `Failed to start: ${(e as Error).message}`);
});
