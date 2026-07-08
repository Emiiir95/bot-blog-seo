// Parse les CSV SEMrush, construit la liste des thèmes avec cluster + rôle (pilier/satellite).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import Anthropic from "@anthropic-ai/sdk";
import { ROOT, env } from "./config.js";
import { addUsage } from "./cost.js";

const client = new Anthropic({ apiKey: env.anthropicKey });

// Filtres appliqués aux exports SEMrush volumineux (l'utilisateur peut exporter tout le fichier).
const KD_MAX = 30; // on ne garde que les mots-clés "faciles" (stratégie easy-first)
const MAX_KEYWORDS = 400; // pool brut : la synthèse IA fusionne les proches -> vise ~200-250 thèmes DISTINCTS (~8 mois de contenu)

function storeDir(storeId) {
  return join(ROOT, "boutiques", storeId, "semrush");
}

function readCsv(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  // Tolérant : les exports SEMrush réels ont parfois des lignes malformées / guillemets non échappés.
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
  });
}

/** Normalise l'accès aux colonnes SEMrush (les noms peuvent varier légèrement). */
function col(row, ...names) {
  for (const n of names) {
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === n.toLowerCase()) return row[k];
    }
  }
  return undefined;
}

const STOPWORDS = new Set(["a", "à", "au", "aux", "de", "des", "du", "en", "et", "le", "la", "les", "un", "une", "pour", "avec", "sur", "dans", "par", "chez", "the"]);

// Enseignes concurrentes / marketplaces : ne doivent JAMAIS devenir un article de blog
// (on n'écrit pas un guide pour la boutique d'un concurrent). Extensible au besoin.
// NB : on évite les mots trop génériques ("but", "action") pour ne pas faire de faux positifs.
const JUNK_RE = /\b(maxi ?zoo|zooplus|gifi|ikea|amazone?|temu|shein|aliexpress|cdiscount|leroy ?merlin|conforama|kiabi|lidl|aldi|noz|centrakor|maison ?du ?monde|la ?foir'?fouille|aubert|orchestra|king ?jouet|bebe ?9|leclerc|carrefour|auchan|jardiland|truffaut|animalis|zoomalia|botanic|gamm ?vert|manomano|le ?bon ?coin|leboncoin|stokomani|bricomarch[eé]|villaverde|castorama|decathlon|b ?& ?m)\b/i;

/** Forme canonique d'un mot-clé : sert à détecter les quasi-doublons (accents, pluriels, mots-outils, ordre). */
export function normaliserMotCle(k) {
  return String(k)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => w.replace(/s$/, "")) // singulier grossier
    .sort()
    .join(" ");
}

export function loadKeywordRows(storeId) {
  const brut = readCsv(join(storeDir(storeId), "keywords.csv"))
    .map((r) => ({
      mot_cle: col(r, "Keyword", "keyword"),
      volume: Number(col(r, "Volume", "search volume") || 0),
      kd: Number(col(r, "Keyword Difficulty", "KD", "difficulty", "kd %", "keyword difficulty %") || 0),
      intent: (col(r, "Intent", "intention") || "").toLowerCase(),
    }))
    .filter((r) => r.mot_cle && r.kd <= KD_MAX && !JUNK_RE.test(r.mot_cle));

  // Déduplication anti-cannibalisation : les variantes quasi-identiques fusionnent en UN thème.
  const groupes = new Map();
  for (const r of brut) {
    const clef = normaliserMotCle(r.mot_cle);
    if (!clef) continue;
    if (!groupes.has(clef)) groupes.set(clef, []);
    groupes.get(clef).push(r);
  }
  const dedup = [];
  for (const grp of groupes.values()) {
    grp.sort((a, b) => b.volume - a.volume);
    const primaire = grp[0];
    primaire.variantes = grp.slice(1).map((g) => g.mot_cle); // variantes = mots-clés secondaires du même article
    dedup.push(primaire);
  }
  // Top par volume → gère les exports énormes (repo léger + clustering IA faisable).
  dedup.sort((a, b) => b.volume - a.volume);
  return dedup.slice(0, MAX_KEYWORDS);
}

