// Parse les CSV SEMrush, construit la liste des thèmes avec cluster + rôle (pilier/satellite).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import Anthropic from "@anthropic-ai/sdk";
import { ROOT, env } from "./config.js";
import { addUsage } from "./cost.js";

const client = new Anthropic({ apiKey: env.anthropicKey });

function storeDir(storeId) {
  return join(ROOT, "boutiques", storeId, "semrush");
}

function readCsv(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true });
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

export function loadKeywordRows(storeId) {
  return readCsv(join(storeDir(storeId), "keywords.csv")).map((r) => ({
    mot_cle: col(r, "Keyword", "keyword"),
    volume: Number(col(r, "Volume", "search volume") || 0),
    kd: Number(col(r, "Keyword Difficulty", "KD", "difficulty") || 0),
    intent: (col(r, "Intent", "intention") || "").toLowerCase(),
  })).filter((r) => r.mot_cle);
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
    max_tokens: 4000,
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

/**
 * Construit la liste complète des thèmes à partir des CSV.
 * Pour chaque cluster : le mot-clé au plus gros volume = pilier, les autres = satellites.
 */
export function buildThemes(storeId, clusterMap) {
  const rows = loadKeywordRows(storeId);
  clusterMap = clusterMap || new Map();

  // Regrouper par cluster pour désigner le pilier.
  const byCluster = new Map();
  for (const r of rows) {
    const cluster = clusterMap.get(r.mot_cle.trim().toLowerCase()) || r.mot_cle;
    if (!byCluster.has(cluster)) byCluster.set(cluster, []);
    byCluster.get(cluster).push({ ...r, cluster });
  }

  const themes = [];
  for (const [cluster, list] of byCluster) {
    // Pilier = plus gros volume du cluster.
    const sorted = [...list].sort((a, b) => b.volume - a.volume);
    sorted.forEach((r, i) => {
      const { intention, archetype } = deriveIntentAndArchetype(r.mot_cle, r.intent);
      themes.push({
        mot_cle: r.mot_cle,
        volume: r.volume,
        kd: r.kd,
        cluster,
        role: i === 0 ? "pilier" : "satellite",
        intention,
        archetype: i === 0 ? "guide_complet" : archetype,
        est_question: isQuestion(r.mot_cle),
        statut: "libre",
      });
    });
  }
  return themes;
}
