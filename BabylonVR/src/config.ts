/** Remote fallbacks used when `npm run fetch-assets` has not been run. */
const REMOTE_SPONZA = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Sponza/glTF/";
const REMOTE_ENV = "https://raw.githubusercontent.com/BabylonJS/Assets/master/environments/sanGiuseppeBridge.env";

export const Assets = {
    sponza: { local: "assets/sponza/", remote: REMOTE_SPONZA, file: "Sponza.gltf" },
    environment: { local: "assets/env/sanGiuseppeBridge.env", remote: REMOTE_ENV },
    /** "Forest Slope" HDRI by Poly Haven (CC0), mirrored in pmndrs/drei-assets. */
    forestHdr: { local: "assets/env/forest_slope_1k.hdr", remote: "https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/forest_slope_1k.hdr" },
    sand: { local: "assets/island/sand.jpg", remote: "https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/sand.jpg" },
    rockColor: { local: "assets/island/rockyGround_basecolor.png", remote: "https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/rockyGround_basecolor.png" },
    rockNormal: { local: "assets/island/rockyGround_normal.png", remote: "https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/rockyGround_normal.png" },
    waterBump: { local: "assets/forest/waterbump.png", remote: "https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/waterbump.png" },
};

/** Physics collision layers (Havok shape filters). */
export const Layer = {
    STATIC: 1 << 0,
    DYNAMIC: 1 << 1,
    PLAYER: 1 << 2,
    HAND: 1 << 3,
    HELD: 1 << 4,
} as const;

export const ALL_LAYERS = 0xffffffff;

export const Player = {
    radius: 0.25,
    standHeight: 1.8,
    crouchHeight: 1.0,
    /** Eye position below the top of the capsule. */
    eyeFromTop: 0.12,
    walkSpeed: 3.0,
    sprintSpeed: 5.5,
    crouchSpeed: 1.6,
    jumpSpeed: 4.7,
    airControl: 0.35,
    gravity: -9.81,
    /** Vertical drop applied to the XR head when the "virtual crouch" button is held. */
    vrVirtualCrouch: 0.6,
    snapTurnDegrees: 30,
    /** Feet this far below the surface and you start floating/swimming (eyes stay just above water). */
    swimDepth: 1.4,
    swimSpeedFactor: 0.55,
};

export const Interaction = {
    /** Max distance from a controller grip to a body surface to grab it. */
    grabRadius: 0.09,
    /** Max distance between a hand pinch point and body surface to grab it. */
    pinchRadius: 0.05,
    /** Thumb-index distance under which a pinch is detected. */
    pinchStart: 0.022,
    pinchEnd: 0.045,
    throwBoost: 1.35,
    desktopReach: 3.5,
    desktopHoldDistance: 1.4,
    desktopThrowSpeed: 14,
    remoteGrabRange: 15,
};

export function isProbablyHeadset(): boolean {
    return /OculusBrowser|Quest|Pico|Vive|Wolvic|VisionOS|Android.*VR/i.test(navigator.userAgent);
}