/** Charge le mapping mot-clé -> cluster depuis clusters.csv, ou null si le fichier est absent. */
export function loadClusterMap(storeId) {
  const file = join(storeDir(storeId), "clusters.csv");
  if (!existsSync(file)) return null;
  const map = new Map();
  for (const r of readCsv(file)) {
    const kw = col(r, "Keyword", "keyword");
    const cl = col(r, "Cluster", "cluster");
    if (kw && cl) map.set(kw.trim().toLowerCase(), cl.trim());
  }
  return map.size ? map : null;
}

const PERTINENCE_SCHEMA = {
  type: "object",
  properties: { gardes: { type: "array", items: { type: "string" } } },
  required: ["gardes"],
  additionalProperties: false,
};

/**
 * Filtre IA de PERTINENCE : ne garde que les mots-clés réellement dans la niche.
 * Retire lieux, idiomes/expressions, autres produits homonymes (veilleuse de voiture/chaudière,
 * app…), enseignes concurrentes, offres d'emploi — ce qu'un filtre par mots ne peut pas attraper.
 */
export async function filtrerPertinenceIA(rows, niche) {
  if (!rows.length) return rows;
  const liste = rows.map((r) => r.mot_cle);
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: `Niche de la boutique : « ${niche} ».
Voici des mots-clés SEO. Renvoie dans "gardes" UNIQUEMENT ceux qui désignent un produit ou un sujet RÉELLEMENT dans cette niche (ce que la boutique vend, ou des conseils directement autour de ces produits).

EXCLUS impitoyablement (ne les mets PAS dans "gardes") :
- lieux et établissements (restaurants, hôtels, plages, bars, villes, clubs), noms propres de lieux ;
- idiomes / expressions (ex. « mettre en veilleuse »), références culturelles, littéraires ou musicales ;
- AUTRES produits qui partagent seulement un mot avec la niche (ex. veilleuse de voiture, veilleuse de chaudière à gaz, application/logiciel, ampoule automobile) ;
- enseignes, magasins, marketplaces ou marques concurrentes ;
- offres d'emploi / métiers.

En cas de doute sur l'appartenance réelle à la niche, EXCLUS.

Mots-clés :
${liste.map((k) => `- ${k}`).join("\n")}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: PERTINENCE_SCHEMA } },
  });
  addUsage("claude-haiku-4-5", resp.usage);
  const block = resp.content.find((b) => b.type === "text");
  const gardes = new Set((JSON.parse(block.text).gardes || []).map((k) => String(k).trim().toLowerCase()));
  const kept = rows.filter((r) => gardes.has(r.mot_cle.trim().toLowerCase()));
  return kept.length ? kept : rows; // sécurité : jamais tout jeter si l'IA bugue
}

/**
 * Regroupe les mots-clés en clusters via l'IA (fallback quand clusters.csv est absent).
 * Un seul appel Haiku, exécuté une fois au premier seed. Renvoie Map(mot_cle -> cluster).
 */
export async function clusterWithAI(keywordRows, niche) {
  const liste = keywordRows.map((r) => r.mot_cle);
  const schema = {
    type: "object",
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nom: { type: "string" },
            mots_cles: { type: "array", items: { type: "string" } },
          },
          required: ["nom", "mots_cles"],
          additionalProperties: false,
        },
      },
    },
    required: ["clusters"],
    additionalProperties: false,
  };

  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: `Regroupe ces mots-clés SEO (niche : ${niche}) en clusters thématiques cohérents. Chaque cluster = un sujet central ; chaque mot-clé doit appartenir à exactement un cluster. Nomme chaque cluster par son thème (court). Les mots-clés proches (même intention/sujet) vont ensemble.

Mots-clés :
${liste.map((k) => `- ${k}`).join("\n")}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema } },
  });
  addUsage("claude-haiku-4-5", resp.usage);

  const block = resp.content.find((b) => b.type === "text");
  const data = JSON.parse(block.text);
  const map = new Map();
  for (const c of data.clusters || []) {
    for (const kw of c.mots_cles || []) map.set(String(kw).trim().toLowerCase(), c.nom);
  }
  return map;
}

