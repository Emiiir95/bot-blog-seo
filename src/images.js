// Images : génération IA (OpenAI) OU banques gratuites (Pexels/Unsplash), avec anti-répétition.
import { withRetry } from "./utils.js";
import { genererImageIA } from "./image-gen.js";
import { uploadImageBytes } from "./shopify.js";
import { slugify } from "./utils.js";

/**
 * Image générée par IA puis hébergée sur Shopify.
 * @returns { featured: {url, alt}, credits: [], imageManquante } — imageManquante=true si KO (repli).
 */
export async function resoudreImageIA(store, article, motCle, niche) {
  const sujet = article.images?.[0]?.requete || article.titre || motCle;
  try {
    const img = await genererImageIA(sujet, niche);
    if (!img) return { featured: null, credits: [], imageManquante: true }; // pas de clé -> repli
    const url = await uploadImageBytes(store, img.buffer, `${slugify(motCle) || "image"}.png`, img.mime);
    return { featured: { url, alt: motCle }, credits: [], imageManquante: false };
  } catch (e) {
    console.warn(`  ⚠️ image IA KO (${e.message}) — repli sur photo.`);
    return { featured: null, credits: [], imageManquante: true };
  }
}

async function searchPexels(query, key, count = 20) {
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    const e = new Error(`Pexels HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  return (data.photos || []).map((p) => ({
    url: p.src.large2x || p.src.large,
    credit: { auteur: p.photographer, url: p.url },
  }));
}

async function searchUnsplash(query, key, count = 20) {
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((p) => ({
    url: p.urls.regular,
    credit: { auteur: p.user?.name, url: p.links?.html },
  }));
}

/** Cherche une image pour une requête, en évitant celles déjà utilisées (usedSet). */
export async function chercherImage(store, requete, altBase, usedSet = new Set()) {
  return withRetry(
    async () => {
      let candidats = await searchPexels(requete, store.pexels_key);
      if (!candidats.length) candidats = await searchUnsplash(requete, store.unsplash_key);
      if (!candidats.length) return null;
      // Premier candidat non encore utilisé (sinon le premier disponible).
      const choix = candidats.find((c) => !usedSet.has(c.url)) || candidats[0];
      return { ...choix, alt: altBase };
    },
    { label: "image", tries: 2, backoff: [1000, 3000] }
  );
}

/**
 * Résout les images demandées par l'article, sans réutiliser une image déjà prise (usedSet, muté).
 * @returns { featured, credits, imageManquante }
 */
export async function resoudreImages(store, article, motCle, usedSet = new Set()) {
  const demandees = article.images || [];
  if (demandees.length === 0) return { featured: null, credits: [], imageManquante: false };

  const credits = [];
  let featured = null;
  for (const img of demandees) {
    const found = await chercherImage(store, img.requete, motCle, usedSet);
    if (found) {
      credits.push(found.credit);
      usedSet.add(found.url); // marque comme utilisée pour la suite
      if (!featured) featured = found;
    }
  }
  return { featured, credits, imageManquante: featured === null };
}
