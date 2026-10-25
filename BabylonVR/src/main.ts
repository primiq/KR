import { CreateAudioEngineAsync, CreateStreamingSoundAsync, DracoDecoder, Engine, HavokPlugin, Scene, Vector3, type WebXRDefaultExperience } from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { isProbablyHeadset } from "./config";
import { DesktopControls } from "./desktop";
import { type Environment, LOCATIONS, type LocationId, loadLocation, type Quality } from "./environment";
import { Graphics } from "./graphics";
import { InteractionSystem } from "./interaction";
import { MaterialLibrary } from "./materials";
import { PlayerController } from "./player";
import { Props } from "./props";
import { TouchControls, isTouchDevice } from "./touch";
import { DesktopHud, Stats, VRMenu } from "./ui";
import { XRSystem } from "./xr";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

function progress(fraction: number, label: string): void {
    $("loading-bar").style.width = `${Math.round(fraction * 100)}%`;
    $("loading-text").textContent = label;
}

function storage(key: string, value?: string): string | null {
    try {
        if (value !== undefined) localStorage.setItem(key, value);
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Location from `?location=`, else the last one played, else the atrium. */
function chosenLocation(): LocationId {
    const wanted = params.get("location") ?? storage("location");
    return LOCATIONS.some((l) => l.id === wanted) ? (wanted as LocationId) : "atrium";
}

/** Switching location reloads the page: each location builds its own scene from scratch. */
function switchLocation(id: LocationId): void {
    storage("location", id);
    params.set("location", id);
    location.search = params.toString();
}

/** Loops the location's ambience once the user has interacted with the page (autoplay policy). */
async function startAmbience(env: Environment): Promise<void> {
    if (!env.ambience) return;
    try {
        const audio = await CreateAudioEngineAsync({ volume: 0.5 });
        const sound = await CreateStreamingSoundAsync("ambience", env.ambience, { loop: true, volume: 0.6 });
        await audio.unlockAsync();
        sound.play();
    } catch (e) {
        console.warn("Ambient audio unavailable", e);
    }
}

// Self-hosted Draco decoder (Google, Apache-2.0) for compressed glTF models, so nothing loads from a CDN.
const asset = (path: string) => new URL(path, document.baseURI).href;
DracoDecoder.DefaultConfiguration = {
    wasmUrl: asset("draco/draco_wasm_wrapper_gltf.js"),
    wasmBinaryUrl: asset("draco/draco_decoder_gltf.wasm"),
    fallbackUrl: asset("draco/draco_wasm_wrapper_gltf.js"),
};

async function main(): Promise<void> {
    const headset = isProbablyHeadset();
    const touch = isTouchDevice() && !headset;
    const forced = params.get("quality");
    const quality: Quality = forced === "high" || forced === "medium" || forced === "mobile" ? forced : touch ? "mobile" : headset ? "medium" : "high";
    const locationId = chosenLocation();
    document.body.classList.toggle("touch", touch);

    const canvas = $<HTMLCanvasElement>("renderCanvas");
    const engine = new Engine(canvas, true, { xrCompatible: true, stencil: true, antialias: true, powerPreference: "high-performance" }, true);
    engine.enableOfflineSupport = false;
    // Phones report device-pixel ratios of 2.5–4; rendering at that size is far beyond their fill rate.
    if (quality === "mobile") engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.25));
    window.addEventListener("resize", () => engine.resize());

    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true; // we do our own picking
    scene.clearColor.set(0.02, 0.02, 0.03, 1);
    // Debug: `?fixedstep` simulates at a constant 16 ms per frame (useful on slow/software GPUs).
    if (params.has("fixedstep")) scene.useConstantAnimationDeltaTime = true;

    progress(0.02, "Starting Havok physics…");
    const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));

    const env = await loadLocation(locationId, scene, quality, progress);
    progress(0.8, "Building playground…");
    const mats = new MaterialLibrary(scene, env.probe);
    const props = new Props(scene, env, mats);

    const player = new PlayerController(scene, env.floorY, env.spawn, env.lookAt);
    scene.activeCamera = player.desktopCamera;

    const graphics = new Graphics(scene, env, quality === "mobile" ? "mobile" : "desktop");
    graphics.attach(player.desktopCamera);

    const interaction = new InteractionSystem(scene, props);
    const reset = () => {
        interaction.releaseAll();
        props.resetAll();
    };
    const desktop = new DesktopControls(scene, canvas, player, interaction, reset);
    const touchControls = new TouchControls(canvas, player, desktop, reset);

    const stats = new Stats(engine, scene);
    const status = () => `player   ${player.onGround ? "grounded" : "airborne"}${player.isCrouched ? ", crouched" : ""}\nbodies   ${props.grabbables.length}`;
    const hud = new DesktopHud(scene, graphics, stats, status);
    const vrMenu = new VRMenu(scene, graphics, stats, reset, status, { list: LOCATIONS, current: locationId, select: (id) => switchLocation(id as LocationId) });
    if (touch) ($("settings") as HTMLDetailsElement).open = false;

    // ---- WebXR ------------------------------------------------------------------
    progress(0.85, "Checking for a VR headset…");
    const xrSupported = !!navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr").catch(() => false));
    let xrSystem: XRSystem | null = null;
    if (xrSupported) {
        const xr: WebXRDefaultExperience = await scene.createDefaultXRExperienceAsync({
            disableDefaultUI: true,
            disableTeleportation: true,
            disableNearInteraction: true,
            handSupportOptions: { jointMeshes: { enablePhysics: false } },
        });
        // Only the menu needs ray picking; avoids per-frame ray tests against the environment.
        xr.pointerSelection.raySelectionPredicate = (mesh) => mesh === vrMenu.plane;
        xrSystem = new XRSystem(xr, scene, player, interaction, {
            onEnter: () => {
                desktop.enabled = false;
                touchControls.setEnabled(false);
                hud.show(false);
                $("start").hidden = true;
                graphics.useProfile("xr");
                graphics.attach(xr.baseExperience.camera);
            },
            onExit: () => {
                vrMenu.setVisible(false, player.desktopCamera);
                desktop.enabled = true;
                graphics.useProfile(quality === "mobile" ? "mobile" : "desktop");
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
    progress(0.9, "Compiling shaders…");
    await scene.whenReadyAsync();
    progress(1, "Ready");
    $("loading").hidden = true;

    let ambienceStarted = false;
    const ambience = () => {
        if (ambienceStarted) return;
        ambienceStarted = true;
        void startAmbience(env);
    };
    const enterVR = async () => {
        if (!xrSystem) return;
        ambience();
        try {
            await xrSystem.enter();
        } catch (e) {
            $("xr-status").textContent = `Could not start VR: ${(e as Error).message}`;
        }
    };
    const enterDesktop = () => {
        ambience();
        $("start").hidden = true;
        hud.show(true);
        player.desktopCamera.attachControl(true);
        canvas.focus();
        canvas.requestPointerLock?.();
    };
    const enterTouch = async () => {
        ambience();
        $("start").hidden = true;
        hud.show(true);
        touchControls.setEnabled(true);
        // Full screen + landscape where the browser allows it (Android Chrome / Samsung Internet).
        try {
            await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
            await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
        } catch {
            // Not supported (e.g. iOS Safari) – portrait still works.
        }
        engine.resize();
    };
    function showStart(): void {
        $("start").hidden = false;
        hud.show(false);
        touchControls.setEnabled(false);
    }

    const select = $<HTMLSelectElement>("location");
    for (const loc of LOCATIONS) select.add(new Option(loc.label, loc.id, false, loc.id === locationId));
    select.addEventListener("change", () => switchLocation(select.value as LocationId));

    $("enter-vr").hidden = !xrSupported;
    $("enter-touch").hidden = !touch;
    $("enter-desktop").hidden = touch;
    $("enter-vr").addEventListener("click", enterVR);
    $("enter-touch").addEventListener("click", () => void enterTouch());
    $("enter-desktop").addEventListener("click", enterDesktop);
    $("xr-status").textContent = xrSupported
        ? "VR headset detected — hand tracking and controllers are supported."
        : touch
          ? "Touch controls: left thumb moves, right thumb looks. Rotate to landscape for the best view."
          : "No WebXR VR device found. Use a headset browser (Quest, Pico, Vision Pro…) over HTTPS for VR.";
    showStart();

    if (xrSupported) {
        // Browsers need a user gesture to start an immersive session, except when the session is
        // "granted" by navigating from another immersive page. Handle both, and on a headset turn
        // the very first tap anywhere into "enter VR".
        navigator.xr!.addEventListener("sessiongranted", () => void enterVR());
        if (headset) {
            $("start").addEventListener("click", (e) => {
                if (!(e.target as HTMLElement).closest("#enter-desktop, .location")) void enterVR();
            });
            void enterVR().catch(() => undefined);
        }
    }

    engine.runRenderLoop(() => scene.render());

    // Expose for debugging in the console.
    Object.assign(window, { scene, engine, player, props, graphics, interaction, xrSystem, vrMenu, env });
}

main().catch((e) => {
    console.error(e);
    progress(1, `Failed to start: ${(e as Error).message}`);
});