const QUESTION_RE = /^(comment|quelle?s?|quel|pourquoi|quand|où|est-ce|à quel|combien|que|qui)\b|\?/i;

function isQuestion(kw) {
  return QUESTION_RE.test(kw);
}

/** Déduit l'intention et l'archétype de format à partir de l'intent SEMrush + du mot-clé. */
export function deriveIntentAndArchetype(kw, intent) {
  if (isQuestion(kw)) {
    if (/^comment\b/i.test(kw)) return { intention: "how_to", archetype: "guide_etape" };
    return { intention: "informationnelle", archetype: "explicatif" };
  }
  if (/commercial|transaction/i.test(intent)) {
    if (/meilleure?|comparatif|vs|top \d/i.test(kw)) return { intention: "comparatif", archetype: "comparatif" };
    return { intention: "commerciale", archetype: "guide_achat" };
  }
  // Par défaut : listicle (varié, scannable)
  return { intention: "generale", archetype: "listicle" };
}

const ARCHETYPE_KEYS = ["guide_complet", "guide_etape", "comparatif", "guide_achat", "explicatif", "listicle", "erreurs", "narratif"];

const THEME_SYNTH_SCHEMA = {
  type: "object",
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titre: { type: "string" }, // intitulé court et distinct du sujet (pas le titre SEO final)
          mot_cle_principal: { type: "string" },
          mots_cles_secondaires: { type: "array", items: { type: "string" } },
          role: { type: "string", enum: ["pilier", "satellite"] },
          archetype: { type: "string", enum: ARCHETYPE_KEYS },
        },
        required: ["titre", "mot_cle_principal", "mots_cles_secondaires", "role", "archetype"],
        additionalProperties: false,
      },
    },
  },
  required: ["articles"],
  additionalProperties: false,
};

/**
 * Synthèse IA : transforme les mots-clés d'un cluster en ARTICLES DE BLOG DISTINCTS.
 * Les mots-clés quasi-identiques / traités dans le même article fusionnent en un seul thème.
 */
async function synthetiserCluster(clusterName, rows, niche) {
  const liste = rows.map((r) => `- ${r.mot_cle} (vol ${r.volume})`).join("\n");
  const resp = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: `Tu planifies un blog SEO pour la niche : ${niche}.
Cluster thématique : « ${clusterName} ».
Voici les mots-clés SEMrush réels de ce cluster (avec volume de recherche) :
${liste}

Transforme-les en une liste d'ARTICLES DE BLOG DISTINCTS. Règles STRICTES :
- Chaque article = UN sujet unique. JAMAIS deux articles sur le même sujet ni sur des sujets qui se cannibaliseraient.
- Les mots-clés quasi-identiques, variantes, synonymes, fautes d'orthographe, ou qui seraient naturellement traités DANS LE MÊME article → regroupe-les en UN SEUL article : le plus gros volume devient "mot_cle_principal", les autres "mots_cles_secondaires".
- "role" : "pilier" = le sujet le plus large et à plus fort volume du cluster (0 ou 1 pilier), les autres = "satellite", chacun avec un ANGLE réellement différent.
- Ignore les mots-clés hors-sujet, marques concurrentes ou non pertinents pour un blog (ne les force pas dans un article).
- "titre" = intitulé court et DISTINCT du sujet (pas le titre SEO final, juste pour te repérer).
- "archetype" parmi : ${ARCHETYPE_KEYS.join(", ")} — choisis selon l'intention (question → explicatif/guide_etape, comparaison → comparatif, achat → guide_achat, sujet large → guide_complet).`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: THEME_SYNTH_SCHEMA } },
  });
  addUsage("claude-haiku-4-5", resp.usage);
  const block = resp.content.find((b) => b.type === "text");
  const data = JSON.parse(block.text);
  return data.articles || [];
}

