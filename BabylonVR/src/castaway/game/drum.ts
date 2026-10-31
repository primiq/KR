// The drum: press E at a placed drum to take up the sticks; click (HIT on a phone) to strike it, holding the press a
// moment longer for a harder blow. In a headset you hit it for real with a stick in each hand: how fast the stick comes
// down is how hard the hit. Everybody nearby hears it (the room is told where and how hard).
import type { Sfx } from "./audio";
import type { Structure } from "./structures";

export interface DrumHit { x: number; y: number; z: number; v: number }
/** how far a drum carries (m) */
const HEAR = 80;

export class Drum {
    /** the drum you are playing (null: the sticks are put away) */
    active: Structure | null = null;
    /** the room is told about each hit (set by the network) */
    onHit: ((e: DrumHit) => void) | null = null;
    private bounce = new Map<Structure, number>();
    /** when the press being held began (seconds; -1: none), for a harder hit when it is let go */
    hold = -1;

    constructor(private readonly sfx: Sfx) {}

    /** a hit of strength `v` (0..1) */
    strike(s: Structure, v: number) {
        v = Math.max(0.05, Math.min(1, v));
        this.sfx.bigDrum(v);
        this.kick(s, v);
        this.onHit?.({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), v: +v.toFixed(2) });
    }
    /** somebody else hit a drum: hear it (fainter far off) and see the drum jump */
    remote(e: DrumHit, listener: { x: number; y: number; z: number }, drums: Structure[]) {
        const d = Math.hypot(listener.x - e.x, listener.y - e.y, listener.z - e.z);
        if (d < HEAR) this.sfx.bigDrum(e.v, Math.max(0, 1 - d / HEAR) ** 1.5);
        const s = drums.find((q) => q.kind === "drum" && Math.hypot(q.x - e.x, q.z - e.z) < 0.3);
        if (s) this.kick(s, e.v);
    }
    private kick(s: Structure, v: number) { this.bounce.set(s, Math.max(this.bounce.get(s) ?? 0, 0.4 + 0.6 * v)); }

    /** the drums shiver after a hit */
    update(dt: number) {
        for (const [s, b] of this.bounce) {
            const nb = b * Math.exp(-dt * 9);
            const w = Math.sin(performance.now() * 0.06) * nb;
            s.node.scaling.set(1 + 0.012 * w, 1 - 0.03 * nb, 1 + 0.012 * w);
            if (nb < 0.01) { s.node.scaling.set(1, 1, 1); this.bounce.delete(s); } else this.bounce.set(s, nb);
        }
    }
}
