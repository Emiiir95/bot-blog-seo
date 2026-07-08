// Génération d'image IA via l'API OpenAI (gpt-image-1) — image d'en-tête au format blog.
// Anthropic ne génère pas d'images ; on utilise donc OpenAI. Renvoie les octets PNG.
import { env } from "./config.js";
import { withRetry } from "./utils.js";
import { addImageCost } from "./cost.js";

// Style uniforme "blog" appliqué à chaque image -> rendu cohérent sur tout le site.
function promptBlog(sujet, niche) {
  return `Photo éditoriale horizontale pour un article de blog (niche : ${niche}). Sujet : ${sujet}. \
Style : photoréaliste, lumière naturelle douce, ambiance chaleureuse et soignée, composition épurée, \
couleurs harmonieuses. AUCUN texte, AUCUN logo, AUCun watermark, pas de collage. Image propre utilisable en bannière d'article.`;
}

/**
 * Génère une image via OpenAI et renvoie { buffer, mime, prompt } (ou null si indisponible/erreur).
 * @param {string} sujet  description courte du visuel (en français ou anglais)
 * @param {string} niche  niche de la boutique (pour cadrer le style)
 */
export async function genererImageIA(sujet, niche) {
  if (!env.openaiKey) return null;
  const prompt = promptBlog(sujet, niche);
  return withRetry(
    async () => {
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: "1536x1024", // format paysage, idéal bannière d'article
          quality: env.imageQuality,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const e = new Error(`OpenAI images HTTP ${res.status}: ${txt.slice(0, 200)}`);
        e.status = res.status;
        throw e;
      }
      const data = await res.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI: réponse sans image");
      addImageCost(env.imageQuality); // comptabilise le coût de l'image générée
      return { buffer: Buffer.from(b64, "base64"), mime: "image/png", prompt };
    },
    { label: "image-ia", tries: 2, backoff: [2000, 6000] }
  );
}
