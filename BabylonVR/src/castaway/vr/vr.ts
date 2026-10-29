import {
    type DefaultRenderingPipeline,
    Quaternion,
    type Scene,
    TransformNode,
    Vector3,
    type WebXRDefaultExperience,
    type WebXRInputSource,
    WebXRState,
} from "@babylonjs/core";
import type { Input } from "../core/input";
import type { Game } from "../game/game";
import { ITEMS, type ItemId } from "../game/items";
import { heldModel, ITEM_COLOR } from "../game/viewmodel";
import { bakeGroup, disposeBaked } from "../render/bake";
import { glow, solid } from "../render/materials";
import type { Player } from "../world/player";
import { VRPanel } from "./panel";

const SNAP = Math.PI / 6;

interface Hand {
    src: WebXRInputSource;
    side: "left" | "right";
    prev: Vector3 | null;
    speed: number;
    /** button states last frame (edge detection) */
    trig: boolean; sq: boolean; a: boolean; b: boolean; x: boolean; y: boolean; stick: boolean;
}

const btn = (h: Hand | null, i: number) => !!h?.src.inputSource.gamepad?.buttons?.[i]?.pressed;
const val = (h: Hand | null, i: number) => h?.src.inputSource.gamepad?.buttons?.[i]?.value ?? 0;
const axis = (h: Hand | null, i: number) => h?.src.inputSource.gamepad?.axes?.[i] ?? 0;

/**
 * Castaway in a headset. Controls follow Castaway's: left stick walks (push it all the way, or hold the left grip, to
 * sprint), right stick snap-turns and steps through the hotbar, the right trigger uses / places, the right grip or A
 * picks up and opens (hold to pick structures up), B jumps (and swims up), the left trigger dives, X turns what you
 * are placing (otherwise opens crafting), Y changes building piece, and a left stick click opens the bag.
 * Tools are held in the right hand and you chop and mine by actually swinging your arm.
 */
export class CastawayVR {
    active = false;
    private hands = new Map<string, Hand>();
    private held: TransformNode | null = null;
    private heldId: ItemId | null = null;
    private turnArmed = true;
    private slotArmed = true;
    readonly panel: VRPanel;
    private yawOffset = 0;

    constructor(
        private readonly scene: Scene,
        private readonly xr: WebXRDefaultExperience,
        private readonly game: Game,
        private readonly player: Player,
        private readonly input: Input,
        pipeline: DefaultRenderingPipeline,
    ) {
        const base = xr.baseExperience;
        this.panel = new VRPanel(scene, game);
        base.onStateChangedObservable.add((s) => {
            if (s === WebXRState.IN_XR) {
                this.active = true;
                game.vr.active = true;
                player.vr = true;
                const sm = base.sessionManager;
                if (sm.isFixedFoveationSupported) sm.fixedFoveation = 0.6;
                // the headset keeps a lighter post chain: bloom and the vignette only
                pipeline.samples = 1;
                pipeline.addCamera(base.camera);
                base.camera.minZ = 0.05;
                base.camera.maxZ = 1600;
                this.placeRig(true);
                game.vr.haptic = (k) => this.pulse("right", k);
                document.body.classList.add("in-vr");
            } else if (s === WebXRState.NOT_IN_XR) {
                this.active = false;
                game.vr.active = false;
                player.vr = false;
                this.panel.setVisible(false);
                document.body.classList.remove("in-vr");
            }
        });
        xr.input.onControllerAddedObservable.add((src) => {
            const side = src.inputSource.handedness === "left" ? "left" : "right";
            this.hands.set(side, { src, side, prev: null, speed: 0, trig: false, sq: false, a: false, b: false, x: false, y: false, stick: false });
            if (side === "left") src.onMotionControllerInitObservable.add(() => this.panel.attach(src));
        });
        xr.input.onControllerRemovedObservable.add((src) => {
            for (const [k, h] of this.hands) if (h.src === src) this.hands.delete(k);
        });
    }

    async exit() {
        await this.xr.baseExperience.exitXRAsync();
    }

    async enter() {
        await this.xr.baseExperience.enterXRAsync("immersive-vr", "local-floor", this.xr.renderTarget);
    }

    private pulse(side: "left" | "right", k: number) {
        const h = this.hands.get(side);
        void h?.src.motionController?.pulse(Math.min(1, k), 40 + k * 60);
    }

