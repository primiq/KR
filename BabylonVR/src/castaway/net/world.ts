// Serialising the world and the player's own character. Used for the multiplayer join snapshot and for saving.
import type { PieceKind } from "../game/building";
import type { Game } from "../game/game";
import type { Inventory } from "../game/inventory";
import type { ItemId, PlaceKind } from "../game/items";

type SlotRow = [string, number, number | undefined] | null;
export const packInv = (inv: Inventory | null): SlotRow[] | null => (inv ? inv.slots.map((s) => (s ? [s.id, s.count, s.dur] : null)) : null);
export const unpackInv = (inv: Inventory, rows: SlotRow[]) => {
    inv.slots = inv.slots.map((_, i) => {
        const r = rows[i];
        return r ? { id: r[0] as ItemId, count: r[1], ...(r[2] !== undefined && r[2] !== null ? { dur: r[2] } : {}) } : null;
    });
    inv.emit();
};

/** Everything that has changed in the shared world since the island was generated. */
export function captureWorld(g: Game) {
    const r = g.resources;
    const nodes: number[][] = [];
    r.nodeList.forEach((n, i) => {
        if (n.pool !== undefined) return;
        if (n.depleted) nodes.push([i, 0, +r.respawnIn(n).toFixed(0)]);
        else if (n.left < n.total) nodes.push([i, +n.left.toFixed(2), 0]);
    });
    return {
        nodes,
        pickups: [...r.pickups.items].map((p) => [p.nid, p.id, p.count, p.dur ?? null, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]),
        pieces: [...g.building.pieces].map((p) => [p.kind, p.i, p.j, p.axis, +p.H.toFixed(3), p.L, p.dir]),
        build: g.building.captureExtras(),
        cave: g.under.capture(),
        turtles: g.turtles.capture(),
        flowers: g.flowers.capture(),
        plants: g.saplings.capture(),
        doors: g.doors.capture(),
        paintings: g.paintings.capture(),
        boats: g.boats.capture(),
        structs: g.structures.list.map((s) => [s.nid, s.kind, +s.x.toFixed(2), +s.y.toFixed(3), +s.z.toFixed(2), +s.yaw.toFixed(3), +s.fuel.toFixed(1), s.lit ? 1 : 0, +s.prog.toFixed(1), packInv(s.inv)]),
    };
}

export function placeStruct(g: Game, row: any[]) {
    const [nid, kind, x, yIn, z, yaw, fuel, lit, prog, inv] = row;
    const y = yIn < -100 ? g.structures.ground(x, z) : yIn;
    const s = g.structures.place(kind as PlaceKind, { ok: true, reason: "", x, y, z, yaw }, nid, true);
    if (!s) return;
    s.fuel = fuel;
    s.lit = !!lit;
    s.prog = prog;
    if (inv && s.inv) unpackInv(s.inv, inv);
}

export function applyWorld(g: Game, snap: any) {
    if (!snap) return;
    const r = g.resources;
    r.pickups.clear();
    for (const [nid, id, c, d, x, y, z] of snap.pickups ?? []) r.pickups.spawn(id, c, x, y, z, d ?? undefined, nid, true);
    for (const [i, left, rin] of snap.nodes ?? []) { const n = r.nodeAt(i); if (n) r.restoreNode(n, left, rin); }
    for (const [t, i, j, a, H, L, d] of snap.pieces ?? []) g.building.placeRemote(t as PieceKind, i, j, a, H, L ?? 0, d ?? 0);
    for (const s of [...g.structures.list]) g.structures.remove(s, true);
    for (const row of snap.structs ?? []) placeStruct(g, row);
    if (snap.build) g.building.restoreExtras(snap.build);
    g.under.restore(snap.cave);
    if (snap.turtles) g.turtles.restore(snap.turtles);
    if (snap.flowers) g.flowers.restore(snap.flowers);
    if (snap.plants) g.saplings.restore(snap.plants);
    if (snap.doors) g.doors.restore(snap.doors);
    if (snap.paintings) g.paintings.restore(snap.paintings);
    if (snap.boats) g.boats.restore(snap.boats);
}

/** The local player's own stuff. */
export function captureChar(g: Game) {
    const p = g.player, s = g.stats;
    return {
        pos: [+p.pos.x.toFixed(2), +p.pos.z.toFixed(2), +p.yaw.toFixed(3)],
        stats: [s.health, s.hunger, s.thirst, s.stamina].map((v) => +v.toFixed(1)),
        inv: packInv(g.inv),
        worn: packInv(g.worn),
        bed: g.bedNid,
    };
}

export function applyChar(g: Game, c: any) {
    if (!c) return;
    const s = g.stats;
    [s.health, s.hunger, s.thirst, s.stamina] = c.stats;
    unpackInv(g.inv, c.inv);
    g.worn.clear();
    if (c.worn) unpackInv(g.worn, c.worn);
    g.player.respawn(c.pos[0], c.pos[1], c.pos[2]);
    g.setBedByNid(c.bed);
}
