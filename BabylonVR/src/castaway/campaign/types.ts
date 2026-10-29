import type * as THREE from 'three';
import type { Space } from './space';
import type { Species } from './grab';
import type { Sfx } from '../game/audio';
import type { Player } from '../world/player';
import type { SayOpts } from '../game/narrator';

export type { Species };
/** another player, as the campaign sees them */
export interface Other { id: number; name: string; x: number; y: number; z: number; yaw: number; flags: number; hand: THREE.Vector3 | null }

/** what a mission gets from the campaign */
export interface Ctx {
  me(): number;
  species(): Species;
  /** true when nobody in this area is that species: the solo "helper" rules let the others do that species' jobs */
  helper(sp: Species): boolean;
  /** everybody else in this area */
  others(): Other[];
  speciesOf(id: number): Species | null;
  send(e: any): void;
  narrate(id: string, o?: SayOpts): void;
  /** play a line here and for everybody else in this area */
  narrateAll(id: string, o?: SayOpts): void;
  say(t: string): void;
  sfx: Sfx;
  player: Player;
  /** am I the one who drives shared timing here (lowest id in this area)? */
  controller(): boolean;
  /** the mission was won: time and how often somebody got caught are scored */
  complete(caught: number): void;
  /** where my hand (VR) or my carrying spot is, in world coordinates */
  carry(out: THREE.Vector3): void;
  haptic(v: number): void;
  inVR(): boolean;
}

export type MTarget = { w: string; [k: string]: any };
export interface Mission {
  readonly index: number;
  readonly space: Space;
  readonly group: THREE.Group;
  /** a new run (everybody in it resets the level the same way) */
  begin(rid: number, ctx: Ctx): void;
  /** put the local player at the start */
  enter(): void;
  leave(): void;
  /** aim (world eye) */
  pick(eye: THREE.Vector3, dir: THREE.Vector3, reach: number, assist: number): { t: MTarget; dist: number } | null;
  prompt(t: MTarget): { name: string; hint: string; ok: boolean };
  /** E / A: 'exit' leaves for the hub */
  interact(t: MTarget): 'exit' | null;
  /** click / trigger: return true when used */
  click(t: MTarget | null): boolean;
  /** VR: a trigger squeeze or release at a hand (world position, world velocity on release) */
  vrGrab?(pos: THREE.Vector3, down: boolean, vel: THREE.Vector3): boolean;
  net(e: any, from: number): void;
  update(dt: number, time: number): void;
  /** a darkened area where cats see better (night vision) */
  readonly dark?: boolean;
  /** the line to say at the end, before the medal */
  readonly outro: string;
}
