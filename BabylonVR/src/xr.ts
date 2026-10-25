import {
    type AbstractMesh,
    Quaternion,
    type Scene,
    Vector3,
    type WebXRAbstractMotionController,
    type WebXRControllerComponent,
    type WebXRDefaultExperience,
    WebXRFeatureName,
    type WebXRHand,
    WebXRHandJoint,
    type WebXRHandTracking,
    type WebXRInputSource,
    WebXRState,
} from "@babylonjs/core";
import { Interaction as I } from "./config";
import { type InteractionSystem, KinematicCollider, type Manipulator } from "./interaction";
import type { PlayerController } from "./player";

const TIP_JOINTS = [
    WebXRHandJoint.THUMB_TIP,
    WebXRHandJoint.INDEX_FINGER_TIP,
    WebXRHandJoint.MIDDLE_FINGER_TIP,
    WebXRHandJoint.RING_FINGER_TIP,
    WebXRHandJoint.PINKY_FINGER_TIP,
    WebXRHandJoint.INDEX_FINGER_PHALANX_DISTAL,
    WebXRHandJoint.MIDDLE_FINGER_PHALANX_DISTAL,
];

interface ControllerState {
    source: WebXRInputSource;
    handedness: XRHandedness;
    manipulator: Manipulator;
    colliders: KinematicCollider[];
    mc?: WebXRAbstractMotionController;
    squeeze?: WebXRControllerComponent | null;
    trigger?: WebXRControllerComponent | null;
    stick?: WebXRControllerComponent | null;
    a?: WebXRControllerComponent | null;
    b?: WebXRControllerComponent | null;
    grabbedWith: "none" | "squeeze" | "trigger" | "pinch" | "fist";
    stickWasCentered: boolean;
    triggerWasDown: boolean;
    pinchStarted: number;
    palmHistory: Array<{ t: number; y: number }>;
}

export interface XRCallbacks {
    onEnter(): void;
    onExit(): void;
    onToggleMenu(): void;
    onReset(): void;
    /** True while the controller's pointer is over the VR menu (so triggers don't grab). */
    isPointerOverUI(controllerId: string): boolean;
}

/**
 * WebXR: immersive VR session, smooth locomotion via thumbsticks, snap turn, jump/crouch buttons,
 * grab/throw with grips, remote "force grab" with triggers, and full articulated hand tracking
 * with pinch/fist grabs and kinematic fingertip colliders for poking and pushing.
 */
export class XRSystem {
    readonly states = new Map<string, ControllerState>();
    private hands: WebXRHandTracking | null = null;

    constructor(
        readonly xr: WebXRDefaultExperience,
        private readonly scene: Scene,
        private readonly player: PlayerController,
        private readonly interaction: InteractionSystem,
        private readonly callbacks: XRCallbacks,
    ) {
        const base = xr.baseExperience;
        this.hands = base.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING) as WebXRHandTracking | null;

