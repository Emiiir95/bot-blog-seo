// Commande : génère / met à jour la LISTE DES THÈMES d'une boutique (sans écrire d'article).
// Sert à revoir le plan de contenu avant que le bot ne rédige.
//
// Usage :
//   node --env-file=.env src/themes.js            (interactif)
//   node --env-file=.env src/themes.js boutique-1 (direct)
import { createInterface } from "node:readline/promises";
import { loadStores } from "./config.js";
import { loadState, saveState, commitState } from "./state.js";
import { seedThemes } from "./keywords.js";

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

async function main() {
  const stores = loadStores();
  const store = await choisirBoutique(stores);

  console.log(`\n🧩 Génération de la liste des thèmes pour ${store.id}...\n`);
  const state = loadState(store.id);
  await seedThemes(store.id, state, store.niche); // lit keywords.csv (+ clustering si besoin)
  saveState(store.id, state);
  commitState(store.id, `themes ${store.id}: liste (re)générée`);

  const libres = state.themes.filter((t) => t.statut === "libre").length;
  const utilises = state.themes.length - libres;
  console.log(`${state.themes.length} thèmes — ${libres} libres · ${utilises} déjà rédigés\n`);

  // Regroupé par cluster pour lisibilité.
  const parCluster = {};
  for (const t of state.themes) (parCluster[t.cluster] ||= []).push(t);
  for (const [cluster, list] of Object.entries(parCluster)) {
    console.log(`▸ ${cluster}`);
    for (const t of list) {
      const marque = t.statut === "utilise" ? "✅" : "•";
      const role = t.role === "pilier" ? "[PILIER]" : "         ";
      console.log(`   ${marque} ${role} ${t.mot_cle}`);
    }
    console.log("");
  }
  console.log(`→ liste enregistrée dans boutiques/${store.id}/etat.json`);
  console.log("Rien n'a été rédigé ni publié : c'est juste le plan de contenu.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
