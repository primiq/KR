// The site's Worker: the game's files are static assets (served by Cloudflare before this runs); this only answers
// POST /api/e, the game's anonymous usage events. Each event is written as one log line, to be read and queried in the
// Cloudflare dashboard (Workers & Pages > kr > Logs / Observability). Nothing is stored here, nothing personal arrives:
// see src/castaway/net/telemetry.ts for what the game sends.

interface Env { ASSETS: { fetch(req: Request): Promise<Response> } }

const KINDS = new Set(["start", "play", "level", "mp", "err", "end", "save"]);
const clip = (v: unknown, n = 40) => (typeof v === "string" ? v.slice(0, n) : typeof v === "number" && Number.isFinite(v) ? v : typeof v === "boolean" ? v : undefined);

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname !== "/api/e") return env.ASSETS.fetch(req);
        if (req.method !== "POST") return new Response(null, { status: 405 });
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > 8192) return new Response(null, { status: 413 });
        try {
            const body = (await req.json()) as { id?: unknown; v?: unknown; ev?: unknown };
            const id = clip(body.id, 16), ver = clip(body.v, 60);
            const list = Array.isArray(body.ev) ? body.ev.slice(0, 40) : [];
            const country = (req as unknown as { cf?: { country?: string } }).cf?.country ?? "";
            for (const e of list) {
                if (!e || typeof e !== "object" || !KINDS.has((e as { k?: string }).k ?? "")) continue;
                // only short, flat fields go into the log (no free text from the page)
                const out: Record<string, unknown> = { event: (e as { k: string }).k, id, ver, country };
                for (const [k, v] of Object.entries(e as Record<string, unknown>)) if (k !== "k" && k.length <= 12) { const c = clip(v); if (c !== undefined) out[k] = c; }
                console.log(JSON.stringify(out));
            }
        } catch { /* a bad body is ignored */ }
        return new Response(null, { status: 204 });
    },
};
