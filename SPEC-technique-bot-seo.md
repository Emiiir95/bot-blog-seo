# 🛠️ SPEC TECHNIQUE — Bot SEO multi-boutiques Shopify (Node.js)

> Spécification d'implémentation. À lire avec `RECAP-COMPLET-bot-seo.md` (qui contient toutes les décisions & le *pourquoi*).
> Stack : **Node.js** (ESM, `"type": "module"` dans `package.json`).

---

## 1. Stack & dépendances

| Besoin | Librairie proposée |
|---|---|
| Appels IA (rédaction) | `@anthropic-ai/sdk` |
| Shopify GraphQL Admin | `@shopify/shopify-api` **ou** simple `fetch` sur l'endpoint GraphQL |
| Parsing CSV SEMrush | `csv-parse` |
| Traitement image (resize/WebP/compress) | `sharp` |
| Détection de langue (validation) | `franc` (ou `franc-min`) |
| Requêtes HTTP (Pexels, IndexNow, Telegram) | `fetch` natif (Node 18+) |
| Variables d'env locales | `dotenv` (dev local uniquement) |

- **Node 20+** requis (fetch natif, ESM stable).
- Aucune DB : l'état vit dans des fichiers JSON du repo.

---

## 2. Arborescence du repo

```
bot-seo/
├── .github/workflows/daily.yml
├── package.json
├── stores.json                     # config publique
├── boutiques/
│   ├── boutique-1/
│   │   ├── infos.md
│   │   ├── semrush/
│   │   │   ├── keywords.csv
│   │   │   └── clusters.csv
│   │   └── etat.json
│   └── ...
├── public/                         # fichier clé IndexNow servi ? (voir §9) 
└── src/
    ├── index.js                    # orchestrateur (boucle sur les boutiques)
    ├── config.js                   # charge stores.json + STORES_SECRETS + fusionne
    ├── store-context.js            # pompe le contexte Shopify + lit infos.md
    ├── keywords.js                 # parse CSV, priorise, choisit le prochain mot-clé
    ├── clusters.js                 # parse clusters, détermine pilier/satellite
    ├── generate.js                 # appel IA (Sonnet/Haiku) + structured output
    ├── validate.js                 # checks déterministes
    ├── images.js                   # Pexels/Unsplash + sharp (WebP/resize) + attribution
    ├── seo.js                      # schema JSON-LD, meta, slug, alt, densité
    ├── linking.js                  # maillage interne (produits API + articles etat.json)
    ├── shopify.js                  # publier / éditer article (GraphQL), tags, blog
    ├── indexnow.js                 # ping IndexNow
    ├── refresh.js                  # rafraîchissement hebdo
    ├── telegram.js                 # accumulation + envoi du digest
    ├── state.js                    # lecture/écriture etat.json + commit git
    └── cost.js                     # calcul du coût IA (tokens × tarif)
```

---

## 3. Schémas de données

### `stores.json` (config publique)
```json
[
  {
    "id": "boutique-1",
    "domaine": "cafe-x.com",
    "shopify_domain": "cafe-x.myshopify.com",
    "blog_handle": "blog",
    "langue": "fr",
    "niche": "café & accessoires"
  }
]
```

### GitHub Secret `STORES_SECRETS` (JSON chiffré)
```json
{
  "boutique-1": { "shopify_token": "shpat_xxx", "pexels_key": "yyy" }
}
```

### `boutiques/boutique-N/etat.json`
```json
{
  "boutique": "boutique-1",
  "derniere_generation_themes": "2026-05-15",
  "dernier_refresh": "2026-07-01",
  "themes": [
    {
      "mot_cle": "quelle veilleuse pour bébé",
      "volume": 90,
      "kd": 12,
      "cluster": "veilleuse",
      "role": "satellite",
      "intention": "guide_achat",
      "statut": "utilise",
      "archetype": "guide_achat",
      "article_id": "gid://shopify/Article/12345",
      "handle": "quelle-veilleuse-pour-bebe",
      "date_publication": "2026-06-01",
      "date_maj": "2026-06-01"
    },
    {
      "mot_cle": "veilleuse projecteur plafond",
      "volume": 8100,
      "kd": 32,
      "cluster": "veilleuse",
      "role": "satellite",
      "statut": "libre"
    }
  ]
}
```

