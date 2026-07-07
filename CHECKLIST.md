# ✅ CHECKLIST — Bot SEO Shopify

> Mise à jour au fur et à mesure. Trois sections : ce qui est **fait** (code), ce qu'il faut **vérifier**, et ce dont j'ai **besoin de toi** (à faire ensemble à la fin).

---

## ✅ FAIT AUTOMATIQUEMENT (le code est prêt)

| Module | Fichier | Statut |
|---|---|---|
| Squelette projet (package.json, .gitignore, .env.example) | `/` | ✅ |
| Workflow cron GitHub Actions | `.github/workflows/daily.yml` | ✅ |
| Config publique + fusion secrets | `src/config.js` | ✅ |
| État JSON + commit git | `src/state.js` | ✅ |
| Calcul du coût IA | `src/cost.js` | ✅ |
| Parsing CSV SEMrush + clusters + rôles pilier/satellite | `src/clusters.js` | ✅ |
| Priorisation mots-clés (KD faible → volume, questions, pilier d'abord) | `src/keywords.js` | ✅ |
| Contexte boutique (Shopify live + infos.md) | `src/store-context.js` | ✅ |
| Client Shopify GraphQL (contexte, produits, créer/éditer article) | `src/shopify.js` | ✅ |
| Génération IA (Sonnet pilier / Haiku satellite, structured output, caching) | `src/generate.js` | ✅ |
| Validation qualité déterministe | `src/validate.js` | ✅ |
| Images banques gratuites (Pexels + fallback Unsplash) + attribution | `src/images.js` | ✅ |
| SEO : FAQ + schema JSON-LD (Article + FAQPage) + crédits | `src/seo.js` | ✅ |
| Maillage interne (cibles) + bidirectionnel | `src/linking.js` | ✅ |
| IndexNow (Bing/Yandex) | `src/indexnow.js` | ✅ |
| Rafraîchissement hebdo | `src/refresh.js` | ✅ |
| Journal + digest Telegram | `src/telegram.js` | ✅ |
| Orchestrateur (pipeline auto-réparant) | `src/index.js` | ✅ |
| Boutique d'exemple + CSV d'exemple | `boutiques/boutique-1/` | ✅ |
| **Commande de crawl** (choix boutique → crawle tout le catalogue → `contexte-shopify.json`) | `src/crawl.js` (`npm run crawl`) | ✅ testé (174 produits) |
| **Commande thèmes** (génère/affiche la liste des thèmes sans rien rédiger) | `src/themes.js` (`npm run themes`) | ✅ testé |

**Leviers SEO implémentés :** mots-clés réels triés par opportunité · pilier-cluster · archétypes variés selon l'intention · FAQ schema · maillage bidirectionnel · IndexNow · refresh hebdo · E-E-A-T (auteur + dates + schema) · meta/slug/alt.

**Modèle auto-réparant :** thème marqué utilisé qu'après publication · retries backoff · image manquante → brouillon + alerte · article cassé → thème reste libre + escalade après 3 échecs · toujours vert sauf crash/échec Telegram.

---

## ⚠️ À VÉRIFIER AU 1er RUN (points d'incertitude technique)

- [ ] **Champs GraphQL Shopify** : les mutations `articleCreate` / `articleUpdate` et l'input `ArticleCreateInput` (version `2025-07`) — à tester sur une vraie boutique, ajuster les noms de champs si rejet. → `src/shopify.js`
- [ ] **Injection du JSON-LD** : vérifier que Shopify ne strippe pas le `<script type="application/ld+json">` du corps d'article. → `src/seo.js`
- [ ] **Format exact des CSV SEMrush** : noms de colonnes réels de tes exports (le parser gère plusieurs variantes, mais à confirmer). → `src/clusters.js`
- [ ] **URL admin des brouillons** : le lien vers l'admin Shopify est en best-effort, à confirmer. → `src/index.js` (`adminArticleUrl`)
- [ ] **Scopes du custom app Shopify** : `write_content`, `read_content`, `read_products`.

---

## 🔴 CE DONT J'AI BESOIN DE TOI (à faire ensemble à la fin)

### 1. Bot Telegram — ✅ FAIT
- [x] Bot créé : **@BlogSeoEcommerceBot**, token en place dans `.env`.
- [x] `TELEGRAM_CHAT_ID` récupéré (924548946) et testé : message envoyé et reçu via `src/telegram.js`.
- [ ] ⏳ Reste juste : recopier `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` dans les **GitHub Secrets** (pour la prod).

### 2. Clés & secrets
- [x] `ANTHROPIC_API_KEY` en place dans `.env` + **génération d'article testée en réel** (pilier 1757 mots, validation OK, 0,08 €).
- [ ] Par boutique : **token Admin API Shopify** (custom app) + **clé API Pexels** (gratuite sur pexels.com/api). (Unsplash optionnel.)
- [ ] Composer le JSON `STORES_SECRETS` avec tout ça.

### 3. GitHub
- [ ] Créer le repo, y pousser ce dossier.
- [ ] Ajouter les **GitHub Secrets** : `ANTHROPIC_API_KEY`, `STORES_SECRETS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### 4. Par boutique (onboarding)
- [ ] Créer un blog **« Blog »** dans Shopify (handle `blog`).
- [ ] Exporter **`keywords.csv`** SEMrush (filtré KD<30) → `boutiques/<id>/semrush/`. **`clusters.csv` optionnel** (si absent → clustering IA automatique).
- [ ] Écrire 3 lignes dans `boutiques/<id>/infos.md` (ton, persona, auteur).
- [ ] Ajouter l'entrée dans `stores.json`.
- [ ] *(GSC déjà fait ✅)*

### 5. IndexNow (optionnel mais recommandé — Bing/Yandex)
- [ ] Générer une clé (UUID) par domaine, héberger `https://<domaine>/<clé>.txt` (contenu = la clé).
- [ ] Ajouter `indexnow_key` (et éventuellement `indexnow_key_location`) dans `stores.json`.
- [ ] Si non configuré, le bot saute IndexNow sans erreur.

---

## 🧪 VÉRIFICATIONS DÉJÀ EFFECTUÉES

- [x] Les 17 fichiers `src/*.js` parsent sans erreur (`node --check`).
- [x] `npm install` OK (42 paquets).
- [x] Test de la logique hors-ligne avec la boutique d'exemple :
  - [x] Parsing CSV → 10 thèmes, 3 piliers correctement désignés (plus gros volume/cluster).
  - [x] Priorisation → choisit bien le pilier d'abord (archétype `guide_complet`).
  - [x] Validation → accepte un bon article, rejette un mauvais (trop court, meta, langue).
  - [x] Assemblage SEO → JSON-LD (Article + FAQPage) + crédits photo présents.

- [x] **Telegram testé en réel** : digest envoyé et reçu via `src/telegram.js`.
- [x] **Génération IA testée en réel** (pilier « veilleuse bébé ») : 1757 mots, validation OK, JSON-LD + FAQPage, coût 0,08 €.
  - 🔧 Correctif apporté : génération en **2 appels** (corps en texte libre pour la longueur + méta en JSON via Haiku) — le JSON structuré bridait le modèle à ~270 mots. Check "ponctuation finale" retiré (faux positifs sur les listes).

- [x] **Shopify testé en réel** (boutique « L'Atelier Veilleuse ») : token OAuth obtenu, `articleCreate` + metafields SEO + `articleDelete` validés, **pipeline complet publié un article brouillon** (18 522 car., JSON-LD + FAQPage + auteur + tags/cluster). Vérifié sur la boutique.
  - 🔧 Correctifs : `sortKey: BEST_SELLING` retiré (invalide sur Admin API) → les liens internes produits marchent au prochain run ; erreurs GraphQL non re-essayées (logiques, pas transitoires).
  - 🔒 `FORCE_DRAFT=1` ajouté : tant que c'est actif, rien ne passe en public (sécurité tests).

- [x] **Chaîne complète validée avec image** (2ᵉ article, pilier « veilleuse projecteur plafond ») : image Pexels uploadée sur le CDN Shopify + alt, **12 liens internes produits** (via le crawl), crédit photo. Brouillon.
- [x] **Crawl testé** : 174 produits / 29 collections / 6 pages → `contexte-shopify.json`.

- [x] **Coût optimisé → tout Haiku 4.5** (configurable `.env`). Pilier Haiku ~0,04 € (3142 mots, plus long que Sonnet), satellite ~0,02 €. **≈ 6 €/mois pour 10 boutiques** (72 €/an). Plafond longueur relevé (4000 piliers / 3000 satellites).

**➡️ Il ne reste QUE : passer en public (`FORCE_DRAFT=0`) + scaler aux autres boutiques + GitHub Secrets.**

---

## 🚦 État global

- **Code** : ✅ complet (v1) et vérifié hors-ligne
- **Telegram** : ✅ configuré et testé (message reçu)
- **Vérifs techniques 1er run** : ⏳ à faire (surtout Shopify GraphQL, avec un vrai token)
- **Setup restant côté toi** : 🔴 Anthropic key · Shopify token + Pexels key par boutique · CSV SEMrush · GitHub Secrets
