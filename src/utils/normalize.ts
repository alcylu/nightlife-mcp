/**
 * Search query normalization utilities.
 *
 * Used by venues, events, and performers services to apply identical
 * accent/space/case normalization — the single source of truth for v3.0.
 */

/**
 * Strips combining diacritical marks (accents) from an NFD-decomposed string.
 * Preserves spaces, digits, and original casing.
 *
 * Examples:
 *   stripAccents('CÉ LA VI') → 'CE LA VI'
 *   stripAccents('Shinjūku') → 'Shinjuku'
 */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalizes a search query for consistent matching.
 * Pipeline: strip accents → collapse whitespace → lowercase.
 *
 * Examples:
 *   normalizeQuery('CÉ LA VI') → 'celavi'
 *   normalizeQuery('1 OAK')    → '1oak'
 *   normalizeQuery('CeLaVi')   → 'celavi'
 *   normalizeQuery('é')        → 'e'
 */
export function normalizeQuery(raw: string): string {
  return stripAccents(raw).replace(/\s+/g, "").toLowerCase();
}
