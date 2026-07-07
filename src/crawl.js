// Commande de crawl : choisis une boutique -> crawle tout le catalogue Shopify
// (produits, collections, pages) -> écrit boutiques/<id>/contexte-shopify.json
//
// Usage :
//   node --env-file=.env src/crawl.js            (interactif : choix de la boutique)
//   node --env-file=.env src/crawl.js boutique-1 (direct)
import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadStores } from "./config.js";
import { shopifyGraphQL } from "./shopify.js";

async function choisirBoutique(stores) {
  const arg = process.argv[2];
  if (arg) {
    const s = stores.find((x) => x.id === arg);
    if (!s) throw new Error(`Boutique inconnue : ${arg}`);
    return s;
  }
  console.log("\nBoutiques disponibles :");
  stores.forEach((s, i) => console.log(`  ${i + 1}. ${s.id} (${s.domaine})`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const rep = await rl.question("\nChoisis une boutique (numéro) : ");
  rl.close();
  const idx = parseInt(rep.trim(), 10) - 1;
  if (Number.isNaN(idx) || !stores[idx]) throw new Error("Choix invalide");
  return stores[idx];
}

/** Crawle une connexion GraphQL paginée jusqu'au bout. */
async function crawlConnexion(store, champ, selection) {
  const items = [];
  let cursor = null;
  do {
    const data = await shopifyGraphQL(
      store,
      `query($c: String) { ${champ}(first: 100, after: $c) {
        pageInfo { hasNextPage endCursor }
        nodes { ${selection} }
      } }`,
      { c: cursor }
    );
    const conn = data[champ];
    items.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    process.stdout.write(`\r  ${champ} : ${items.length}   `);
  } while (cursor);
  process.stdout.write("\n");
  return items;
}

async function crawlSafe(store, champ, selection) {
  try {
    return await crawlConnexion(store, champ, selection);
  } catch (e) {
    console.warn(`  ⚠️ ${champ} ignoré : ${e.message}`);
    return [];
  }
}

async function main() {
  const stores = loadStores();
  const store = await choisirBoutique(stores);
  if (!store.shopify_token) throw new Error(`Pas de token Shopify pour ${store.id} (STORES_SECRETS).`);

  console.log(`\n🕷️  Crawl de ${store.id} (${store.domaine})...\n`);

  const shopData = await shopifyGraphQL(store, `{ shop { name description } }`);
  const produits = await crawlSafe(store, "products", "title handle productType tags description");
  const collections = await crawlSafe(store, "collections", "title handle description");
  const pages = await crawlSafe(store, "pages", "title handle");

  const contexte = {
    crawle_le: new Date().toISOString().slice(0, 10),
    shop: {
      nom: shopData.shop?.name || "",
      description: shopData.shop?.description || "",
      domaine: store.domaine,
    },
    produits: produits.map((p) => ({
      titre: p.title,
      url: `https://${store.domaine}/products/${p.handle}`,
      type: p.productType || "",
      tags: p.tags || [],
      description: (p.description || "").replace(/\s+/g, " ").trim().slice(0, 300),
    })),
    collections: collections.map((c) => ({
      titre: c.title,
      url: `https://${store.domaine}/collections/${c.handle}`,
      description: (c.description || "").replace(/\s+/g, " ").trim().slice(0, 200),
    })),
    pages: pages.map((p) => ({
      titre: p.title,
      url: `https://${store.domaine}/pages/${p.handle}`,
    })),
  };

  const out = join(ROOT, "boutiques", store.id, "contexte-shopify.json");
  writeFileSync(out, JSON.stringify(contexte, null, 2) + "\n", "utf8");

  console.log(
    `\n✅ ${contexte.produits.length} produits · ${contexte.collections.length} collections · ${contexte.pages.length} pages`
  );
  console.log(`   → écrit dans boutiques/${store.id}/contexte-shopify.json`);
  console.log("\nLe bot lira ce fichier pour un contexte riche + tous les liens internes produits.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
