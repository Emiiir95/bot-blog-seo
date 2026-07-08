// Calcul du coût IA à partir des tokens consommés.
// Tarifs $/1M tokens (input, output). À jour au moment de l'écriture.
const PRICING = {
  "claude-sonnet-5": { in: 3.0, out: 15.0 }, // tarif standard (intro $2/$10 jusqu'au 2026-08-31)
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

// Prix approximatif par image OpenAI gpt-image-1 en 1536×1024, selon la qualité ($/image).
const IMAGE_PRICING = { low: 0.016, medium: 0.063, high: 0.25 };

// Taux de change approximatif USD -> EUR (ajustable).
const USD_TO_EUR = 0.92;

const _totals = { textUsd: 0, imageUsd: 0, calls: 0, images: 0 };

export function addUsage(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  const inTok =
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  const usd = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  _totals.textUsd += usd;
  _totals.calls += 1;
  return usd;
}

/** Comptabilise le coût d'une image IA générée (OpenAI). */
export function addImageCost(quality = "medium") {
  const usd = IMAGE_PRICING[quality] ?? IMAGE_PRICING.medium;
  _totals.imageUsd += usd;
  _totals.images += 1;
  return usd;
}

export function getCostSummary() {
  const texteEur = _totals.textUsd * USD_TO_EUR;
  const imagesEur = _totals.imageUsd * USD_TO_EUR;
  const totalEur = texteEur + imagesEur;
  return {
    texteEurJour: texteEur.toFixed(2),
    imagesEurJour: imagesEur.toFixed(2),
    eurJour: totalEur.toFixed(2),
    // Projection mensuelle : coût du run × 30 jours.
    eurMois: (totalEur * 30).toFixed(2),
    images: _totals.images,
    calls: _totals.calls,
  };
}
