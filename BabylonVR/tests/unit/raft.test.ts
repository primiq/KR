// The sea is kept off a raft's deck with a few boxes (Raft.cover): they must cover every tile and nothing else, or the
// open water beside an L-shaped raft gets a hole in it.
import { describe, expect, it } from 'vitest';
import { Raft } from '../../src/castaway/world/boat';

const area = (rs: { x0: number; x1: number; z0: number; z1: number }[]) => rs.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);

describe('Raft.cover', () => {
  for (const [name, tiles, most] of [
    ['one tile', ['0,0'], 1],
    ['a long raft', ['0,0', '0,1', '0,2'], 1],
    ['an L', ['0,0', '0,1', '0,2', '1,2'], 2],
    ['a wide raft with a nose', ['-1,0', '0,0', '1,0', '-1,1', '0,1', '1,1', '0,2'], 2],
    ['a ring', ['0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2'], 4],
  ] as [string, string[], number][]) {
    it(name, () => {
      const set = new Set(tiles), rs = Raft.cover(set);
      expect(rs.length).toBeLessThanOrEqual(most);
      // every tile centre inside exactly one box, and the boxes' area is the tiles' area (nothing beside the raft)
      const one = new Raft([['t', 0, 0]]); const size = one.x1 - one.x0;
      for (const k of tiles) { const [i, j] = k.split(',').map(Number); expect(rs.filter((r) => i * size > r.x0 && i * size < r.x1 && j * size > r.z0 && j * size < r.z1).length).toBe(1); }
      expect(area(rs)).toBeCloseTo(tiles.length * size * size, 5);
    });
  }
});