    private get cam() { return this.xr.baseExperience.camera; }

    /** headset yaw in Castaway's convention (0 = facing -z) */
    private headYaw(): number {
        const f = this.cam.getDirection(Vector3.Forward(true));
        return Math.atan2(-f.x, -f.z);
    }

    private placeRig(face = false) {
        const cam = this.cam;
        const h = cam.realWorldHeight || 1.6;
        cam.position.set(this.player.pos.x, this.player.pos.y + h, this.player.pos.z);
        if (face) {
            // turn the play space so you face the way the player was facing
            const dy = this.player.yaw - this.headYaw();
            cam.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), dy).multiply(cam.rotationQuaternion ?? Quaternion.Identity());
        }
    }

    /** Before the player moves: sticks and buttons become the same inputs the keyboard produces; room-scale walking. */
    beforePlayer(_dt: number) {
        if (!this.active) return;
        const { input, game, player } = this;
        const L = this.hands.get("left") ?? null, R = this.hands.get("right") ?? null;
        const cam = this.cam;
        // room-scale: the body follows the head across the floor (through the same collision as walking)
        const hx = cam.position.x, hz = cam.position.z;
        if (Math.hypot(hx - player.pos.x, hz - player.pos.z) > 1e-3 && Math.hypot(hx - player.pos.x, hz - player.pos.z) < 2) {
            player.vel.x += 0; // (velocity is the stick's; the step is applied straight to the position)
            player.pos.x = hx;
            player.pos.z = hz;
        }
        player.yaw = this.headYaw();
        player.pitch = 0;
        cam.getDirection(Vector3.Forward(true)).normalizeToRef(player.look);

        // left stick: walk relative to where you look
        const sx = axis(L, 2) || axis(L, 0), sy = axis(L, 3) || axis(L, 1);
        const len = Math.hypot(sx, sy), dead = 0.15;
        if (len > dead) {
            const k = Math.min(1, (len - dead) / (1 - dead)) / len;
            input.move.x = sx * k;
            input.move.y = -sy * k;
        } else { input.move.x = 0; input.move.y = 0; }
        input.sprint = btn(L, 1) || len > 0.97;
        input.diveVR = val(L, 0) > 0.6;

        // right stick: snap turn (x) and hotbar (y)
        const rx = axis(R, 2) || axis(R, 0), ry = axis(R, 3) || axis(R, 1);
        if (Math.abs(rx) < 0.35) this.turnArmed = true;
        else if (this.turnArmed && Math.abs(rx) > 0.75) {
            this.turnArmed = false;
            const a = rx > 0 ? -SNAP : SNAP;
            // turn about the head, not the play-space origin
            const head = cam.position.clone();
            cam.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), a).multiply(cam.rotationQuaternion ?? Quaternion.Identity());
            cam.position.copyFrom(head);
            this.yawOffset += a;
        }
        if (Math.abs(ry) < 0.35) this.slotArmed = true;
        else if (this.slotArmed && Math.abs(ry) > 0.75) { this.slotArmed = false; input.hotbarDelta += ry > 0 ? 1 : -1; }

        // buttons
        if (R) {
            const trig = val(R, 0) > 0.6, sq = btn(R, 1), a = btn(R, 4), b = btn(R, 5);
            const used = sq || a;
            if (trig && !R.trig && !this.panel.pointerBusy) {
                if (game.stats.dead) game.respawn();
                else game.vrPrimary(false);
            }
            if (used && !(R.a || R.sq)) input.interactQueued = true;
            input.interactHeld = used;
            if (b && !R.b) input.jumpQueued = true;
            input.jumpHeld = b;
            R.trig = trig; R.sq = sq; R.a = a; R.b = b;
        }
        if (L) {
            const x = btn(L, 4), y = btn(L, 5), stick = btn(L, 3);
            const def = game.equippedDef;
            if (x && !L.x) {
                if (def?.kind === "plan" || (def?.kind === "placeable" && def.place !== "torch")) input.rotateQueued++;
                else if (!game.stats.dead) this.panel.open("craft");
            }
            if (y && !L.y) {
                if (def?.id === "torch") input.modeQueued = true;
                else input.cycleDelta++;
            }
            if (stick && !L.stick) this.panel.toggle("bag");
            L.x = x; L.y = y; L.stick = stick;
        }
        input.lookDX = input.lookDY = 0;
    }

    /** After the player moves: put the headset on the body, read the right hand for aim and swings. */
    afterPlayer(dt: number) {
        if (!this.active) return;
        const { game, player } = this;
        const cam = this.cam;
        const h = cam.realWorldHeight || 1.6;
        cam.position.set(player.pos.x, player.pos.y + h, player.pos.z);
        player.eye.copyFrom(cam.position);

        const R = this.hands.get("right") ?? null;
        const id = game.equipped?.id ?? null;
        this.setHeld(R, id);
        if (R) {
            const grip = R.src.grip ?? R.src.pointer;
            const ptr = R.src.pointer;
            game.vr.eye.copyFrom(ptr.absolutePosition);
            ptr.getDirectionToRef(Vector3.Forward(true), game.vr.dir);
            // a rod's line runs from its tip, 1.4 m out along the hand
            game.fishing.tipOverride = id && ITEMS[id].tool?.model === "rod" ? ptr.absolutePosition.add(game.vr.dir.scale(1.4)) : null;
            // hand speed relative to the head (so walking does not count as swinging)
            const rel = grip.absolutePosition.subtract(cam.position);
            if (R.prev) {
                const v = Vector3.Distance(rel, R.prev) / Math.max(dt, 1 / 120);
                R.speed += (v - R.speed) * 0.6;
                if (R.speed > 2.4 && id && ITEMS[id].tool && ITEMS[id].tool!.model !== "rod") game.vrPrimary(true);
            }
            R.prev = rel;
        } else {
            game.vr.eye.copyFrom(cam.position);
            cam.getDirectionToRef(Vector3.Forward(true), game.vr.dir);
        }
        this.panel.update(dt);
    }

    /** Head and hand transforms relative to the feet (world axes), sent to other players so they see your avatar. */
    pose(): { h: number[]; r: number[] | 0; l: number[] | 0 } | null {
        if (!this.active) return null;
        const p = this.player.pos, cam = this.cam;
        const f = cam.getDirection(Vector3.Forward(true));
        const up = cam.getDirection(Vector3.Up());
        const h = [cam.position.x - p.x, cam.position.y - p.y, cam.position.z - p.z, Math.atan2(-f.x, -f.z), Math.asin(Math.max(-1, Math.min(1, f.y))), Math.atan2(-up.x * Math.cos(this.player.yaw) + up.z * Math.sin(this.player.yaw), up.y)];
        const hand = (side: "left" | "right"): number[] | 0 => {
            const g = this.hands.get(side)?.src.grip;
            if (!g) return 0;
            const q = g.absoluteRotationQuaternion, a = g.absolutePosition;
            return [a.x - p.x, a.y - p.y, a.z - p.z, q.x, q.y, q.z, q.w];
        };
        return { h, r: hand("right"), l: hand("left") };
    }

    /** the tool / item in your right hand */
    private setHeld(R: Hand | null, id: ItemId | null) {
        if (id === this.heldId && (this.held?.parent || !R)) return;
        this.heldId = id;
        if (this.held) disposeBaked(this.held);
        this.held = null;
        if (!R || !id) return;
        const color = ITEM_COLOR[id] ?? "#cfc6b4";
        const b = bakeGroup(`vrHeld_${id}`, heldModel(id), this.scene, (k) => {
            if (k === "flame") return glow(this.scene, "#ffb14a");
            const map: Record<string, [string, number, number]> = {
                handle: ["#8b5e34", 0.85, 0], steel: ["#aeb6bd", 0.3, 0.9], stoneTool: ["#8e8a82", 0.9, 0], diamond: ["#7ff4ff", 0.08, 0.2],
                rope: ["#b8a470", 1, 0], paper: ["#3b73a8", 0.8, 0], soot: ["#0d0b0a", 1, 0],
            };
            const m = map[k] ?? [color, 0.85, 0];
            return solid(this.scene, m[0], m[1], m[2]);
        }, false);
        this.held = b.node;
        this.held.parent = R.src.grip ?? R.src.pointer;
        // held like a hatchet: the handle in the fist, the head forward and up
        this.held.position.set(0, -0.02, 0.06);
        this.held.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2 + 0.35);
    }
}
