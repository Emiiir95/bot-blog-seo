// Maillage interne : cibles de liens pour la génération + maillage bidirectionnel après publication.
import { getArticleBody, updateArticleBody } from "./shopify.js";

/** Cibles de liens à fournir à l'IA : produits pertinents + articles déjà publiés du même cluster. */
export function ciblesMaillage(state, theme, shop) {
  const produits = [
    ...(shop?.produits || []),
    ...(shop?.collections || []),
  ].slice(0, 12);

  const articles = state.themes
    .filter((t) => t.statut === "utilise" && t.cluster === theme.cluster && t.url)
    .map((t) => ({ titre: t.titre || t.mot_cle, url: t.url }))
    .slice(0, 6);

  return { produits, articles };
}

/**
 * Ajoute un lien depuis 1-2 anciens articles du même cluster vers le nouvel article.
 * (Distribue le jus SEO + accélère la découverte Google.)
 */
export async function maillageBidirectionnel(store, state, nouveauTheme, nouvelleUrl, nouveauTitre) {
  const anciens = state.themes
    .filter(
      (t) =>
        t.statut === "utilise" &&
        t.cluster === nouveauTheme.cluster &&
        t.article_id &&
        t.mot_cle !== nouveauTheme.mot_cle
    )
    .sort((a, b) => new Date(b.date_publication) - new Date(a.date_publication))
    .slice(0, 2);

  let liensAjoutes = 0;
  for (const ancien of anciens) {
    try {
      const body = await getArticleBody(store, ancien.article_id);
      if (body.includes(nouvelleUrl)) continue; // déjà lié
      const bloc = `\n<p>À lire aussi : <a href="${nouvelleUrl}">${nouveauTitre}</a></p>\n`;
      await updateArticleBody(store, ancien.article_id, body + bloc);
      liensAjoutes++;
    } catch (e) {
      console.warn(`  ⚠️ maillage vers ${ancien.mot_cle} échoué: ${e.message}`);
    }
  }
  return liensAjoutes;
}
