// Ping IndexNow (Bing/Yandex) à chaque publication. Gratuit.
//
// ⚠️ Setup une fois par domaine : générer une clé (UUID), héberger le fichier
// "<clé>.txt" (contenu = la clé) accessible à https://<domaine>/<clé>.txt, et
// renseigner la clé + son URL dans stores.json (indexnow_key / indexnow_key_location).
import { withRetry } from "./utils.js";

export async function pingIndexNow(store, url) {
  if (!store.indexnow_key) return false; // non configuré -> on saute silencieusement
  try {
    await withRetry(
      async () => {
        const res = await fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: store.domaine,
            key: store.indexnow_key,
            keyLocation:
              store.indexnow_key_location || `https://${store.domaine}/${store.indexnow_key}.txt`,
            urlList: [url],
          }),
        });
        if (!res.ok && res.status !== 202) {
          const e = new Error(`IndexNow HTTP ${res.status}`);
          e.status = res.status;
          throw e;
        }
      },
      { label: "indexnow", tries: 2, backoff: [1000, 3000] }
    );
    return true;
  } catch (e) {
    console.warn(`  ⚠️ IndexNow ${store.id}: ${e.message}`);
    return false;
  }
}
