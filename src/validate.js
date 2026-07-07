// Validation déterministe de l'article avant publication.
import { franc } from "franc-min";
import { stripHtml, wordCount } from "./utils.js";

const PHRASES_INTERDITES = [/as an ai/i, /\[insér/i, /language model/i, /lorem ipsum/i, /en tant qu'?ia/i];

// Map ISO 639-3 (franc) -> code court attendu.
const LANG_MAP = { fra: "fr", eng: "en", spa: "es", deu: "de", ita: "it", por: "pt", nld: "nl" };

export function valider(article, { langue = "fr", stopReason = "end_turn", minMots = 600, maxMots = 4000 } = {}) {
  const raisons = [];

  // Champs présents
  for (const champ of ["titre", "body_html", "meta_description", "slug"]) {
    if (!article?.[champ] || String(article[champ]).trim() === "") {
      raisons.push(`champ manquant: ${champ}`);
    }
  }
  if (raisons.length) return { ok: false, raisons };

  // Pas tronqué : le JSON a parsé (garanti en amont) + stop_reason == end_turn suffisent.
  // (Pas de check "finit par ponctuation" : faux positifs sur les articles finissant par une liste.)
  const texte = stripHtml(article.body_html);
  if (stopReason !== "end_turn") raisons.push(`réponse tronquée (stop_reason=${stopReason})`);

  // Longueur
  const mots = wordCount(article.body_html);
  if (mots < minMots) raisons.push(`trop court (${mots} mots < ${minMots})`);
  if (mots > maxMots) raisons.push(`trop long (${mots} mots > ${maxMots})`);

  // Meta description
  const metaLen = article.meta_description.length;
  if (metaLen < 110 || metaLen > 160) raisons.push(`meta description ${metaLen} car. (hors 110-160)`);

  // Années : seule l'année courante réelle est autorisée dans le titre/meta (SEO),
  // et jamais d'année dans le slug (l'URL doit rester permanente).
  const anneeCourante = new Date().getFullYear();
  const trouverAnnees = (s) => String(s).match(/\b(?:19|20)\d{2}\b/g) || [];
  for (const [champ, val] of [
    ["titre", article.titre],
    ["meta", article.meta_description],
  ]) {
    const mauvaise = trouverAnnees(val).find((a) => Number(a) !== anneeCourante);
    if (mauvaise) raisons.push(`année incorrecte "${mauvaise}" dans le ${champ} (attendu ${anneeCourante})`);
  }
  if (trouverAnnees(article.slug).length) {
    raisons.push("année dans le slug (l'URL doit rester permanente — pas d'année)");
  }

  // Langue
  const detecte = LANG_MAP[franc(texte, { minLength: 20 })] || "?";
  if (detecte !== langue) raisons.push(`langue détectée "${detecte}" ≠ attendue "${langue}"`);

  // Phrases interdites
  const full = `${article.titre} ${texte}`;
  for (const re of PHRASES_INTERDITES) {
    if (re.test(full)) raisons.push(`phrase interdite: ${re}`);
  }

  return { ok: raisons.length === 0, raisons, mots };
}
