// Seed des thèmes depuis les CSV + choix du prochain mot-clé selon la priorisation.
import { buildThemes, loadClusterMap, loadKeywordRows, clusterWithAI, normaliserMotCle, filtrerPertinenceIA } from "./clusters.js";
import { today } from "./utils.js";

/**
 * (Re)génère la liste des thèmes DISTINCTS via SYNTHÈSE IA à partir des mots-clés réels.
 *
 * La synthèse IA est coûteuse -> elle ne tourne QUE :
 *   - au tout premier seed (état vide), ou
 *   - sur rebuild explicite (commande `node src/themes.js`, quand on ajoute un nouveau CSV).
 * Les runs quotidiens (rebuild=false, état déjà peuplé) ne resynthétisent pas.
 *
 * Les thèmes déjà rédigés/publiés (`utilise`/`problematique`) sont TOUJOURS préservés ;
 * le backlog `libre` est remplacé par la nouvelle synthèse (sans recréer un sujet déjà couvert).
 * Renvoie true si c'était le premier seed.
 */
export async function seedThemes(storeId, state, niche, { rebuild = false } = {}) {
  let rows = loadKeywordRows(storeId);
  if (rows.length === 0) return false;

  const wasEmpty = state.themes.length === 0;
  if (!wasEmpty && !rebuild) return false; // pas de resynthèse coûteuse au quotidien

  // 1) FILTRE DE PERTINENCE : ne garder que les vrais mots-clés de la niche (retire lieux,
  //    idiomes, produits homonymes, enseignes, emplois — ce qu'un filtre par mots ne peut pas voir).
  rows = await filtrerPertinenceIA(rows, niche);

  // 2) CLUSTERING : clusters.csv s'il couvre l'essentiel, sinon clustering IA complet.
  let clusterMap = loadClusterMap(storeId);
  if (clusterMap) {
    const couverts = rows.filter((r) => clusterMap.has(r.mot_cle.trim().toLowerCase())).length;
    if (couverts / rows.length < 0.6) clusterMap = null; // csv trop partiel -> IA
  }
  if (!clusterMap) clusterMap = await clusterWithAI(rows, niche);

  // 3) SYNTHÈSE : thèmes distincts, variantes absorbées.
  const synth = await buildThemes(rows, clusterMap, niche);

  // Préserver ce qui est déjà rédigé ; ne pas recréer un thème sur un sujet déjà couvert.
  const conserves = state.themes.filter((t) => t.statut === "utilise" || t.statut === "problematique");
  const couverts = new Set();
  for (const t of conserves) {
    couverts.add(normaliserMotCle(t.mot_cle));
    for (const v of t.variantes || []) couverts.add(normaliserMotCle(v));
  }
  const nouveaux = synth.filter((t) => !couverts.has(normaliserMotCle(t.mot_cle)));

  state.themes = [...conserves, ...nouveaux];
  state.derniere_generation_themes = today();
  return wasEmpty;
}

/**
 * Choisit le prochain thème à traiter.
 * Priorité :
 *   1. Publier le PILIER avant les satellites d'un cluster non entamé.
 *   2. Questions d'abord (intention claire + featured snippet).
 *   3. KD faible (< seuil), puis volume décroissant.
 * Le seuil KD s'élargit progressivement si aucun candidat facile.
 */
export function pickNext(state) {
  const libres = state.themes.filter((t) => t.statut === "libre");
  if (libres.length === 0) return null;

  const clustersEntames = new Set(
    state.themes.filter((t) => t.statut === "utilise").map((t) => t.cluster)
  );

  // 1. COMPLÉTER un cluster déjà entamé (pilier publié → ses satellites) AVANT d'en ouvrir un nouveau.
  //    → le maillage interne et l'indexation démarrent dès le 2e article d'un cluster.
  const enCours = libres.filter((t) => clustersEntames.has(t.cluster));
  if (enCours.length) {
    // On finit UN cluster à la fois : celui le plus proche d'être complet (moins de restants).
    const restants = new Map();
    for (const t of enCours) restants.set(t.cluster, (restants.get(t.cluster) || 0) + 1);
    const clusterCible = [...restants.entries()].sort((a, b) => a[1] - b[1])[0][0];
    return choisirDans(enCours.filter((t) => t.cluster === clusterCible));
  }

  // 2. Sinon OUVRIR un nouveau cluster par son PILIER (meilleure opportunité).
  const piliersNeufs = libres.filter((t) => t.role === "pilier");
  if (piliersNeufs.length) return choisirDans(piliersNeufs);

  // 3. Fallback.
  return choisirDans(libres);
}

/** Meilleur candidat d'un pool : pilier d'abord, puis questions, puis volume ; KD croissant en filtre. */
function choisirDans(pool) {
  for (const seuilKd of [30, 45, 100]) {
    const c = pool.filter((t) => t.kd <= seuilKd);
    if (!c.length) continue;
    c.sort((a, b) => {
      if ((a.role === "pilier") !== (b.role === "pilier")) return a.role === "pilier" ? -1 : 1;
      if (a.est_question !== b.est_question) return a.est_question ? -1 : 1;
      return b.volume - a.volume;
    });
    return c[0];
  }
  return pool[0];
}
