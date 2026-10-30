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
import * as THREE from "three";
import { heldModel, ITEM_COLOR } from "../game/viewmodel";
import { bakeGroup, disposeBaked } from "../render/bake";
import { glow, solid } from "../render/materials";
import { ThreeMirror } from "../render/mirror";
import { buildGorillaHand } from "../campaign/gorilla";
import { buildPaw, type Coat } from "../world/cats";
import type { Player } from "../world/player";
import { VRPanel } from "./panel";
import { VRPaint } from "./paintvr";

const SNAP = Math.PI / 6;
/** a cat is about a quarter of your size; its paws are drawn bigger than life so you can see them */
const CAT_SCALE = 0.24, PAW_SCALE = 1.9, PULL_GAIN = 1.5, THROW_GAIN = 3.2, GOR_SCALE = 1.12;
const _v = new THREE.Vector3(), _gd = new THREE.Vector3();

interface Hand {
    src: WebXRInputSource;
    side: "left" | "right";
    prev: Vector3 | null;
    speed: number;
    /** button states last frame (edge detection) */
    trig: boolean; sq: boolean; a: boolean; b: boolean; x: boolean; y: boolean; stick: boolean;
    /** a three.js stand-in following the grip (the gorilla hand or the cat paw hang under it, drawn by the hand mirror) */
    rig: THREE.Group;
    /** smoothed world velocity of the hand and where it was last frame (throwing things) */
    mvel: THREE.Vector3; mprev: THREE.Vector3 | null;
    /** Banana or Salmon: holding something; left trigger last frame */
    cheld: boolean; ctrig: boolean;
    /** cat house: holding the mouse; claws dug in, and where the paw was last frame (play-space) */
    mouse: boolean; cgrip: boolean; cprev: Vector3 | null;
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
    /** painting a picture: the canvas on the wall, the palette above the right hand */
    readonly paint: VRPaint;
    private yawOffset = 0;
    /** the guitar is held by the neck in the left hand (the right one strums) */
    private guitar: TransformNode | null = null;
    private strumZone: TransformNode | null = null;
    private zone3 = new THREE.Object3D();
    /** the hand extras (gorilla hands, cat paws): a three.js scene of their own, drawn by a mirror */
    private handHolder = new THREE.Scene();
    private handMirror: ThreeMirror;
    catOn = false;
    gorOn = false;
    private catCoat: Coat | null = null;
    /** the comfort vignette: grows with stick movement and snap turns, fades back */
    private vigK = 0;
    private vig0 = 0;