### `boutiques/boutique-N/infos.md`
```md
# Contexte boutique (partie manuelle — le reste vient de Shopify)
- **Ton** : rassurant, expert, chaleureux (parents anxieux)
- **Persona** : jeunes parents 25-40 ans, premier enfant
- **Auteur** : Marie Dupont, rédactrice puériculture
```

### CSV SEMrush (colonnes attendues, s'adapter au format d'export réel)
- `keywords.csv` : `Keyword`, `Volume`, `Keyword Difficulty` (KD %), `Intent` (si dispo)
- `clusters.csv` : `Cluster`, `Keyword` (mapping mot-clé → cluster)

---

## 4. Flux d'exécution (`src/index.js`)

```
Pour chaque boutique dans stores.json (séquentiel) :
  try:
    1. ctx = chargerContexte(boutique)        # Shopify live + infos.md + etat.json
    2. theme = choisirProchainMotCle(boutique) # KD<30 → volume desc, questions prio,
                                                # pilier avant satellites d'un cluster neuf
       → si aucun libre : régénération / alerte, continue
    3. role, archetype = deciderRoleEtArchetype(theme)  # pilier→Sonnet, satellite→Haiku
                                                        # archétype selon l'intention
    4. article = genererArticle(ctx, theme, archetype, role)   # IA + structured output
    5. ok = valider(article)                  # checks déterministes
       → si KO : retente 1× la génération ; si toujours KO :
                 theme reste libre, log "qualité", continue
    6. image = recupererImage(theme, ctx)     # Pexels → sharp WebP/resize
       → si introuvable : publierEnBrouillon(article) + flag ACTION REQUISE, marquer utilise
    7. article = injecterSEO(article, image)  # schema JSON-LD, meta, alt
       article = ajouterLiensInternes(article, ctx)  # produits API + articles etat.json
    8. resultat = publierShopify(boutique, article, image, tags=[cluster])
       → si KO : theme reste libre, log, continue
    9. maillageBidirectionnel(boutique, article)  # éditer 1-2 anciens articles du cluster
    10. indexNow(article.url)
    11. marquerUtilise(boutique, theme, resultat.article_id) ; commitEtat(boutique)
    12. journal.ajouter(boutique, "publié", ...)
  catch e:
    journal.ajouter(boutique, "échec", e)     # NON-fatal, on continue
    # theme jamais marqué utilise → re-tenté demain

# Après la boucle :
- (hebdo) refresh du plus vieil article de chaque boutique
- envoyerDigestTelegram(journal)   # si échec d'envoi → exit code ≠ 0 (rouge)
```

**Retries** : wrapper `withRetry(fn, {tries:3, backoff:[1000,4000,10000]})` sur les appels réseau/API. Retry sur 429/5xx/erreurs réseau ; **pas** de retry sur 401/400.

---

## 5. Génération IA (`src/generate.js`)

- **Modèles** : pilier → `claude-sonnet-5` ; satellite → `claude-haiku-4-5`.
- **Structured Output** (fortement recommandé) pour garantir un JSON valide et tuer le mode d'échec « JSON cassé » : utiliser `output_config.format` avec un JSON Schema (ou `messages.parse()` + Zod via `zodOutputFormat`). Supporté sur Sonnet 5 **et** Haiku 4.5.
- **Prompt caching** : mettre la partie **stable** en tête (règles SEO, archétypes, `infos.md`/contexte boutique) avec `cache_control: { type: "ephemeral" }` → gain intra-run.
- **`max_tokens`** : ~3000 (satellite ~1500 mots) / ~4000 (pilier ~2000 mots). Pas de streaming (< 16K).
- **Sonnet 5** : `thinking` désactivé ou `output_config.effort: "medium"` suffit pour de la rédaction (éviter de surpayer). **Haiku 4.5** : appel standard (pas de param `effort`/`thinking` adaptatif).
- **Suivi coût** : lire `response.usage` (input/output/cache tokens), multiplier par le tarif du modèle, accumuler (`src/cost.js`).

### Schéma de sortie attendu (JSON de l'article)
```json
{
  "titre": "…",                    // 50-60 car., contient le mot-clé
  "slug": "…",                     // basé sur le mot-clé
  "meta_description": "…",         // 110-160 car.
  "corps_html": "…",               // HTML : H2/H3, listes, etc. selon l'archétype
  "faq": [ { "question": "…", "reponse": "…" } ],   // 3-5, depuis questions du cluster
  "images": [ { "position": "apres_intro", "requete": "coffee beans macro" } ],  // 0-2
  "tags": ["veilleuse", "sommeil bébé"],            // dont le cluster (catégorie)
  "liens_internes_suggeres": [ { "ancre": "…", "cible_type": "produit|article", "hint": "…" } ]
}
```

