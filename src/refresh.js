// Rafraîchissement : chaque jour, enrichit le PLUS VIEIL article (signal de fraîcheur SEO).
// Cycle : avec N articles publiés, chacun est rafraîchi tous les ~N jours.
// Bonus autonomie : continue de tourner même quand il n'y a plus de nouveaux thèmes à écrire.
import { loadState, saveState, commitState } from "./state.js";
import { getArticleBody, updateArticleBody } from "./shopify.js";
import { genererComplement } from "./generate.js";
import { pingIndexNow } from "./indexnow.js";
import { today } from "./utils.js";

const MIN_ARTICLES = 20; // pas de refresh tant que le site n'a pas un socle d'articles
const MARQUEUR = "<!-- refresh -->";

export async function refreshBoutique(store, journal) {
  const state = loadState(store.id);
  const publies = state.themes.filter((t) => t.statut === "utilise" && t.article_id);
  if (publies.length < MIN_ARTICLES) return; // trop tôt

  // Le plus ancien (date_maj la plus ancienne) → rotation naturelle sur tout le site.
  publies.sort((a, b) => new Date(a.date_maj || 0) - new Date(b.date_maj || 0));
  const cible = publies[0];

  const complement = await genererComplement(cible.mot_cle, cible.titre || cible.mot_cle, store.langue);
  if (!complement) return;

  const body = await getArticleBody(store, cible.article_id);
  const bodyBase = body.split(MARQUEUR)[0]; // retire l'ancien complément pour éviter l'empilement
  await updateArticleBody(store, cible.article_id, `${bodyBase}\n${MARQUEUR}\n${complement}\n`);

  cible.date_maj = today();
  state.dernier_refresh = today();
  saveState(store.id, state);
  commitState(store.id, `refresh ${store.id}: "${cible.titre}"`);

  if (cible.url) await pingIndexNow(store, cible.url);
  journal.info(`${store.id} : article rafraîchi « ${cible.titre} »`);
}
