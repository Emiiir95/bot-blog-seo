// Génération de l'article en 2 temps :
//   1) Corps en texte libre (HTML) -> le modèle écrit long (le JSON structuré le bride).
//   2) Métadonnées en JSON structuré via Haiku (titre, meta, slug, FAQ, images, tags).
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./config.js";
import { addUsage } from "./cost.js";

const client = new Anthropic({ apiKey: env.anthropicKey });

const ANNEE = new Date().getFullYear();

// Modèles configurables via .env (défaut : tout Haiku 4.5 pour le coût mini).
// Pour remettre Sonnet sur les piliers : MODEL_PILIER=claude-sonnet-5 dans .env.
const MODELS = {
  pilier: process.env.MODEL_PILIER || "claude-haiku-4-5",
  satellite: process.env.MODEL_SATELLITE || "claude-haiku-4-5",
};
const META_MODEL = "claude-haiku-4-5";

// Description de chaque archétype de structure (variété anti-empreinte).
const ARCHETYPES = {
  guide_complet: "Guide complet et approfondi : introduction large, sections H2 couvrant chaque sous-thème, tableau/liste si pertinent, conclusion actionnable.",
  guide_etape: "Guide étape par étape : H2 numérotés (Étape 1, 2, 3…), instructions concrètes.",
  comparatif: "Comparatif : présente 3-5 options avec un tableau comparatif et une recommandation finale.",
  guide_achat: "Guide d'achat : critères de choix en H2, puis recommandations selon les besoins.",
  explicatif: "Article explicatif : répond en profondeur à la question, cause/conséquence, exemples.",
  listicle: "Listicle : intro courte + H2 numérotés (7 façons de…, 5 astuces…), chacun bien développé.",
  erreurs: "Format 'erreurs à éviter' : liste d'erreurs fréquentes + comment les corriger.",
  narratif: "Article narratif : storytelling, ton chaleureux, exemples vécus.",
};

// Règles de rédaction du CORPS (partie stable -> mise en cache).
const REGLES_BODY = `Tu es un rédacteur web SEO expert francophone. Tu écris des articles de blog conçus pour RANKER sur Google.

Règles impératives :
- L'intro (100 premiers mots) répond DIRECTEMENT à la question/au besoin (pour le featured snippet).
- Structure en sections H2/H3 claires, paragraphes courts, listes à puces quand utile — texte scannable.
- Réutilise les questions du cluster comme sous-titres H2/H3.
- Densité de mot-clé NATURELLE : mot-clé cible + variantes sémantiques, JAMAIS de bourrage.
- Insère des LIENS INTERNES contextuels (<a href="...">) vers les pages/produits et articles fournis, uniquement là où c'est naturel.
- Contenu ORIGINAL, concret (exemples, chiffres, conseils actionnables). Aucune phrase de remplissage, aucun "en tant qu'IA", aucun placeholder.
- DATES : nous sommes en ${ANNEE}. Si tu mentionnes une année, utilise EXCLUSIVEMENT ${ANNEE}. N'utilise JAMAIS une autre année (2024, 2025…) et n'invente aucune date.
- FAITS : n'invente JAMAIS de statistiques, chiffres précis, pourcentages, études, sources ou citations. Si un chiffre n'est pas de notoriété commune, reste qualitatif. Ne prétends pas connaître des détails de produits que tu n'as pas (prix, specs) — décris de façon générale.
- SÉCURITÉ (produits bébé) : reste prudent, ne donne pas de conseil médical ; pour tout ce qui touche à la santé/sécurité du nourrisson, invite à consulter un professionnel de santé.
- DÉVELOPPE réellement chaque section (plusieurs paragraphes étoffés). Un article court est un article raté.

Format de sortie : renvoie UNIQUEMENT le corps de l'article en HTML propre (<h2>, <h3>, <p>, <ul>, <li>, <a>, <strong>).
N'inclus PAS le titre H1. N'inclus PAS de section FAQ. N'ajoute AUCUN texte avant ou après le HTML, pas de balises Markdown \`\`\`.`;

const META_SCHEMA = {
  type: "object",
  properties: {
    titre: { type: "string" },
    slug: { type: "string" },
    meta_description: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, reponse: { type: "string" } },
        required: ["question", "reponse"],
        additionalProperties: false,
      },
    },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: { position: { type: "string" }, requete: { type: "string" } },
        required: ["position", "requete"],
        additionalProperties: false,
      },
    },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["titre", "slug", "meta_description", "faq", "images", "tags"],
  additionalProperties: false,
};

