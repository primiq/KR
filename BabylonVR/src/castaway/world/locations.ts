// Locations, Locations: the registry. One entry per real place; the monitors in the Locations room are drawn from this list.
// A location's level comes from scripts/loc-fetch.mjs + loc-bake.mjs (open map data, baked at build time into
// src/world/locations/<id>.data.json) and its monitor picture from scripts/loc-previews.mjs (<id>.preview.jpg, a render
// of our own recreation). Both are picked up automatically when the files exist.
const DATA = import.meta.glob('./locations/*.data.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const PREVIEW = import.meta.glob('./locations/*.preview.jpg', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>;

export interface LocationEntry {
  id: string;
  name: string;
  description: string;
  /** 'ready' when the baked level is in the build, 'pending' while the map data has not been fetched yet */
  status: 'ready' | 'pending';
  preview: string | null;
  /** the baked level (parsed the first time somebody goes there) */
  data(): any | null;
}

const REGISTRY: { id: string; name: string; description: string }[] = [
  { id: 'keith-avenue', name: 'Keith Avenue', description: 'A quiet residential street. Walk it end to end.' },
];

const parsed = new Map<string, any>();
export const LOCATIONS: LocationEntry[] = REGISTRY.map((r) => {
  const raw = DATA[`./locations/${r.id}.data.json`];
  return {
    ...r,
    status: raw ? 'ready' : 'pending',
    preview: PREVIEW[`./locations/${r.id}.preview.jpg`] ?? null,
    data: () => { if (!raw) return null; if (!parsed.has(r.id)) parsed.set(r.id, JSON.parse(raw)); return parsed.get(r.id); },
  };
});

/** where each location's level sits in the world (far apart, away from every other special area) */
export const townOrigin = (index: number) => ({ x: -21000 - 1000 * index, y: 40, z: 0 });
export const OSM_CREDIT = 'Map data © OpenStreetMap contributors (ODbL)';
