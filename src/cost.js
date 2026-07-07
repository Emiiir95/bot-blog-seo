// Calcul du coût IA à partir des tokens consommés.
// Tarifs $/1M tokens (input, output). À jour au moment de l'écriture.
const PRICING = {
  "claude-sonnet-5": { in: 3.0, out: 15.0 }, // tarif standard (intro $2/$10 jusqu'au 2026-08-31)
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

// Taux de change approximatif USD -> EUR (ajustable).
const USD_TO_EUR = 0.92;

const _totals = { usd: 0, calls: 0 };

export function addUsage(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  const inTok =
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  const usd = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  _totals.usd += usd;
  _totals.calls += 1;
  return usd;
}

export function getCostSummary() {
  const eurJour = _totals.usd * USD_TO_EUR;
  // Projection mensuelle : coût du run × 30 jours.
  const eurMois = eurJour * 30;
  return {
    eurJour: eurJour.toFixed(2),
    eurMois: eurMois.toFixed(2),
    calls: _totals.calls,
  };
}
