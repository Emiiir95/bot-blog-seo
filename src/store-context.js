// Construit le contexte complet d'une boutique : API Shopify (live) + infos.md (manuel).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";
import { getShopContext } from "./shopify.js";

function readInfos(storeId) {
  const p = join(ROOT, "boutiques", storeId, "infos.md");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/** Charge le contexte crawlé (contexte-shopify.json) s'il existe. */
function readCrawled(storeId) {
  const p = join(ROOT, "boutiques", storeId, "contexte-shopify.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Extrait l'auteur depuis infos.md (ligne "- **Auteur** : ..."). */
export function extractAuthor(infosMd) {
  const m = infosMd.match(/auteur\s*\*\*?\s*:\s*(.+)/i);
  return m ? m[1].split(",")[0].trim() : "L'équipe éditoriale";
}

export async function buildContext(store) {
  const infos = readInfos(store.id);

  // Priorité au contexte crawlé (riche : tout le catalogue). Sinon requête live (25 produits).
  let shop = { nom: store.niche, description: "", produits: [], collections: [] };
  const crawled = readCrawled(store.id);
  if (crawled) {
    shop = {
      nom: crawled.shop?.nom || store.niche,
      description: crawled.shop?.description || "",
      produits: crawled.produits || [],
      collections: crawled.collections || [],
      pages: crawled.pages || [],
    };
  } else {
    try {
      shop = await getShopContext(store);
    } catch (e) {
      console.warn(`  ⚠️ contexte Shopify indisponible pour ${store.id}: ${e.message}`);
    }
  }
  return {
    niche: store.niche,
    langue: store.langue,
    domaine: store.domaine,
    infos_md: infos,
    auteur: extractAuthor(infos),
    shop,
  };
}
