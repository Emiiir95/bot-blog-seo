// Journal d'activité + envoi du digest quotidien Telegram (Option A : 1 message après le run).
import { env } from "./config.js";

export function createJournal() {
  const lignes = [];
  const actions = []; // ACTION REQUISE (brouillons à valider)
  const compteurs = { publies: 0, brouillons: 0, echecs: 0, regen: 0 };

  // Libellé de la source d'image (pour que l'utilisateur sache quoi vérifier).
  const labelImage = (src) =>
    src === "ia" ? "🖼️ image IA" : src === "pexels" ? "📷 image Pexels (à vérifier)" : "❌ sans image";

  return {
    publie({ storeId, domaine, titre, mots, imageSource }) {
      compteurs.publies++;
      lignes.push(`✅ ${storeId} (${domaine})\n   « ${titre} »\n   ${labelImage(imageSource)} · ${mots} mots`);
    },
    brouillon({ storeId, domaine, titre, adminUrl, raison, imageSource }) {
      compteurs.brouillons++;
      lignes.push(`📝 ${storeId} (${domaine}) — À VALIDER\n   « ${titre} »\n   ${labelImage(imageSource)} · ⚠️ ${raison} → BROUILLON`);
      actions.push(`• ${storeId} : ${raison} 👉 ${adminUrl}`);
    },
    echec({ storeId, domaine, raison }) {
      compteurs.echecs++;
      lignes.push(`❌ ${storeId} (${domaine})\n   ${raison}\n   Thème resté libre, re-tenté demain`);
    },
    regen({ storeId }) {
      compteurs.regen++;
      lignes.push(`♻️ ${storeId} — thèmes (re)générés depuis les CSV`);
    },
    info(msg) {
      lignes.push(`ℹ️ ${msg}`);
    },
    build(cost) {
      const date = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
      let msg = `🤖 Rapport quotidien — ${date}\n\n`;
      msg += `✅ ${compteurs.publies} publiés · 📝 ${compteurs.brouillons} brouillons · ❌ ${compteurs.echecs} échecs`;
      if (compteurs.regen) msg += ` · ♻️ ${compteurs.regen}`;
      msg += `\n\n━━━━━━━━━━━━━━━━━━\n${lignes.join("\n\n")}\n━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n💰 Coût du jour : ${cost.eurJour} € · projeté ~${cost.eurMois} €/mois`;
      msg += `\n   ✍️ Texte : ${cost.texteEurJour} € · 🖼️ Images : ${cost.imagesEurJour} € (${cost.images})`;
      if (actions.length) msg += `\n\n⚠️ ACTION REQUISE\n${actions.join("\n")}`;
      return msg;
    },
  };
}

/** Envoie le message Telegram. Lève une erreur si l'envoi échoue (→ run rouge). */
export async function sendTelegram(text) {
  if (!env.telegramToken || !env.telegramChatId) {
    console.warn("⚠️ Telegram non configuré — digest affiché en console:\n" + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram HTTP ${res.status}: ${body}`);
  }
}