function nettoyerHtml(txt) {
  return txt
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * Génère un article complet.
 * @returns { article, stopReason, model }
 */
export async function genererArticle(ctx, theme, clusterQuestions, linkTargets, siblings = []) {
  const model = MODELS[theme.role] || MODELS.satellite;
  const maxTokens = 8000; // marge : un article FR jusqu'à ~3000 mots + HTML dépasse 6000 tokens -> évite la troncature
  // Longueur : 600-3000 mots pour TOUS. Cibles volontairement basses car le modèle a tendance
  // à dépasser -> avec ces cibles il reste naturellement sous 3000.
  const cible = theme.role === "pilier" ? "1500 à 2200" : "700 à 1300";
  const nbH2 = theme.role === "pilier" ? 6 : 4;

  const systemStore = `Contexte boutique :
- Niche : ${ctx.niche}
- Nom : ${ctx.shop?.nom || ""}
- Description : ${ctx.shop?.description || ""}
${ctx.infos_md}
Écris en ${ctx.langue === "fr" ? "français" : ctx.langue}.`;

  const produitsListe = (linkTargets.produits || []).map((p) => `- ${p.titre} : ${p.url}`).join("\n");
  const articlesListe = (linkTargets.articles || []).map((a) => `- ${a.titre} : ${a.url}`).join("\n");

  const taskBody = `Rédige le corps d'un article de blog optimisé SEO.

MOT-CLÉ CIBLE : "${theme.mot_cle}" (volume ${theme.volume}, difficulté ${theme.kd})
CLUSTER : ${theme.cluster}
RÔLE : ${theme.role === "pilier" ? "PAGE PILIER (article central, large et complet)" : "article satellite (ciblé et précis)"}
FORMAT : ${ARCHETYPES[theme.archetype] || ARCHETYPES.listicle}
LONGUEUR : entre 600 et 3000 mots (vise ~${cible} mots pour ce type d'article, mais la longueur peut varier naturellement selon le sujet). Ne dépasse JAMAIS 3000 mots. Au moins ${nbH2} sections H2 réellement développées.

Mots-clés SECONDAIRES (variantes de la même requête — intègre-les NATURELLEMENT dans le texte pour couvrir toutes les formulations, sans bourrage ni répétition mécanique) :
${(theme.variantes && theme.variantes.length) ? theme.variantes.slice(0, 12).join(", ") : "(aucun)"}

Articles DÉJÀ publiés dans ce cluster — NE répète PAS leur contenu, traite un angle DISTINCT et complémentaire :
${siblings.length ? siblings.map((s) => `- ${s}`).join("\n") : "(aucun — tu es le premier du cluster)"}

Questions liées du même cluster (à exploiter en H2/H3) :
${clusterQuestions.map((q) => `- ${q}`).join("\n") || "(aucune)"}

Liens internes à insérer naturellement :
Produits/collections :
${produitsListe || "(aucun)"}
Autres articles du cluster :
${articlesListe || "(aucun)"}`;

  // --- Appel 1 : corps (texte libre, long) ---
  const bodyResp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: REGLES_BODY, cache_control: { type: "ephemeral" } },
      { type: "text", text: systemStore },
    ],
    messages: [{ role: "user", content: taskBody }],
    ...(model.startsWith("claude-sonnet-5") ? { thinking: { type: "disabled" } } : {}),
  });
  addUsage(model, bodyResp.usage);

  if (bodyResp.stop_reason === "refusal") throw new Error("IA a refusé la rédaction (refusal)");
  const bodyBlock = bodyResp.content.find((b) => b.type === "text");
  if (!bodyBlock) throw new Error("Réponse IA sans corps");
  const body_html = nettoyerHtml(bodyBlock.text);

  // --- Appel 2 : métadonnées (JSON structuré, Haiku) ---
  const taskMeta = `Voici un article de blog en HTML. Produis ses métadonnées SEO au format JSON.

MOT-CLÉ CIBLE : "${theme.mot_cle}"
CLUSTER : ${theme.cluster}
Questions du cluster (pour la FAQ) :
${clusterQuestions.map((q) => `- ${q}`).join("\n") || "(aucune)"}

Contraintes :
- titre : contient le mot-clé, **entre 45 et 60 caractères** (un titre trop court performe moins en SEO — étoffe-le), accrocheur. N'inclus une année QUE si le sujet l'exige vraiment (tendances, nouveautés, "meilleures X de l'année", actualité). Pour un guide/tuto intemporel, PAS d'année. Si tu mets une année, ce doit être EXCLUSIVEMENT "${ANNEE}".
- slug : court, basé sur le mot-clé, minuscules-avec-tirets, sans accents, SANS année (l'URL doit rester permanente).
- meta_description : 110-160 caractères, avec le mot-clé et une accroche. L'année "${ANNEE}" est permise, aucune autre.
- Nous sommes en ${ANNEE}. La SEULE année autorisée partout est ${ANNEE}. N'invente aucune date.
- faq : 3 à 5 questions/réponses pertinentes (issues ou inspirées des questions du cluster), réponses concises.
- images : 0, 1 ou 2 images selon la pertinence, chaque requête de recherche EN ANGLAIS + sa position.
- tags : 3-6 tags dont "${theme.cluster}".

ARTICLE :
${body_html.slice(0, 12000)}`;

  const metaResp = await client.messages.create({
    model: META_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: taskMeta }],
    output_config: { format: { type: "json_schema", schema: META_SCHEMA } },
  });
  addUsage(META_MODEL, metaResp.usage);

  const metaBlock = metaResp.content.find((b) => b.type === "text");
  let meta;
  try {
    meta = JSON.parse(metaBlock.text);
  } catch {
    throw new Error("Métadonnées JSON invalides");
  }

  return {
    article: { ...meta, body_html },
    stopReason: bodyResp.stop_reason,
    model,
  };
}

/** Génère un court complément HTML pour rafraîchir un article existant. */
export async function genererComplement(motCle, titre, langue) {
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    system:
      "Tu enrichis un article de blog existant avec un court complément frais et utile (2-3 paragraphes max), sans répéter le contenu déjà présent. Renvoie UNIQUEMENT du HTML propre (un <h3> puis des <p>).",
    messages: [
      {
        role: "user",
        content: `Article : « ${titre} » (mot-clé : ${motCle}). Ajoute une section courte et pertinente en ${
          langue === "fr" ? "français" : langue
        } : une nouveauté, une astuce, ou un point souvent oublié. HTML uniquement, pas d'introduction.`,
      },
    ],
  });
  addUsage("claude-haiku-4-5", resp.usage);
  const block = resp.content.find((b) => b.type === "text");
  return block ? nettoyerHtml(block.text) : "";
}
