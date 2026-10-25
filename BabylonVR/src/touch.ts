import type { DesktopControls, ExternalInput } from "./desktop";
import type { PlayerController } from "./player";

const LOOK_SENSITIVITY = 0.0055; // radians per CSS pixel
const STICK_RADIUS = 60; // CSS pixels

/**
 * Touch controls for phones and tablets:
 *  - a floating joystick on the left half of the screen (push to the rim to sprint)
 *  - drag anywhere on the right half to look around
 *  - buttons for jump, crouch (toggle), grab/drop, throw and push
 */
export class TouchControls {
    enabled = false;
    private readonly root = document.getElementById("touch")!;
    private readonly stick = document.getElementById("stick")!;
    private readonly knob = document.getElementById("stick-knob")!;
    private readonly grabBtn = document.querySelector<HTMLButtonElement>('[data-act="grab"]')!;
    private readonly crouchBtn = document.querySelector<HTMLButtonElement>('[data-act="crouch"]')!;
    private readonly state: ExternalInput = { move: { x: 0, y: 0 }, sprint: false, crouch: false };
    private stickId: number | null = null;
    private stickOrigin = { x: 0, y: 0 };
    private lookId: number | null = null;
    private lookLast = { x: 0, y: 0 };

    constructor(
        canvas: HTMLCanvasElement,
        private readonly player: PlayerController,
        private readonly desktop: DesktopControls,
        private readonly onReset: () => void,
    ) {
        canvas.addEventListener("pointerdown", (e) => this.down(e));
        window.addEventListener("pointermove", (e) => this.move(e), { passive: false });
        window.addEventListener("pointerup", (e) => this.up(e));
        window.addEventListener("pointercancel", (e) => this.up(e));

        this.root.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
            btn.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.action(btn.dataset.act!);
            });
        });
    }

    setEnabled(on: boolean): void {
        this.enabled = on;
        this.root.hidden = !on;
        this.desktop.external = on ? this.state : null;
        if (!on) this.resetStick();
    }

    private action(act: string): void {
        switch (act) {
            case "jump":
                this.player.input.jump = true;
                break;
            case "crouch":
                this.state.crouch = !this.state.crouch;
                this.crouchBtn.classList.toggle("on", this.state.crouch);
                break;
            case "grab":
                if (this.desktop.holding) this.desktop.drop();
                else this.desktop.tryGrab();
                break;
            case "throw":
                this.desktop.throwHeld();
                break;
            case "push":
                this.desktop.push();
                break;
            case "reset":
                this.onReset();
                break;
        }
        this.grabBtn.textContent = this.desktop.holding ? "Drop" : "Grab";
        this.grabBtn.classList.toggle("on", this.desktop.holding);
    }

    private down(e: PointerEvent): void {
        if (!this.enabled || e.pointerType === "mouse") return;
        e.preventDefault();
        if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
            // Floating joystick: centred wherever the thumb lands.
            this.stickId = e.pointerId;
            this.stickOrigin = { x: e.clientX, y: e.clientY };
            this.stick.style.left = `${e.clientX}px`;
            this.stick.style.top = `${e.clientY}px`;
            this.stick.classList.add("active");
            this.updateStick(e.clientX, e.clientY);
        } else if (this.lookId === null) {
            this.lookId = e.pointerId;
            this.lookLast = { x: e.clientX, y: e.clientY };
        }
    }

    private move(e: PointerEvent): void {
        if (!this.enabled) return;
        if (e.pointerId === this.stickId) {
            e.preventDefault();
            this.updateStick(e.clientX, e.clientY);
        } else if (e.pointerId === this.lookId) {
            e.preventDefault();
            const cam = this.player.desktopCamera;
            cam.rotation.y += (e.clientX - this.lookLast.x) * LOOK_SENSITIVITY;
            cam.rotation.x = Math.max(-1.45, Math.min(1.45, cam.rotation.x + (e.clientY - this.lookLast.y) * LOOK_SENSITIVITY));
            this.lookLast = { x: e.clientX, y: e.clientY };
        }
    }

    private up(e: PointerEvent): void {
        if (e.pointerId === this.stickId) this.resetStick();
        if (e.pointerId === this.lookId) this.lookId = null;
    }

    private updateStick(x: number, y: number): void {
        let dx = x - this.stickOrigin.x;
        let dy = y - this.stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
            dx *= STICK_RADIUS / len;
            dy *= STICK_RADIUS / len;
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / STICK_RADIUS;
        const ny = -dy / STICK_RADIUS;
        const mag = Math.hypot(nx, ny);
        const dead = 0.12;
        const scale = mag < dead ? 0 : (mag - dead) / (1 - dead) / mag;
        this.state.move = { x: nx * scale, y: ny * scale };
        this.state.sprint = mag > 0.95;
    }

    private resetStick(): void {
        this.stickId = null;
        this.state.move = { x: 0, y: 0 };
        this.state.sprint = false;
        this.knob.style.transform = "";
        this.stick.style.left = "";
        this.stick.style.top = "";
        this.stick.classList.remove("active");
    }
}

/** Touch-first device that isn't a VR headset browser. */
export function isTouchDevice(): boolean {
    return matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
}
