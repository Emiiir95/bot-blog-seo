// Récupération d'images via banques gratuites (Pexels, fallback Unsplash).
// v1 : on utilise l'URL déjà redimensionnée par Pexels (src.large) — pas de re-hosting.
// v2 (optionnel) : sharp -> WebP + Shopify staged uploads pour une optim vitesse maximale.
import { withRetry } from "./utils.js";

async function searchPexels(query, key) {
  if (!key) return null;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    const e = new Error(`Pexels HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  const photo = data.photos?.[0];
  if (!photo) return null;
  return {
    url: photo.src.large2x || photo.src.large,
    credit: { auteur: photo.photographer, url: photo.url },
  };
}

async function searchUnsplash(query, key) {
  if (!key) return null;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const photo = data.results?.[0];
  if (!photo) return null;
  return {
    url: photo.urls.regular,
    credit: { auteur: photo.user?.name, url: photo.links?.html },
  };
}

/** Cherche une image pour une requête donnée. */
export async function chercherImage(store, requete, altBase) {
  return withRetry(
    async () => {
      let img = await searchPexels(requete, store.pexels_key);
      if (!img) img = await searchUnsplash(requete, store.unsplash_key);
      if (!img) return null;
      return { ...img, alt: altBase };
    },
    { label: "image", tries: 2, backoff: [1000, 3000] }
  );
}

/**
 * Résout les images demandées par l'article.
 * @returns { featured, credits, imageManquante }
 *  - imageManquante = true si l'article demandait ≥1 image mais aucune n'a pu être récupérée.
 */
export async function resoudreImages(store, article, motCle) {
  const demandees = article.images || [];
  if (demandees.length === 0) {
    return { featured: null, credits: [], imageManquante: false };
  }

  const credits = [];
  let featured = null;
  for (const img of demandees) {
    const found = await chercherImage(store, img.requete, motCle);
    if (found) {
      credits.push(found.credit);
      if (!featured) featured = found;
    }
  }

  return {
    featured,
    credits,
    imageManquante: featured === null, // demandée mais rien trouvé
  };
}
