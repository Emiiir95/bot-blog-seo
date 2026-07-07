// Helpers partagés.

/**
 * Réessaie une fonction async avec backoff exponentiel.
 * Ne retry PAS les erreurs "logiques" (statut 400/401/403/404/422).
 */
export async function withRetry(fn, { tries = 3, backoff = [1000, 4000, 10000], label = "" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.statusCode;
      // Erreurs non-retryables : mauvaise requête / auth / not found
      if (status && [400, 401, 403, 404, 422].includes(status)) throw err;
      if (i < tries - 1) {
        const wait = backoff[i] ?? backoff[backoff.length - 1];
        console.warn(`  ↻ retry ${label} (${i + 1}/${tries - 1}) dans ${wait}ms — ${err.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retire les balises HTML pour compter les mots / détecter la langue. */
export function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text = "") {
  const t = stripHtml(text);
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Slug propre basé sur un mot-clé. */
export function slugify(str = "") {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/** Aujourd'hui au format ISO (YYYY-MM-DD). */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Nombre de jours entre une date ISO et aujourd'hui. */
export function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const diff = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
