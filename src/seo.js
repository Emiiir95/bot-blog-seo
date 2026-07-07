// Assemble le corps HTML final : FAQ + attribution image + schema JSON-LD (Article + FAQPage).
import { today } from "./utils.js";

function escapeHtml(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function faqHtml(faq = []) {
  if (!faq.length) return "";
  const items = faq
    .map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.reponse)}</p>`)
    .join("\n");
  return `\n<h2>Questions fréquentes</h2>\n${items}\n`;
}

function jsonLd(article, ctx, url, image) {
  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.titre,
      description: article.meta_description,
      author: { "@type": "Person", name: ctx.auteur },
      datePublished: today(),
      dateModified: today(),
      mainEntityOfPage: url,
      ...(image?.url ? { image: [image.url] } : {}),
    },
  ];
  if (article.faq?.length) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: article.faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.reponse },
      })),
    });
  }
  return `\n<script type="application/ld+json">${JSON.stringify(graph)}</script>\n`;
}

/**
 * Construit le body_html final prêt à publier.
 * @returns le HTML complet (corps + FAQ + crédits + JSON-LD)
 */
export function assemblerBody(article, ctx, { url, image }) {
  return (
    article.body_html +
    faqHtml(article.faq) +
    jsonLd(article, ctx, url, image)
  );
}