    constructor(
        private readonly scene: Scene,
        private readonly xr: WebXRDefaultExperience,
        private readonly game: Game,
        private readonly player: Player,
        private readonly input: Input,
        private readonly pipeline: DefaultRenderingPipeline | null,
    ) {
        const base = xr.baseExperience;
        this.panel = new VRPanel(scene, game);
        this.paint = new VRPaint(scene);
        game.vr.paint = (p, done) => {
            // the palette goes on the right hand when both controllers are there (the left one points at it)
            const L = this.hands.get("left"), R = this.hands.get("right");
            this.paint.start(p, game.paintings, L && R ? R.src.grip ?? R.src.pointer : null, done);
        };
        this.zone3.matrixAutoUpdate = false;
        this.handMirror = new ThreeMirror(scene, this.handHolder, null, false, { tag: { keepUnderground: true } });
        base.onStateChangedObservable.add((s) => {
            if (s === WebXRState.IN_XR) {
                this.active = true;
                game.vr.active = true;
                player.vr = true;
                const sm = base.sessionManager;
                // (full foveation: the edges of the view, which the lenses blur anyway, are drawn at a fraction of the pixels)
                if (sm.isFixedFoveationSupported) sm.fixedFoveation = pipeline ? 0.6 : 1;
                // a PC headset keeps a lighter post chain (bloom and the vignette); a standalone one has none at all
                if (pipeline) { pipeline.samples = 1; pipeline.addCamera(base.camera); }
                // (10 cm, as on a screen: headsets often give a 16-bit depth buffer, and at 5 cm the room decorations a centimetre or
                //  two apart fought a few metres away)
                base.camera.minZ = 0.1;
                base.camera.maxZ = 1600;
                this.placeRig(true);
                game.vr.haptic = (k) => this.pulse("right", k);
                this.vig0 = pipeline?.imageProcessing ? pipeline.imageProcessing.vignetteWeight : 0;
                this.applyScale();
                document.body.classList.add("in-vr");
            } else if (s === WebXRState.NOT_IN_XR) {
                this.active = false;
                game.vr.active = false;
                game.vr.head = game.vr.headDir = null;
                player.vr = false;
                this.panel.setVisible(false);
                if (this.paint.active) this.paint.cancel();
                document.body.classList.remove("in-vr");
            }
        });
        xr.input.onControllerAddedObservable.add((src) => {
            const side = src.inputSource.handedness === "left" ? "left" : "right";
            const rig = new THREE.Group(); rig.matrixAutoUpdate = false; this.handHolder.add(rig);
            const h: Hand = { src, side, prev: null, speed: 0, trig: false, sq: false, a: false, b: false, x: false, y: false, stick: false, rig, mvel: new THREE.Vector3(), mprev: null, cheld: false, ctrig: false, mouse: false, cgrip: false, cprev: null };
            this.hands.set(side, h);
            this.dressHand(h);
            if (side === "left") src.onMotionControllerInitObservable.add(() => this.panel.attach(src));
        });
        xr.input.onControllerRemovedObservable.add((src) => {
            for (const [k, h] of this.hands) if (h.src === src) { this.handHolder.remove(h.rig); this.hands.delete(k); }
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

    /** eye height above the feet: your own, shrunk for a cat and a little taller for a gorilla */
    private get eyeH() { return this.cam.realWorldHeight || 1.6 * this.scale; }
    private get scale() { return this.catOn ? CAT_SCALE : this.gorOn ? GOR_SCALE : 1; }
    private applyScale() {
        const sm = this.xr.baseExperience.sessionManager as unknown as { worldScalingFactor?: number };
        // (Babylon multiplies the tracked head and hand positions by this, real height included: a cat's head is near the floor)
        if ("worldScalingFactor" in sm) sm.worldScalingFactor = this.scale;
    }

    /** Banana or Salmon: a gorilla is a bit bigger than you, with big hands */
    setGorilla(on: boolean) {
        if (on === this.gorOn) return;
        this.gorOn = on;
        if (on && this.catOn) this.setCat(false, this.catCoat!);
        this.applyScale();
        for (const h of this.hands.values()) this.dressHand(h);
    }
    /** become a cat (or not): shrink, and swap the hands for paws */
    setCat(on: boolean, coat: Coat) {
        this.catOn = on; this.catCoat = coat;
        if (on) this.gorOn = false;
        this.applyScale();
        for (const h of this.hands.values()) this.dressHand(h);
        this.player.clingHeld = false; this.player.pull.set(0, 0, 0);
    }
    private dressHand(h: Hand) {
        h.rig.clear();
        if (this.gorOn) { const g = buildGorillaHand(h.side === "left"); g.scale.setScalar(1.5); h.rig.add(g); }
        if (this.catOn && this.catCoat) { const p = buildPaw(this.catCoat, false); p.scale.setScalar(PAW_SCALE); if (h.side === "left") p.scale.x *= -1; h.rig.add(p); }
        h.cgrip = false; h.cprev = null;
        this.heldId = "__redress" as ItemId;      // the item in the hand is hidden for a gorilla or a cat: rebuild it
    }

    private placeRig(face = false) {
        const cam = this.cam;
        const h = this.eyeH;
        cam.position.set(this.player.pos.x, this.player.pos.y + h, this.player.pos.z);
        if (face) {
            // turn the play space so you face the way the player was facing
            const dy = this.player.yaw - this.headYaw();
            cam.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), dy).multiply(cam.rotationQuaternion ?? Quaternion.Identity());
        }
    }

    /** Before the player moves: sticks and buttons become the same inputs the keyboard produces; room-scale walking. */
    beforePlayer(dt: number) {
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
        let sx = axis(L, 2) || axis(L, 0), sy = axis(L, 3) || axis(L, 1);
        const len = Math.hypot(sx, sy), dead = 0.15;
        if (len > dead) { const k = Math.min(1, (len - dead) / (1 - dead)) / len; sx *= k; sy *= k; } else { sx = 0; sy = 0; }
        input.move.x = sx;
        input.move.y = -sy;
        const lGrip = btn(L, 1), lTrig = val(L, 0) > 0.6;

        // ---- painting a picture: walk with the left stick; the right hand is the brush, the left one picks from the palette
        if (this.paint.active) {
            if (R) {
                const ptr = R.src.pointer, d = ptr.getDirection(Vector3.Forward(true));
                const trig = val(R, 0), a = btn(R, 4), b = btn(R, 5);
                const lp = L?.src.pointer;
                this.paint.update({
                    o: ptr.absolutePosition, d,
                    po: lp ? lp.absolutePosition : null, pd: lp ? lp.getDirection(Vector3.Forward(true)) : null, pickDown: !!L && lTrig && !L.trig,
                    trig, trigDown: trig > 0.6 && !R.trig, undo: b && !R.b, swap: a && !R.a,
                    stick: axis(R, 3) || axis(R, 1), dt, haptic: (s) => this.pulse("right", s),
                });
                R.trig = trig > 0.6; R.a = a; R.b = b; R.sq = btn(R, 1);
                if (L) L.trig = lTrig;
            }
            this.endInput(dt, L, R);
            return;
        }
        // ---- the secret level (a floating screen): left stick runs left / right, A, B, X, Y or either trigger jumps, grip runs fast
        if (game.warp.inLevel) {
            const rawX = axis(L, 2) || axis(L, 0) || axis(R, 2) || axis(R, 0);
            input.move.x = Math.abs(rawX) > 0.2 ? rawX : 0; input.move.y = 0;
            input.jumpHeld = btn(R, 4) || btn(R, 5) || btn(L, 4) || btn(L, 5) || val(R, 0) > 0.5 || val(L, 0) > 0.5;
            input.sprint = btn(R, 1) || lGrip;
            input.attackQueued = input.interactQueued = false;
            this.endInput(dt, L, R);
            return;
        }
        // ---- the alien invasion: you sit in a laser cannon that points where you look; either trigger or any face button fires
        if (game.invaders.seated) {
            input.move.x = input.move.y = 0; input.jumpHeld = false; input.interactHeld = false; input.attackQueued = input.interactQueued = false;
            input.attackHeld = val(R, 0) > 0.5 || val(L, 0) > 0.5 || btn(R, 4) || btn(R, 5) || btn(L, 4) || btn(L, 5);
            this.snapTurn(R);
            this.endInput(dt, L, R);
            return;
        }
        // ---- driving a car or steering a boat: left stick steers, right trigger is gas, left trigger brakes / reverses
        if (game.under.air?.driving || game.boatHelm) {
            input.move.x = sx;
            input.move.y = Math.max(val(R, 0), -sy) - val(L, 0);
            input.sprint = lGrip;
            if (R) {
                const a = btn(R, 4), sq = btn(R, 1), b = btn(R, 5), used = a || sq;
                if (used && !(R.a || R.sq)) input.interactQueued = true;       // A / grip: get out
                input.interactHeld = used;
                input.jumpHeld = b;                                            // B: handbrake
                R.trig = val(R, 0) > 0.6; R.a = a; R.sq = sq; R.b = b;
            }
            this.vigK += (0.25 - this.vigK) * Math.min(1, dt * 2);
            this.endInput(dt, L, R);
            return;
        }

        // sprint: push the stick all the way, or hold the left grip (a cat's grips are claws instead)
        input.sprint = (lGrip && !this.catOn) || len > 0.97;
        // in deep water the left trigger takes you down (B brings you up); look where you want to swim
        input.diveVR = !game.under.camp?.active && !this.catOn && lTrig;

        // right stick: snap turn (x) and hotbar (y)
        this.snapTurn(R);
        const ry = axis(R, 3) || axis(R, 1);
        if (Math.abs(ry) < 0.35) this.slotArmed = true;
        else if (this.slotArmed && Math.abs(ry) > 0.75) { this.slotArmed = false; input.hotbarDelta += ry > 0 ? 1 : -1; }

        // buttons
        const camp = game.under.camp?.active ? game.under.camp : null;
        if (R) {
            const trig = val(R, 0) > 0.6, sq = btn(R, 1), a = btn(R, 4), b = btn(R, 5);
            const used = this.catOn ? a : sq || a;
            if (trig && !R.trig && !this.panel.pointerBusy) {
                if (game.stats.dead) game.respawn();
                else if (camp) { if (!this.campHand(R, true)) game.vrPrimary(false); }
                else if (!this.catOn) game.vrPrimary(false);
            } else if (!trig && R.trig && camp) this.campHand(R, false);
            // right stick click: the map (with friends and pings)
            const rs = btn(R, 3);
            if (rs && !R.stick && !game.stats.dead) this.panel.toggle("map");
            R.stick = rs;
            if (used && !(R.a || R.sq)) input.interactQueued = true;
            input.interactHeld = used;
            if (b && !R.b) input.jumpQueued = true;
            input.jumpHeld = b;
            R.trig = trig; R.sq = sq; R.a = a; R.b = b;
        }
        if (L && game.equipped?.id === "guitar") {
            // holding the guitar: X, Y and the left trigger are the chord fingers (8 chords), nothing else
            const x = btn(L, 4), y = btn(L, 5);
            game.guitar.chord = (x ? 1 : 0) | (y ? 2 : 0) | (lTrig ? 4 : 0);
            L.x = x; L.y = y;
        } else if (L) {
            const x = btn(L, 4), y = btn(L, 5), stick = btn(L, 3);
            const def = game.equippedDef;
            if (x && !L.x) {
                if (this.catOn) input.meowQueued = true;
                // anything being placed (furniture, a building piece, a boat): X turns it; otherwise it opens crafting
                else if (def?.kind === "plan" || (def?.kind === "placeable" && (def.place !== "torch" || game.torchPlacing)) || def?.boat) input.rotateQueued++;
                else if (!game.stats.dead) this.panel.open("craft");
            }
            if (y && !L.y) {
                if (def?.id === "torch") input.modeQueued = true;
                else input.cycleDelta++;
            }
            if (stick && !L.stick) this.panel.toggle("bag");
            L.x = x; L.y = y; L.stick = stick;
        }
        if (this.catOn) { this.catPull(L, R, lGrip, btn(R, 1)); this.catMouse(L, R, lTrig, val(R, 0) > 0.6, dt); }
        if (camp && L) {
            if (lTrig && !L.ctrig) this.campHand(L, true); else if (!lTrig && L.ctrig) this.campHand(L, false);
            L.ctrig = lTrig;
        }
        // comfort vignette: grows with stick use and turning, fades back
        const target = Math.min(1, Math.hypot(input.move.x, input.move.y)) * 0.55 + (this.turnArmed ? 0 : 0.6);
        this.vigK += (target - this.vigK) * Math.min(1, dt * (target > this.vigK ? 10 : 3));
        this.endInput(dt, L, R);
    }

    /** the end of every input frame: no mouse look in a headset, hand velocities, the comfort vignette */
    private endInput(dt: number, L: Hand | null, R: Hand | null) {
        this.input.lookDX = this.input.lookDY = 0;
        this.player.pitch = 0;
        this.trackHands(L, R, dt);
        const ip = this.pipeline ? this.pipeline.imageProcessing : this.scene.imageProcessingConfiguration;
        if (ip) { ip.vignetteEnabled = true; ip.vignetteWeight = this.vig0 + this.vigK * 4; }
    }

    private snapTurn(R: Hand | null) {
        const rx = axis(R, 2) || axis(R, 0);
        if (Math.abs(rx) < 0.35) this.turnArmed = true;
        else if (this.turnArmed && Math.abs(rx) > 0.75) {
            this.turnArmed = false;
            const a = rx > 0 ? -SNAP : SNAP, cam = this.cam;
            // turn about the head, not the play-space origin
            const head = cam.position.clone();
            cam.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), a).multiply(cam.rotationQuaternion ?? Quaternion.Identity());
            cam.position.copyFrom(head);
            this.yawOffset += a;
            for (const h of this.hands.values()) h.prev = null;
        }
    }

    private gripPos(h: Hand, out: THREE.Vector3) { const g = (h.src.grip ?? h.src.pointer).absolutePosition; return out.set(g.x, g.y, g.z); }
    /** hand world velocity (smoothed), for throwing things */
    private trackHands(L: Hand | null, R: Hand | null, dt: number) {
        for (const h of [L, R]) {
            if (!h) continue;
            this.gripPos(h, _v);
            if (h.mprev && dt > 0) { _gd.copy(_v).sub(h.mprev).divideScalar(Math.max(dt, 1 / 120)); if (_gd.length() < 30) h.mvel.lerp(_gd, 0.45); }
            (h.mprev ??= new THREE.Vector3()).copy(_v);
        }
    }
    /** Banana or Salmon: a trigger squeezed (down) or let go near something you can pick up; returns true when it did something */
    private campHand(h: Hand, down: boolean): boolean {
        const camp = this.game.under.camp; if (!camp) return false;
        this.gripPos(h, _v);
        if (down) { const ok = camp.vrGrab(_v, true, h.mvel); h.cheld = ok; if (ok) this.pulse(h.side, 0.5); return ok; }
        if (h.cheld) { h.cheld = false; camp.vrGrab(_v, false, h.mvel.clone().multiplyScalar(this.catOn ? 0.6 : 1)); this.pulse(h.side, 0.2); return true; }
        return false;
    }
    /** the hand that holds things (the right one if there is one): world position */
    handPos(out: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }): boolean {
        if (!this.active) return false;
        const hs = [...this.hands.values()];
        const h = hs.find((x) => x.cheld) ?? this.hands.get("right") ?? this.hands.get("left"); if (!h) return false;
        this.gripPos(h, _v); out.set(_v.x, _v.y, _v.z); return true;
    }
    /** cat house: squeeze a trigger with a paw on the mouse to pick it up, let go while swinging to throw it */
    private catMouse(L: Hand | null, R: Hand | null, lTrig: boolean, rTrig: boolean, _dt: number) {
        const cat = this.game.under.cat; if (!cat?.active) return;
        for (const [h, t] of [[L, lTrig], [R, rTrig]] as const) {
            if (!h) continue;
            this.gripPos(h, _v);
            const pv = h.mvel;
            if (t && !h.mouse && !cat.mouseMine && cat.canGrab(_v.x, _v.y, _v.z)) { cat.grabMouse(); h.mouse = true; this.pulse(h.side, 0.5); }
            if (h.mouse) {
                if (t && cat.mouseMine) cat.holdMouse(_v.x, _v.y, _v.z);
                else {
                    if (cat.mouseMine) { cat.throwMouse(pv.x * THROW_GAIN, pv.y * THROW_GAIN + 0.6, pv.z * THROW_GAIN); this.pulse(h.side, 0.3); }
                    h.mouse = false;
                }
            }
        }
    }
    /** I Am Cat style: squeeze a grip to dig the claws in, then pull the paw towards you to drag the body along (or up a post) */
    private catPull(L: Hand | null, R: Hand | null, lGrip: boolean, rGrip: boolean) {
        const { player } = this;
        player.pull.set(0, 0, 0);
        player.clingHeld = lGrip || rGrip;
        const cam = this.cam;
        for (const [h, g] of [[L, lGrip], [R, rGrip]] as const) {
            if (!h) continue;
            // the paw relative to the head, so walking does not count as a pull
            const p = (h.src.grip ?? h.src.pointer).absolutePosition.subtract(cam.position);
            if (g && h.cgrip && h.cprev) {
                player.pull.x += (h.cprev.x - p.x) * PULL_GAIN;
                player.pull.z += (h.cprev.z - p.z) * PULL_GAIN;
                player.pull.y += (h.cprev.y - p.y) * PULL_GAIN;
            }
            h.cprev = p;
            if (g && !h.cgrip) this.pulse(h.side, 0.2);
            h.cgrip = g;
        }
        // sanity: one frame never drags further than a sprint would (a tracking glitch must not fling you)
        const lim = 0.25, m = Math.hypot(player.pull.x, player.pull.z);
        if (m > lim) { player.pull.x *= lim / m; player.pull.z *= lim / m; }
        player.pull.y = Math.max(-0.2, Math.min(0.2, player.pull.y));
    }

    /** After the player moves: put the headset on the body, read the right hand for aim and swings. */
    afterPlayer(dt: number) {
        if (!this.active) return;
        const { game, player } = this;
        const cam = this.cam;
        cam.position.set(player.pos.x, player.pos.y + this.eyeH, player.pos.z);
        player.eye.copyFrom(cam.position);
        // the game reads the headset's own position and gaze (the warp level's screen, the invasion cannon, sound)
        game.vr.head = cam.position;
        game.vr.headDir = cam.getDirection(Vector3.Forward(true));
        // the hand extras follow the grips
        for (const hd of this.hands.values()) { hd.rig.matrix.fromArray((hd.src.grip ?? hd.src.pointer).getWorldMatrix().m as unknown as number[]); hd.rig.matrixWorldNeedsUpdate = true; }
        this.handHolder.updateMatrixWorld();
        this.handMirror.sync();

        const R = this.hands.get("right") ?? null, L = this.hands.get("left") ?? null;
        const heldId = game.equipped?.id ?? null;
        // the guitar is held by the neck in the left hand, so the right hand is free to strum; gorillas and cats hold nothing
        const guitar = heldId === "guitar" && !!L && !!R && !this.catOn;
        const id = guitar || this.catOn || this.gorOn ? null : heldId;
        this.setHeld(R, id);
        this.setGuitar(guitar ? L : null);
        if (guitar && this.strumZone && R) {
            this.zone3.matrix.fromArray(this.strumZone.getWorldMatrix().m as unknown as number[]);
            const g = R.src.grip ?? R.src.pointer, fwd = g.getDirection(Vector3.Forward(true));
            // (a little out along the fingers)
            const at = g.absolutePosition.add(fwd.scale(0.07));
            const hit = game.guitar.track(dt, this.zone3, _v.set(at.x, at.y, at.z), new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z));
            if (hit > 0) this.pulse("right", 0.12 + 0.3 * hit);
        } else if (heldId === "guitar") game.guitar.reset();
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

    /** the guitar in the left hand (null: none) */
    private setGuitar(L: Hand | null) {
        if (!L) { if (this.guitar) { disposeBaked(this.guitar); this.guitar = null; this.strumZone = null; } return; }
        if (this.guitar?.parent) return;
        const b = bakeGroup("vrGuitar", heldModel("guitar"), this.scene, (k) => {
            const map: Record<string, [string, number, number]> = { handle: ["#8b5e34", 0.85, 0], steel: ["#d8d2c4", 0.3, 0.6], soot: ["#0d0b0a", 1, 0] };
            const m = map[k] ?? [ITEM_COLOR.guitar ?? "#b5763a", 0.6, 0];
            return solid(this.scene, m[0], m[1], m[2]);
        }, false);
        this.guitar = b.node;
        this.guitar.parent = L.src.grip ?? L.src.pointer;
        // the neck points forward out of the fist, the strings face up, the body rests towards you
        this.guitar.position.set(0, 0, -0.18);
        this.guitar.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2).multiply(Quaternion.RotationAxis(Vector3.Up(), Math.PI));
        this.strumZone = new TransformNode("vrStrum", this.scene);
        this.strumZone.parent = this.guitar;
        this.strumZone.position.set(0, -0.53, -0.05);
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