Le **prompt** injecte : contexte boutique (Shopify + infos.md), mot-clé cible + volume/KD, cluster + questions du cluster, archétype imposé, rôle (pilier/satellite), cahier des charges SEO (§10 du RECAP), langue.

---

## 6. Validation (`src/validate.js`)

Fonction `valider(article, {langue})` → `{ ok, raisons[] }` :
- `JSON.parse` réussi (déjà garanti si structured output).
- `stop_reason === "end_turn"` **et** `corps_html` se termine par `. ! ? "` (pas tronqué).
- Nombre de mots du corps ∈ [600, 2500].
- `titre`, `corps_html`, `meta_description`, `slug` non vides.
- `meta_description.length` ∈ [110, 160].
- `franc(corpsTexte)` === langue attendue.
- Aucune phrase interdite (regex insensible casse) : `as an ai`, `\[insér`, `language model`, `lorem ipsum`.

Si KO → 1 seule re-génération, puis abandon (thème reste `libre`).

---

## 7. Images (`src/images.js`)

- Pour chaque entrée de `article.images` : requête Pexels (`GET https://api.pexels.com/v1/search?query=…&per_page=1`, header `Authorization: <pexels_key>`), fallback Unsplash si besoin.
- Télécharger, puis `sharp` : `.resize({ width: 1200 }).webp({ quality: 80 })`.
- Nom de fichier descriptif basé sur le mot-clé ; `alt` basé sur le mot-clé.
- **Attribution** : récupérer `photographer` + `url` de la réponse Pexels → insérer en légende / bas d'article.
- **Si aucune image trouvée** pour un article qui en demande → publier l'article en **brouillon** (`published: false` / status DRAFT) et flaguer `ACTION REQUISE` dans le journal Telegram.

---

## 8. Publication Shopify (`src/shopify.js`)

- **GraphQL Admin API**, version pinée (ex. `2025-07` — vérifier la version courante au dev).
- Endpoint : `https://{shopify_domain}/admin/api/{version}/graphql.json`, header `X-Shopify-Access-Token: <token>`.
- **Créer l'article** : mutation de création d'article de blog (référencer le blog par son `blog_id`/handle `blog`), fournir : `title`, `body` (HTML **avec le bloc `<script type="application/ld+json">` du schema injecté**), `handle` (slug), `author`, `tags` (dont le cluster = catégorie), `summary`/`excerpt`, image (featured), et le statut (published vs draft).
- **Champs SEO** : renseigner le meta title / meta description via les champs SEO natifs de l'article.
- **Scopes du custom app Shopify requis** : `write_content` (articles/blogs), `read_products` (maillage interne), `read_content`.
- **Éditer un article** (maillage bidirectionnel + refresh) : mutation d'update sur l'`article_id` stocké dans `etat.json`.

---

## 9. IndexNow (`src/indexnow.js`)

- Générer une **clé** (UUID), servir le fichier `{clé}.txt` à la racine de chaque domaine (contenu = la clé). Sur Shopify, héberger via une page/fichier accessible, ou utiliser le paramètre `keyLocation`.
- À chaque publication : `POST https://api.indexnow.org/indexnow` avec `{ host, key, keyLocation, urlList: [url] }`.
- Concerne **Bing/Yandex** (pas Google). Gratuit.

---

## 10. Maillage interne (`src/linking.js`)

- **Cibles articles** : lire `etat.json`, filtrer les articles publiés du **même cluster** → proposer 1-3 liens contextuels dans le nouvel article.
- **Cibles produits** : lister les produits/collections via l'API Shopify → lier quand pertinent (l'IA a suggéré des ancres dans `liens_internes_suggeres`).
- **Bidirectionnel** : après publication, choisir 1-2 anciens articles du cluster (via `etat.json`) et **les éditer** (mutation Shopify) pour ajouter un lien vers le nouvel article. Mémoriser pour ne pas re-modifier en boucle.

---

## 11. Pilier-cluster (`src/clusters.js`)

- Parser `clusters.csv` → map `mot_cle → cluster`.
- Pour chaque cluster : désigner comme **pilier** le mot-clé le plus large/gros volume ; les autres = **satellites**.
- **Ordre de publication** : quand on démarre un cluster neuf, **publier le pilier en premier** (article ~2000 mots, Sonnet 5), puis les satellites (Haiku 4.5). Les satellites lient vers le pilier ; le pilier est édité pour lier vers chaque satellite publié (maillage bidirectionnel).

