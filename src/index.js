// Orchestrateur : boucle séquentielle sur les boutiques, pipeline auto-réparant par article.
import { loadStores, env } from "./config.js";
import { loadState, saveState, commitState } from "./state.js";
import { seedThemes, pickNext } from "./keywords.js";
import { buildContext } from "./store-context.js";
import { getBlogId, createArticle } from "./shopify.js";
import { genererArticle } from "./generate.js";
import { valider } from "./validate.js";
import { resoudreImages } from "./images.js";
import { assemblerBody } from "./seo.js";
import { ciblesMaillage, maillageBidirectionnel } from "./linking.js";
import { pingIndexNow } from "./indexnow.js";
import { refreshBoutique } from "./refresh.js";
import { createJournal, sendTelegram } from "./telegram.js";
import { getCostSummary } from "./cost.js";
import { slugify, today } from "./utils.js";

const GID_RE = /(\d+)$/;
function adminArticleUrl(store, gid) {
  const m = String(gid).match(GID_RE);
  return `https://${store.shopify_domain}/admin/articles/${m ? m[1] : ""}`;
}

function questionsDuCluster(state, theme) {
  return state.themes
    .filter((t) => t.cluster === theme.cluster && t.mot_cle !== theme.mot_cle)
    .sort((a, b) => (b.est_question === true) - (a.est_question === true))
    .map((t) => t.mot_cle)
    .slice(0, 8);
}

async function traiterBoutique(store, journal) {
  const state = loadState(store.id);

  const regenere = await seedThemes(store.id, state, store.niche);
  if (regenere) journal.regen({ storeId: store.id });

  const theme = pickNext(state);
  if (!theme) {
    saveState(store.id, state);
    journal.info(`${store.id} : plus aucun thème libre — exporte un nouveau CSV SEMrush.`);
    return;
  }

  const ctx = await buildContext(store);
  const blogId = await getBlogId(store); // peut throw -> échec boutique

  const clusterQuestions = questionsDuCluster(state, theme);
  const linkTargets = ciblesMaillage(state, theme, ctx.shop);

  // Génération + 1 re-tentative en cas de mauvaise qualité.
  let article = null;
  let dernieresRaisons = [];
  const maxMots = 3200; // 600-3000 pour tous (petite tolérance pour "un peu plus")
  for (let attempt = 0; attempt < 2; attempt++) {
    const gen = await genererArticle(ctx, theme, clusterQuestions, linkTargets);
    const v = valider(gen.article, { langue: store.langue, stopReason: gen.stopReason, maxMots });
    if (v.ok) {
      article = gen.article;
      article._mots = v.mots;
      break;
    }
    dernieresRaisons = v.raisons;
  }

  if (!article) {
    // Mauvaise qualité : le thème reste libre, re-tenté demain.
    theme.echecs_qualite = (theme.echecs_qualite || 0) + 1;
    if (theme.echecs_qualite >= 3) {
      theme.statut = "problematique"; // débloque la file
      journal.echec({
        storeId: store.id,
        domaine: store.domaine,
        raison: `⚠️ "${theme.mot_cle}" rate la qualité depuis 3 jours (${dernieresRaisons.join("; ")}) — mis de côté`,
      });
    } else {
      journal.echec({
        storeId: store.id,
        domaine: store.domaine,
        raison: `qualité insuffisante (${dernieresRaisons.join("; ")})`,
      });
    }
    saveState(store.id, state);
    commitState(store.id, `état ${store.id}: échec qualité ${theme.mot_cle}`);
    return;
  }

  // Finalisation article.
  article.auteur = ctx.auteur;
  const handle = slugify(article.slug || article.titre);
  article.slug = handle;
  const url = `https://${store.domaine}/blogs/${store.blog_handle}/${handle}`;

  // Images.
  const imgRes = await resoudreImages(store, article, theme.mot_cle);
  const published = !imgRes.imageManquante && !env.forceDraft;

  // SEO + corps final.
  article.body_html = assemblerBody(article, ctx, {
    url,
    image: imgRes.featured,
    credits: imgRes.credits,
  });
  article.image = imgRes.featured ? { url: imgRes.featured.url, alt: imgRes.featured.alt } : null;
  article.tags = Array.from(new Set([...(article.tags || []), theme.cluster]));

  // Publication (ou brouillon si image manquante).
  const res = await createArticle(store, blogId, article, { published });

  // Marquer utilisé (après succès).
  Object.assign(theme, {
    statut: "utilise",
    article_id: res.id,
    handle: res.handle,
    url: res.url,
    titre: article.titre,
    date_publication: today(),
    date_maj: today(),
  });
  saveState(store.id, state);
  commitState(store.id, `état ${store.id}: publié "${article.titre}"`);

  if (published) {
    await maillageBidirectionnel(store, state, theme, res.url, article.titre);
    await pingIndexNow(store, res.url);
    journal.publie({
      storeId: store.id,
      domaine: store.domaine,
      titre: article.titre,
      mots: article._mots,
      image: !!article.image,
    });
  } else {
    journal.brouillon({
      storeId: store.id,
      domaine: store.domaine,
      titre: article.titre,
      adminUrl: adminArticleUrl(store, res.id),
      raison: imgRes.imageManquante ? "aucune image trouvée" : "mode brouillon (à valider)",
    });
  }
}

async function main() {
  const stores = loadStores();
  const journal = createJournal();

  for (const store of stores) {
    console.log(`\n=== ${store.id} (${store.domaine}) ===`);
    try {
      await traiterBoutique(store, journal);
    } catch (e) {
      console.error(`  ❌ ${store.id}: ${e.message}`);
      journal.echec({ storeId: store.id, domaine: store.domaine, raison: e.message });
      // Non-fatal : on continue avec la boutique suivante.
    }

    // Rafraîchissement hebdomadaire (jamais bloquant).
    try {
      await refreshBoutique(store, journal);
    } catch (e) {
      console.warn(`  ⚠️ refresh ${store.id}: ${e.message}`);
    }
  }

  // Digest Telegram (échec d'envoi = run rouge, pour ne pas devenir aveugle).
  const cost = getCostSummary();
  try {
    await sendTelegram(journal.build(cost));
  } catch (e) {
    console.error(`❌ Envoi Telegram échoué: ${e.message}`);
    process.exit(1);
  }

  console.log("\n✅ Run terminé.");
}

main().catch((e) => {
  console.error("💥 Crash du run:", e);
  process.exit(1);
});
