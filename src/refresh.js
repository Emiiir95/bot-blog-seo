// Rafraîchissement hebdomadaire : enrichit le plus vieil article (signal de fraîcheur SEO).
import { loadState, saveState, commitState } from "./state.js";
import { getArticleBody, updateArticleBody } from "./shopify.js";
import { genererComplement } from "./generate.js";
import { pingIndexNow } from "./indexnow.js";
import { daysSince, today } from "./utils.js";

const INTERVALLE_JOURS = 7;
const MARQUEUR = "<!-- refresh -->";

export async function refreshBoutique(store, journal) {
  const state = loadState(store.id);
  if (daysSince(state.dernier_refresh) < INTERVALLE_JOURS) return;

  // Plus vieil article publié (date_maj la plus ancienne).
  const publies = state.themes.filter((t) => t.statut === "utilise" && t.article_id);
  if (publies.length === 0) return;
  publies.sort((a, b) => new Date(a.date_maj || 0) - new Date(b.date_maj || 0));
  const cible = publies[0];

  const complement = await genererComplement(cible.mot_cle, cible.titre || cible.mot_cle, store.langue);
  if (!complement) return;

  const body = await getArticleBody(store, cible.article_id);
  // Retire l'ancien complément s'il existe pour éviter l'empilement.
  const bodyBase = body.split(MARQUEUR)[0];
  const nouveauBody = `${bodyBase}\n${MARQUEUR}\n${complement}\n`;
  await updateArticleBody(store, cible.article_id, nouveauBody);

  cible.date_maj = today();
  state.dernier_refresh = today();
  saveState(store.id, state);
  commitState(store.id, `refresh ${store.id}: "${cible.titre}"`);

  if (cible.url) await pingIndexNow(store, cible.url);
  journal.info(`${store.id} : article rafraîchi « ${cible.titre} »`);
}
