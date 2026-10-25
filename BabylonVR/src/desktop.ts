import { Quaternion, type Scene, Vector3 } from "@babylonjs/core";
import { Interaction as I } from "./config";
import type { InteractionSystem, Manipulator } from "./interaction";
import type { PlayerController } from "./player";

/** Keyboard + mouse first-person controls (also handy for testing without a headset). */
export class DesktopControls {
    enabled = true;
    private readonly keys = new Set<string>();
    private readonly hand: Manipulator;
    private readonly crosshair = document.getElementById("crosshair");

    constructor(
        scene: Scene,
        canvas: HTMLCanvasElement,
        private readonly player: PlayerController,
        private readonly interaction: InteractionSystem,
        private readonly onReset: () => void,
    ) {
        this.hand = interaction.create("mouse");

        window.addEventListener("keydown", (e) => {
            if (!this.enabled) return;
            this.keys.add(e.code);
            if (e.code === "Space") {
                player.input.jump = true;
                e.preventDefault();
            }
            if (e.code === "KeyR") this.onReset();
            if (e.code === "KeyF") {
                const cam = player.desktopCamera;
                interaction.blast(cam.globalPosition, cam.getDirection(Vector3.Forward()), 6, 6);
            }
        });
        window.addEventListener("keyup", (e) => this.keys.delete(e.code));
        window.addEventListener("blur", () => this.keys.clear());

        canvas.addEventListener("pointerdown", (e) => {
            if (!this.enabled) return;
            if (document.pointerLockElement !== canvas) {
                canvas.requestPointerLock?.();
                return;
            }
            if (e.button === 0) this.tryGrab();
            if (e.button === 2) this.throwHeld();
        });
        canvas.addEventListener("pointerup", (e) => {
            if (e.button === 0) this.hand.release();
        });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        canvas.addEventListener(
            "wheel",
            (e) => {
                if (this.hand.held) this.hand.adjustDistance(-Math.sign(e.deltaY) * 0.15, 0.5, I.desktopReach + 1);
            },
            { passive: true },
        );

        scene.onBeforePhysicsObservable.add(() => this.update());
    }

    private update(): void {
        if (!this.enabled) return;
        const k = this.keys;
        const input = this.player.input;
        const x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
        const y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
        input.move.set(x, y);
        if (x && y) input.move.scaleInPlace(Math.SQRT1_2);
        input.sprint = k.has("ShiftLeft") || k.has("ShiftRight");
        input.crouch = k.has("KeyC") || k.has("ControlLeft") || k.has("ControlRight");

        const cam = this.player.desktopCamera;
        this.hand.position.copyFrom(cam.globalPosition);
        Quaternion.FromEulerAnglesToRef(cam.rotation.x, cam.rotation.y, 0, this.hand.rotation);

        if (this.crosshair) {
            const hit = !this.hand.held && this.interaction.raycast(cam.globalPosition, cam.getDirection(Vector3.Forward()), I.desktopReach);
            this.crosshair.classList.toggle("active", !!hit || !!this.hand.held);
        }
    }

    private tryGrab(): void {
        const cam = this.player.desktopCamera;
        const dir = cam.getDirection(Vector3.Forward());
        const hit = this.interaction.raycast(cam.globalPosition, dir, I.desktopReach);
        if (!hit) return;
        this.hand.grab(hit.grabbable);
        // Pull it to a comfortable carry distance in front of the camera.
        this.hand.setOffset(new Vector3(0, -0.1, Math.min(I.desktopHoldDistance, Math.max(0.7, hit.distance))));
    }

    private throwHeld(): void {
        if (!this.hand.held) return;
        const dir = this.player.desktopCamera.getDirection(Vector3.Forward());
        const mass = this.hand.held.aggregate.body.getMassProperties().mass ?? 1;
        this.hand.release(dir.scale(I.desktopThrowSpeed / Math.max(1, Math.sqrt(mass / 1.5))));
    }
}
