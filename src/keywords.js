// Seed des thèmes depuis les CSV + choix du prochain mot-clé selon la priorisation.
import { buildThemes, loadClusterMap, loadKeywordRows, clusterWithAI } from "./clusters.js";
import { today } from "./utils.js";

/**
 * Remplit state.themes depuis keywords.csv s'il est vide, ou fusionne les nouveaux
 * mots-clés apparus (sans écraser le statut des existants). Renvoie true si régénéré.
 *
 * Clusters : depuis clusters.csv s'il existe, sinon regroupement automatique par l'IA
 * (un seul appel, uniquement quand il y a de nouveaux mots-clés à intégrer).
 */
export async function seedThemes(storeId, state, niche) {
  const rows = loadKeywordRows(storeId);
  if (rows.length === 0) return false;

  const known = new Set(state.themes.map((t) => t.mot_cle.toLowerCase()));
  const nouveaux = rows.filter((r) => !known.has(r.mot_cle.toLowerCase()));
  if (nouveaux.length === 0) return false; // rien de neuf -> aucun appel IA

  let clusterMap = loadClusterMap(storeId);
  if (!clusterMap) clusterMap = await clusterWithAI(rows, niche);

  const fromCsv = buildThemes(storeId, clusterMap);
  const added = fromCsv.filter((t) => !known.has(t.mot_cle.toLowerCase()));

  const wasEmpty = state.themes.length === 0;
  if (added.length) {
    state.themes.push(...added);
    state.derniere_generation_themes = today();
  }
  return wasEmpty && added.length > 0;
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