        base.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                player.attachXR(base.camera);
                const sm = base.sessionManager;
                if (sm.isFixedFoveationSupported) sm.fixedFoveation = 0.5;
                callbacks.onEnter();
            } else if (state === WebXRState.NOT_IN_XR) {
                player.attachXR(null);
                interaction.releaseAll();
                callbacks.onExit();
            }
        });

        xr.input.onControllerAddedObservable.add((source) => this.addController(source));
        xr.input.onControllerRemovedObservable.add((source) => this.removeController(source));
        scene.onBeforePhysicsObservable.add(() => this.update());
    }

    get inXR(): boolean {
        return this.xr.baseExperience.state === WebXRState.IN_XR;
    }

    async enter(): Promise<void> {
        await this.xr.baseExperience.enterXRAsync("immersive-vr", "local-floor", this.xr.renderTarget);
    }

    // ---------------------------------------------------------------------------

    private addController(source: WebXRInputSource): void {
        const handedness = source.inputSource.handedness;
        const isHand = !!source.inputSource.hand;
        const colliders = isHand
            ? [...TIP_JOINTS.map((_, i) => new KinematicCollider(this.scene, `${handedness}Tip${i}`, 0.011)), new KinematicCollider(this.scene, `${handedness}Palm`, 0.04)]
            : [new KinematicCollider(this.scene, `${handedness}Ctrl`, 0.045)];
        const state: ControllerState = {
            source,
            handedness,
            manipulator: this.interaction.create(`${handedness}-${isHand ? "hand" : "ctrl"}`),
            colliders,
            grabbedWith: "none",
            stickWasCentered: true,
            triggerWasDown: false,
            pinchStarted: 0,
            palmHistory: [],
        };
        this.states.set(source.uniqueId, state);

        source.onMotionControllerInitObservable.add((mc) => {
            state.mc = mc;
            state.squeeze = mc.getComponentOfType("squeeze");
            state.trigger = mc.getComponentOfType("trigger");
            state.stick = mc.getComponentOfType("thumbstick") ?? mc.getComponentOfType("touchpad");
            state.a = mc.getComponent("a-button") ?? mc.getComponent("x-button");
            state.b = mc.getComponent("b-button") ?? mc.getComponent("y-button");
            state.a?.onButtonStateChangedObservable.add((c) => {
                if (!c.changes.pressed?.current) return;
                if (handedness === "right") this.player.input.jump = true;
                else this.callbacks.onReset();
            });
            state.b?.onButtonStateChangedObservable.add((c) => {
                if (handedness === "left" && c.changes.pressed?.current) this.callbacks.onToggleMenu();
            });
        });
    }

    private removeController(source: WebXRInputSource): void {
        const state = this.states.get(source.uniqueId);
        if (!state) return;
        state.manipulator.release();
        state.colliders.forEach((c) => c.dispose());
        this.states.delete(source.uniqueId);
    }

    private update(): void {
        if (!this.inXR) return;
        const input = this.player.input;
        input.move.set(0, 0);
        input.crouch = false;
        input.sprint = false;
        let jumpVotes = 0;

        for (const state of this.states.values()) {
            const hand = state.source.inputSource.hand ? this.hands?.getHandByControllerId(state.source.uniqueId) : null;
            if (hand) {
                if (this.updateHand(state, hand)) jumpVotes++;
            } else {
                this.updateController(state);
            }
        }
        // Hands-only jump: both palms flicked upwards at the same time.
        if (jumpVotes >= 2) input.jump = true;
    }

    private updateController(state: ControllerState): void {
        const node: AbstractMesh = state.source.grip ?? state.source.pointer;
        const m = state.manipulator;
        m.position.copyFrom(node.absolutePosition);
        m.rotation.copyFrom(node.absoluteRotationQuaternion);
        state.colliders[0].moveTo(m.position, m.rotation);

        const input = this.player.input;
        const stick = state.stick;
        if (stick) {
            const { x, y } = stick.axes;
            if (state.handedness === "left") {
                const dead = 0.12;
                const len = Math.hypot(x, y);
                if (len > dead) input.move.set(x, -y).scaleInPlace(Math.min(1, (len - dead) / (1 - dead)) / len);
                input.sprint = stick.pressed;
            } else {
                if (Math.abs(x) > 0.75 && state.stickWasCentered) {
                    input.snapTurn = Math.sign(x);
                    state.stickWasCentered = false;
                } else if (Math.abs(x) < 0.35) {
                    state.stickWasCentered = true;
                }
                if (y > 0.7) input.crouch = true; // pull back to crouch
            }
        }
        if (state.handedness === "right" && state.b?.pressed) input.crouch = true;

        // Grip: grab what's touching the controller.
        const squeezing = !!state.squeeze?.pressed;
        const triggering = (state.trigger?.value ?? 0) > 0.6;
        const triggerPressed = triggering && !state.triggerWasDown;
        state.triggerWasDown = triggering;
        if (state.grabbedWith === "none") {
            if (squeezing) {
                const g = this.interaction.nearest(m.position, I.grabRadius);
                if (g) this.grab(state, g, "squeeze");
            } else if (triggerPressed && !this.callbacks.isPointerOverUI(state.source.uniqueId)) {
                const near = this.interaction.nearest(m.position, I.grabRadius);
                if (near) {
                    this.grab(state, near, "trigger");
                } else {
                    // Force-grab along the pointer ray.
                    const ray = state.source.pointer;
                    const hit = this.interaction.raycast(ray.absolutePosition, ray.forward, I.remoteGrabRange);
                    if (hit) this.grab(state, hit.grabbable, "trigger", true);
                }
            }
        } else if ((state.grabbedWith === "squeeze" && !squeezing) || (state.grabbedWith === "trigger" && (state.trigger?.value ?? 0) < 0.3) || !m.held) {
            this.release(state);
        }
        state.colliders[0].setEnabled(!m.held);
    }

    /** Returns true when this hand votes for a jump (fast upward palm flick). */
    private updateHand(state: ControllerState, hand: WebXRHand): boolean {
        const joint = (j: WebXRHandJoint) => hand.getJointMesh(j);
        const thumb = joint(WebXRHandJoint.THUMB_TIP).absolutePosition;
        const index = joint(WebXRHandJoint.INDEX_FINGER_TIP).absolutePosition;
        const palmMesh = joint(WebXRHandJoint.MIDDLE_FINGER_METACARPAL);
        const palm = palmMesh.absolutePosition;
        const wrist = joint(WebXRHandJoint.WRIST);

        TIP_JOINTS.forEach((j, i) => state.colliders[i].moveTo(joint(j).absolutePosition));
        state.colliders[TIP_JOINTS.length].moveTo(palm, palmMesh.absoluteRotationQuaternion);

        const pinchDist = Vector3.Distance(thumb, index);
        const curl =
            (Vector3.Distance(joint(WebXRHandJoint.MIDDLE_FINGER_TIP).absolutePosition, palm) +
                Vector3.Distance(joint(WebXRHandJoint.RING_FINGER_TIP).absolutePosition, palm) +
                Vector3.Distance(joint(WebXRHandJoint.PINKY_FINGER_TIP).absolutePosition, palm)) /
            3;
        const m = state.manipulator;
        const pinchPoint = thumb.add(index).scaleInPlace(0.5);
        m.rotation.copyFrom(wrist.absoluteRotationQuaternion ?? Quaternion.Identity());

        const now = performance.now();
        if (state.grabbedWith === "none") {
            if (pinchDist < I.pinchStart) {
                m.position.copyFrom(pinchPoint);
                const g = this.interaction.nearest(pinchPoint, I.pinchRadius);
                if (g) {
                    this.grab(state, g, "pinch");
                } else if (state.handedness === "left") {
                    // Long empty pinch on the left hand toggles the menu.
                    if (!state.pinchStarted) state.pinchStarted = now;
                    else if (now - state.pinchStarted > 800) {
                        this.callbacks.onToggleMenu();
                        state.pinchStarted = Number.POSITIVE_INFINITY;
                    }
                }
            } else {
                if (pinchDist > I.pinchEnd) state.pinchStarted = 0;
                if (curl < 0.065) {
                    m.position.copyFrom(palm);
                    const g = this.interaction.nearest(palm, 0.09);
                    if (g) this.grab(state, g, "fist");
                }
            }
        } else {
            m.position.copyFrom(state.grabbedWith === "pinch" ? pinchPoint : palm);
            if ((state.grabbedWith === "pinch" && pinchDist > I.pinchEnd) || (state.grabbedWith === "fist" && curl > 0.085) || !m.held) {
                this.release(state);
            }
        }

        // Jump vote: palm moving upward faster than 1.6 m/s while empty-handed.
        const t = now / 1000;
        state.palmHistory.push({ t, y: palm.y - this.player.footY });
        while (state.palmHistory.length > 2 && t - state.palmHistory[0].t > 0.12) state.palmHistory.shift();
        const h = state.palmHistory;
        const vy = h.length > 1 ? (h[h.length - 1].y - h[0].y) / Math.max(1e-3, h[h.length - 1].t - h[0].t) : 0;
        return !m.held && vy > 1.6;
    }

    private grab(state: ControllerState, g: Parameters<Manipulator["grab"]>[0], how: ControllerState["grabbedWith"], remote = false): void {
        state.manipulator.grab(g, remote);
        state.grabbedWith = how;
        void state.mc?.pulse(0.6, 40);
    }

    private release(state: ControllerState): void {
        state.manipulator.release();
        state.grabbedWith = "none";
        void state.mc?.pulse(0.25, 20);
    }
}