---

## 12. Priorisation des mots-clés (`src/keywords.js`)

```
candidats = themes.filter(statut === "libre")
prioriser :
  1. questions d'abord (si le mot-clé est une question)
  2. filtrer KD < 30
  3. trier par volume décroissant
  4. respecter l'ordre pilier-avant-satellites pour un cluster non entamé
choisir le premier.
si aucun candidat KD<30 : élargir progressivement le seuil, sinon alerte "backlog épuisé".
```

---

## 13. Telegram (`src/telegram.js`)

- Accumuler un objet `journal` pendant le run (par boutique : statut, titre, mots, image, erreurs, coût).
- **En fin de run**, envoyer **UN** message via l'API Bot : `POST https://api.telegram.org/bot{TOKEN}/sendMessage` (`chat_id`, `text` en Markdown, `disable_web_page_preview`).
- Format : voir §7 du RECAP (en-tête chiffré + ligne/boutique + section ACTION REQUISE avec liens admin + coût jour/mois).
- **Si l'envoi Telegram échoue → `process.exit(1)`** (workflow rouge) pour ne pas devenir aveugle.
- `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` dans les GitHub Secrets.

---

## 14. Refresh hebdo (`src/refresh.js`)

- 1×/semaine par boutique (checker `dernier_refresh` dans `etat.json`).
- Prendre le plus vieil article (`date_maj` la plus ancienne), demander à l'IA une mise à jour légère (enrichir une section, actualiser), éditer l'article Shopify, mettre à jour `date_maj`, renvoyer à IndexNow.

---

## 15. Gestion d'état & commit (`src/state.js`)

- Lire/écrire `boutiques/boutique-N/etat.json`.
- **Commit après chaque boutique** : `git add boutiques/boutique-N/etat.json && git commit -m "..." && git push` (config git dans le workflow avec le `GITHUB_TOKEN`). Retry du push en cas de conflit.

---

## 16. Workflow GitHub Actions (`.github/workflows/daily.yml`)

```yaml
name: Daily SEO Blogs
on:
  schedule:
    - cron: "0 6 * * *"   # ~08h Paris (UTC+2 été) — ajuster
  workflow_dispatch: {}    # déclenchement manuel possible
permissions:
  contents: write          # pour committer les etat.json
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node src/index.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          STORES_SECRETS:    ${{ secrets.STORES_SECRETS }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
```

- Le script configure git (`user.name`/`user.email`) et pousse les commits d'état.
- Le job reste **vert** sauf crash réel ou échec d'envoi Telegram (`process.exit(1)`).

---

## 17. Secrets GitHub à créer

- `ANTHROPIC_API_KEY`
- `STORES_SECRETS` (JSON : tokens Shopify + clés Pexels par boutique)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

---

## 18. Onboarding d'une nouvelle boutique (checklist dev)

1. Créer un blog « Blog » dans Shopify → noter le `blog_id`/handle.
2. Créer un **custom app** Shopify avec scopes `write_content`, `read_content`, `read_products` → récupérer l'Admin API access token.
3. Exporter 2 CSV SEMrush (`keywords.csv` filtré KD<30, `clusters.csv`) → `boutiques/boutique-N/semrush/`.
4. Écrire 3 lignes dans `boutiques/boutique-N/infos.md` (ton, persona, auteur).
5. Ajouter l'entrée dans `stores.json` + les secrets dans `STORES_SECRETS`.
6. Initialiser `boutiques/boutique-N/etat.json` (le bot le remplit au 1er run à partir des CSV).
7. (GSC déjà fait.)

---

## 19. Points de vigilance au dev

- **Vérifier le format exact des CSV SEMrush** (noms de colonnes, séparateur, encodage) au moment du parsing.
- **Vérifier la version courante de l'API GraphQL Shopify** et la disponibilité de la mutation de création d'article (sinon fallback REST le temps de).
- **Injection du JSON-LD dans `body_html`** : s'assurer que Shopify ne strippe pas le `<script type="application/ld+json">` (tester sur une boutique).
- **Attribution images** : ne pas oublier (Unsplash l'exige).
- **Idempotence** : ne marquer `utilise` qu'après succès complet ; commit juste après.
- **Détection langue** sur le texte brut (strip HTML) pour éviter les faux positifs.
