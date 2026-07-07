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

  // Clusters déjà entamés (au moins un article publié).
  const clustersEntames = new Set(
    state.themes.filter((t) => t.statut === "utilise").map((t) => t.cluster)
  );

  // 1. Piliers de clusters non encore entamés = priorité absolue.
  const piliersNeufs = libres.filter(
    (t) => t.role === "pilier" && !clustersEntames.has(t.cluster)
  );
  const pool = piliersNeufs.length ? piliersNeufs : libres;

  for (const seuilKd of [30, 45, 100]) {
    const candidats = pool.filter((t) => t.kd <= seuilKd);
    if (!candidats.length) continue;
    candidats.sort((a, b) => {
      // questions d'abord
      if (a.est_question !== b.est_question) return a.est_question ? -1 : 1;
      // puis volume décroissant
      return b.volume - a.volume;
    });
    return candidats[0];
  }
  return pool[0];
}
