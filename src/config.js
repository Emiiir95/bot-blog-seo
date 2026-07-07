// Charge la config publique (stores.json) + les secrets (STORES_SECRETS) et les fusionne par id.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

export function loadStores() {
  const stores = JSON.parse(readFileSync(join(ROOT, "stores.json"), "utf8"));

  let secrets = {};
  if (process.env.STORES_SECRETS) {
    try {
      secrets = JSON.parse(process.env.STORES_SECRETS);
    } catch {
      throw new Error("STORES_SECRETS n'est pas un JSON valide.");
    }
  }

  return stores.map((s) => {
    const sec = secrets[s.id] || {};
    if (!sec.shopify_token) {
      console.warn(`⚠️  Pas de shopify_token pour ${s.id} dans STORES_SECRETS`);
    }
    return {
      ...s,
      shopify_token: sec.shopify_token,
      pexels_key: sec.pexels_key,
    };
  });
}

export const env = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  commitState: process.env.COMMIT_STATE === "1",
  forceDraft: process.env.FORCE_DRAFT === "1",
};

// Version de l'API Admin Shopify (à vérifier au fil des mises à jour Shopify).
export const SHOPIFY_API_VERSION = "2025-07";