/** Fallback mécanique (1 mot-clé = 1 thème) si la synthèse IA échoue sur un cluster. */
function buildClusterMecanique(cluster, list) {
  const sorted = [...list].sort((a, b) => b.volume - a.volume);
  let iSat = 0;
  return sorted.map((r, i) => {
    const { intention } = deriveIntentAndArchetype(r.mot_cle, r.intent);
    const question = isQuestion(r.mot_cle);
    let archetype;
    if (i === 0) {
      archetype = "guide_complet";
    } else {
      const pool = question ? ARCH_QUESTION : ARCH_COMMERCIAL;
      archetype = pool[iSat % pool.length];
      iSat++;
    }
    return {
      mot_cle: r.mot_cle,
      volume: r.volume,
      kd: r.kd,
      cluster,
      role: i === 0 ? "pilier" : "satellite",
      intention,
      archetype,
      est_question: question,
      variantes: r.variantes || [],
      statut: "libre",
    };
  });
}

/**
 * Construit la liste des thèmes : clustering (CSV ou IA) puis SYNTHÈSE IA par cluster
 * → des thèmes tous DISTINCTS, ancrés sur les vrais mots-clés (variantes absorbées).
 */
export async function buildThemes(rows, clusterMap, niche) {
  clusterMap = clusterMap || new Map();
  const rowByKw = new Map(rows.map((r) => [r.mot_cle.trim().toLowerCase(), r]));

  // Regrouper par cluster.
  const byCluster = new Map();
  for (const r of rows) {
    const cluster = clusterMap.get(r.mot_cle.trim().toLowerCase()) || r.mot_cle;
    if (!byCluster.has(cluster)) byCluster.set(cluster, []);
    byCluster.get(cluster).push({ ...r, cluster });
  }

  const themes = [];
  const vus = new Set(); // anti-doublon de sujet INTER-cluster (forme canonique du titre/mot-clé)
  for (const [cluster, list] of byCluster) {
    let briefs = null;
    try {
      briefs = await synthetiserCluster(cluster, list, niche);
    } catch (e) {
      console.warn(`  ⚠️ synthèse IA KO pour le cluster "${cluster}" (${e.message}) → fallback mécanique.`);
    }
    if (!briefs || !briefs.length) {
      for (const t of buildClusterMecanique(cluster, list)) {
        const clef = normaliserMotCle(t.mot_cle);
        if (vus.has(clef)) continue;
        vus.add(clef);
        themes.push(t);
      }
      continue;
    }
    for (const b of briefs) {
      const principal = String(b.mot_cle_principal || "").trim();
      if (!principal) continue;
      const clef = normaliserMotCle(b.titre || principal) || normaliserMotCle(principal);
      if (vus.has(clef)) continue; // déjà un article sur ce sujet
      vus.add(clef);
      const row = rowByKw.get(principal.toLowerCase());
      const archetype = ARCHETYPE_KEYS.includes(b.archetype)
        ? b.archetype
        : b.role === "pilier" ? "guide_complet" : "listicle";
      themes.push({
        mot_cle: principal,
        volume: row ? row.volume : 0,
        kd: row ? row.kd : 0,
        cluster,
        role: b.role === "pilier" ? "pilier" : "satellite",
        intention: deriveIntentAndArchetype(principal, row ? row.intent : "").intention,
        archetype,
        est_question: isQuestion(principal),
        variantes: Array.isArray(b.mots_cles_secondaires) ? b.mots_cles_secondaires : [],
        titre_indicatif: b.titre || "",
        statut: "libre",
      });
    }
  }
  return themes;
}

// Pools d'archétypes pour la rotation intra-cluster (cohérents avec l'intention).
const ARCH_QUESTION = ["explicatif", "guide_etape", "listicle", "erreurs"];
const ARCH_COMMERCIAL = ["guide_achat", "comparatif", "listicle", "narratif"];
