import { type Camera, type Engine, MeshBuilder, type Mesh, type Scene, SceneInstrumentation, Vector3 } from "@babylonjs/core";
import { AdvancedDynamicTexture, Button, Checkbox, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui";
import type { Graphics } from "./graphics";

/** Collects frame stats once and exposes a formatted summary for both UIs. */
export class Stats {
    private readonly inst: SceneInstrumentation;

    constructor(
        private readonly engine: Engine,
        scene: Scene,
    ) {
        this.inst = new SceneInstrumentation(scene);
        this.inst.captureFrameTime = true;
        this.inst.captureRenderTime = true;
        this.inst.capturePhysicsTime = true;
    }

    text(scene: Scene, extra = ""): string {
        const i = this.inst;
        const active = scene.getActiveMeshes().length;
        return [
            `FPS      ${this.engine.getFps().toFixed(0)}`,
            `frame    ${i.frameTimeCounter.lastSecAverage.toFixed(2)} ms`,
            `render   ${i.renderTimeCounter.lastSecAverage.toFixed(2)} ms`,
            `physics  ${i.physicsTimeCounter.lastSecAverage.toFixed(2)} ms`,
            `draws    ${i.drawCallsCounter.current}`,
            `meshes   ${active} / ${scene.meshes.length}`,
            extra,
        ]
            .filter(Boolean)
            .join("\n");
    }
}

/** HTML overlay used on desktop. */
export class DesktopHud {
    private readonly root = document.getElementById("hud")!;
    private readonly stats = document.getElementById("stats")!;
    private readonly list = document.getElementById("settings-list")!;
    private last = 0;

    constructor(
        scene: Scene,
        private readonly graphics: Graphics,
        statsSource: Stats,
        private readonly status: () => string,
    ) {
        this.render();
        graphics.onChanged.push(() => this.sync());
        scene.onAfterRenderObservable.add(() => {
            const now = performance.now();
            if (now - this.last < 250) return;
            this.last = now;
            this.stats.textContent = statsSource.text(scene, this.status());
        });
    }

    show(visible: boolean): void {
        this.root.hidden = !visible;
    }

    private render(): void {
        this.list.innerHTML = "";
        for (const s of this.graphics.settings) {
            const label = document.createElement("label");
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = s.value;
            box.dataset.key = s.key;
            box.addEventListener("change", () => this.graphics.set(s.key, box.checked));
            label.append(box, s.label);
            this.list.append(label);
        }
    }

    private sync(): void {
        this.list.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((box) => {
            box.checked = this.graphics.get(box.dataset.key as never);
        });
    }
}

/** World-space menu for VR: graphics toggles + live stats, clicked with the pointer ray. */
export class VRMenu {
    readonly plane: Mesh;
    private readonly checks = new Map<string, Checkbox>();
    private readonly statsText: TextBlock;
    private last = 0;

    constructor(
        scene: Scene,
        graphics: Graphics,
        stats: Stats,
        onReset: () => void,
        status: () => string,
        locations: { list: Array<{ id: string; label: string }>; current: string; select: (id: string) => void },
    ) {
        this.plane = MeshBuilder.CreatePlane("vrMenu", { width: 0.56, height: 0.84 }, scene);
        this.plane.isVisible = false;
        this.plane.isPickable = false;
        const ui = AdvancedDynamicTexture.CreateForMesh(this.plane, 800, 1200, false);

        const bg = new Rectangle("bg");
        bg.background = "#0c0e16dd";
        bg.cornerRadius = 36;
        bg.thickness = 3;
        bg.color = "#6ee7ff88";
        ui.addControl(bg);

        const panel = new StackPanel("panel");
        panel.paddingTopInPixels = 28;
        panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
        bg.addControl(panel);

        const title = new TextBlock("title", "Babylon VR Playground");
        title.height = "70px";
        title.color = "#6ee7ff";
        title.fontSize = 40;
        title.fontWeight = "bold";
        panel.addControl(title);

        for (const s of graphics.settings) {
            const row = new StackPanel(`row-${s.key}`);
            row.isVertical = false;
            row.height = "58px";
            row.paddingLeftInPixels = 40;
            const cb = new Checkbox(`cb-${s.key}`);
            cb.width = "40px";
            cb.height = "40px";
            cb.color = "#6ee7ff";
            cb.background = "#20263a";
            cb.isChecked = s.value;
            cb.onIsCheckedChangedObservable.add((v) => graphics.set(s.key, v));
            const label = new TextBlock(`lbl-${s.key}`, s.label);
            label.width = "640px";
            label.paddingLeftInPixels = 20;
            label.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            label.color = "#e8ecf4";
            label.fontSize = 30;
            row.addControl(cb);
            row.addControl(label);
            panel.addControl(row);
            this.checks.set(s.key, cb);
        }

        const reset = Button.CreateSimpleButton("reset", "Reset blocks");
        reset.width = "320px";
        reset.height = "64px";
        reset.paddingTopInPixels = 8;
        reset.color = "#05060a";
        reset.background = "#b48cff";
        reset.cornerRadius = 16;
        reset.fontSize = 30;
        reset.onPointerUpObservable.add(onReset);
        panel.addControl(reset);

        // Location switcher (reloads the page into the chosen location).
        const locRow = new StackPanel("locations");
        locRow.isVertical = false;
        locRow.height = "90px";
        locRow.paddingTopInPixels = 16;
        for (const loc of locations.list) {
            const b = Button.CreateSimpleButton(`loc-${loc.id}`, loc.label);
            b.width = `${Math.floor(720 / locations.list.length)}px`;
            b.height = "70px";
            b.paddingLeftInPixels = 10;
            b.paddingRightInPixels = 10;
            b.cornerRadius = 16;
            b.fontSize = 24;
            const active = loc.id === locations.current;
            b.color = active ? "#05060a" : "#e8ecf4";
            b.background = active ? "#6ee7ff" : "#20263a";
            b.onPointerUpObservable.add(() => {
                if (!active) locations.select(loc.id);
            });
            locRow.addControl(b);
        }
        panel.addControl(locRow);

        this.statsText = new TextBlock("stats", "");
        this.statsText.height = "230px";
        this.statsText.color = "#9aa3b5";
        this.statsText.fontSize = 24;
        this.statsText.fontFamily = "monospace";
        this.statsText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.statsText.paddingLeftInPixels = 50;
        panel.addControl(this.statsText);

        graphics.onChanged.push(() => {
            for (const [key, cb] of this.checks) cb.isChecked = graphics.get(key as never);
        });
        scene.onAfterRenderObservable.add(() => {
            if (!this.plane.isVisible) return;
            const now = performance.now();
            if (now - this.last < 300) return;
            this.last = now;
            this.statsText.text = stats.text(scene, status());
        });
    }

    get visible(): boolean {
        return this.plane.isVisible;
    }

    toggle(camera: Camera): void {
        this.setVisible(!this.plane.isVisible, camera);
    }

    setVisible(visible: boolean, camera: Camera): void {
        this.plane.isVisible = visible;
        this.plane.isPickable = visible;
        if (!visible) return;
        // Float it in front of the user at chest height, facing them.
        const fwd = camera.getDirection(Vector3.Forward());
        fwd.y = 0;
        fwd.normalize();
        const pos = camera.globalPosition.add(fwd.scale(0.65));
        pos.y -= 0.25;
        this.plane.position.copyFrom(pos);
        this.plane.lookAt(camera.globalPosition.subtract(new Vector3(0, 0.25, 0)), Math.PI);
    }
}
