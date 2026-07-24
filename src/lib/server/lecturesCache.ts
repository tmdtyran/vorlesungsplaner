// Shared in-memory TTL cache for /api/lectures (catalog listings). Lives in
// its own module (rather than inline in the route file) so that other
// server code — specifically the catalogue import, which is the only thing
// that actually changes this data — can invalidate the relevant entries as
// soon as an import finishes, instead of waiting out the TTL.

import { invalidateResolvedCatalog } from "./catalogResolver";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

const MODES = ["flat", "hierarchy"] as const;

function keyFor(mode: string | null, periodeId: string, lang: string): string {
    return `${mode}:${periodeId}:${lang}`;
}

export function getCached(mode: string | null, periodeId: string, lang: string): unknown | undefined {
    const entry = cache.get(keyFor(mode, periodeId, lang));
    if (!entry) return undefined;
    if (Date.now() - entry.at >= CACHE_TTL_MS) return undefined;
    return entry.data;
}

export function setCached(mode: string | null, periodeId: string, lang: string, data: unknown) {
    cache.set(keyFor(mode, periodeId, lang), { at: Date.now(), data });
}

/**
 * Drops every cached listing (both "flat" and "hierarchy" mode, and the
 * default/null-mode variant) for a given semester+language — call this
 * right after a catalogue import completes so the next request reflects
 * the fresh data immediately instead of possibly serving up to 5 minutes
 * of stale results.
 *
 * Also invalidates the resolved-catalog cache (catalogResolver.ts) for the
 * same semester+language — that cache holds the on-the-fly-parsed catalog
 * (built from stored raw_title HTML) that this API-response cache's data
 * is ultimately built from, so both need to go stale together.
 */
export function invalidateLecturesCache(periodeId: string, lang: string) {
    cache.delete(keyFor(null, periodeId, lang));
    for (const mode of MODES) {
        cache.delete(keyFor(mode, periodeId, lang));
    }
    invalidateResolvedCatalog(periodeId, lang);
}
