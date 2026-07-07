# 🤖 Bot SEO multi-boutiques Shopify — Récap complet des décisions

> **À LIRE EN PREMIER par toute session de développement (Claude ou humain).**
> Ce fichier est la source de vérité : il capture **toutes** les décisions prises pendant la conception, avec le *pourquoi* de chacune. Ne réintroduis jamais une idée listée dans la section « Décisions REJETÉES ».
> Stack retenue : **Node.js**.

---

## 1. Contexte & objectif

- Bot d'automatisation de **blogs SEO** pour **~10 boutiques Shopify**.
- **1 article publié par boutique et par jour** (soit 10 articles/jour au total).
- Déclenché par un **cron GitHub Actions**, publie directement sur Shopify.
- **Objectif n°1 : faire RANKER les boutiques au maximum.** Le coût est secondaire (déjà minuscule à cette échelle). La qualité et le SEO priment.
- Tout doit être **le plus dynamique / automatisé possible** : onboarding d'une nouvelle boutique quasi zéro-config.

---

## 2. Architecture & stockage de l'état

**Décision : 1 fichier JSON d'état par boutique, dans le repo Git.**

- `boutiques/boutique-N/etat.json` contient : la liste des mots-clés/thèmes, leur statut (`libre` / `utilise`), l'`article_id` Shopify, les dates, l'appartenance au cluster.
- **Pourquoi le repo Git et pas une base de données** : gratuit, versionné (diff visible, rollback en 1 clic), débuggable à l'œil nu, aucun service externe à gérer. À 10 boutiques / 1 run/jour séquentiel, aucun risque de conflit.
- **Pourquoi 1 fichier par boutique et pas un fichier global** : diffs lisibles (seul le fichier de la boutique modifiée change), isolation (un JSON corrompu n'impacte qu'une boutique), pas de conflit d'écrasement.
- Bascule vers une vraie DB (Supabase/Turso) **uniquement** si un jour on passe à plusieurs articles/jour **en parallèle** sur beaucoup de boutiques (risque de commits concurrents). Pas le cas actuellement.

---

## 3. Config & secrets

**Décision : config publique dans le repo + secrets dans UN seul GitHub Secret.**

- **Config non-sensible** → `stores.json` dans le repo : `id`, `domaine`, `blog_id`, `langue`, `niche`, etc. Versionné, éditable facilement.
- **Secrets** → **un seul** GitHub Secret `STORES_SECRETS` contenant un JSON `{ "boutique-1": { "shopify_token": "...", "pexels_key": "..." }, ... }`. Le script le parse et matche par `id` avec `stores.json`.
- **Pourquoi** : la partie qu'on veut voir/éditer est dans le repo ; la partie sensible est chiffrée dans **un seul** secret facile à maintenir. Les tokens Shopify et clés d'API banques d'images ne sont **jamais** dans le repo ni dans les JSON d'état.

---

## 4. Cron & orchestration

**Décision : 1 seul workflow GitHub Actions, 1×/jour, boucle SÉQUENTIELLE sur les boutiques.**

- Le cron démarre → boucle boutique 1 → 2 → … → 10, chacune publie 1 article, **commit après chaque boutique**.
- Durée totale estimée : ~3-5 min (20-40s/boutique).
- **Pourquoi séquentiel et pas parallèle (matrix)** : le parallélisme provoquerait 10 `git push` concurrents = conflits de commit permanents. Le séquentiel garantit zéro conflit d'état — c'est justement pour ça qu'on a choisi le JSON committé.
- **Commit après chaque boutique** (et non un seul commit final) → résilience : si le run plante à la boutique 6, les boutiques 1-5 sont déjà sauvées et publiées.
- Le cron GitHub n'est **pas** à la seconde près (retards possibles de quelques minutes) → sans importance pour des blogs.

---

## 5. Modèle « transaction » auto-réparant (LE cœur du bot)

**Décision : un thème n'est marqué `utilise` qu'APRÈS publication réussie.**

Flux par article, avec le comportement en cas d'échec (après 2-3 retries) :

| Étape | Si réussit | Si échoue |
|---|---|---|
| 1. Choisir un thème `libre` | continue (pas encore marqué utilisé) | plus aucun libre → régénération / alerte |
| 2. Générer l'article (IA) | continue | thème reste **`libre`**, log, boutique suivante. Re-tenté demain. |
| 3. Valider (déterministe) | continue | retente 1× la génération ; si toujours KO → thème reste `libre`, log « qualité insuffisante ». |
| 4. Récupérer l'image | insère | article **BON mais sans image → BROUILLON + alerte Telegram** (voir §7). |
| 5. Publier sur Shopify | continue | thème reste **`libre`**, log, boutique suivante. Re-tenté demain. |
| 6. Marquer `utilise` + commit | ✅ terminé | retry du push git |

- **Règle d'or** : tant qu'un thème n'est pas publié pour de vrai, il reste `libre`. Aucun échec ne « brûle » un sujet ni ne crée de doublon. **Auto-réparation** : tout raté est re-tenté le lendemain.
- **Retries** : 2-3 tentatives avec **backoff exponentiel** (1s, 4s, 10s) sur erreurs réseau/API (429, 5xx). **Pas de retry** sur les erreurs logiques (401 mauvais token → inutile).
- **« Toujours vert »** : le script catch tout, log tout, sort en code 0 — **SAUF** 2 cas qui doivent rester ROUGE (sinon on devient aveugle) :
  1. Le run lui-même crash (bug code / panne infra).
  2. Le message Telegram n'a pas pu partir.
- Principe : « vert tout le temps » = les erreurs sont **non-fatales et s'auto-réparent**, et **la vérité c'est le journal Telegram, pas la pastille verte**.

---

## 6. Validation qualité (checks déterministes seulement)

**Décision : checks automatiques déterministes uniquement (PAS d'IA-juge).**

La validation tourne **AVANT** l'appel de publication Shopify. Rien ne passe en « publié » sans cocher toutes les cases.

| Check | Règle |
|---|---|
| JSON valide | le parse réussit |
| Pas tronqué | `stop_reason == "end_turn"` **et** dernier caractère = `. ! ? "` |
| Longueur corps | entre **600 et 3000 mots** (uniforme pour piliers ET satellites, varie naturellement, tolérance ~3200) |
| Champs présents | `titre`, `corps`, `meta_description`, `slug` non vides |
| Meta description | **110–160 caractères** |
| Langue | détection = langue attendue (lib légère) |
| Pas de phrases interdites | absence de « as an AI », « [insér », « language model », « lorem ipsum » |

- **Pourquoi déterministe seul** : gratuit, instantané, attrape ~95 % des déchets. L'IA-juge (2ᵉ appel notant l'article) sera ajoutée **seulement si** de la bouillie passe à travers.
- **Garde-fou date** : l'année n'est PAS mise sur chaque article — **seulement quand le sujet l'exige** (tendances, nouveautés, "meilleures X de l'année"). Un guide intemporel n'a pas d'année. Le bot injecte l'année réelle (`new Date().getFullYear()`) dans les prompts ; quand l'IA met une année, ce doit être **exclusivement l'année courante**. La validation **rejette toute année ≠ année courante dans le titre/meta**, et **toute année dans le slug** (URL permanente) → régénération. Raison : l'IA ne connaît pas la date du jour et mettait des années périmées ("2024" en 2026) ; solution = lui donner la vraie date + vérifier. (À terme : le refresh hebdo pourra mettre à jour l'année des titres au passage d'année.)
- Si un check échoue → « mauvaise qualité » → retente 1× la génération, sinon thème reste `libre`.

**Distinction cruciale des ratés :**
- **Article BON mais image manquante** → **BROUILLON + alerte Telegram** (l'article est bon, il vaut ta touche manuelle). Le thème est quand même marqué `utilise` (l'article existe en brouillon, attend l'image).
- **Article MAUVAIS/cassé** → **PAS mis en brouillon** (bouillie inutile). Thème reste `libre`, re-tenté demain. **Si le même thème rate la qualité 3 jours de suite → alerte Telegram plus insistante.**

---

## 7. Rapport Telegram (observabilité)

**Décision : Option A — UN digest unique, envoyé APRÈS que les 10 boutiques aient publié.**

- **Pourquoi Option A** : le run dure 5 min, tout tient dans un message, zéro spam. (Un message par boutique = spam ignoré. Option C « digest + pings instantanés » = overkill au début.)
- **Contenu du message :**
  - En-tête = **résumé chiffré** (✅ X publiés · 📝 Y brouillons · ❌ Z échecs · ♻️ régénérations).
  - **Une ligne par boutique** : statut emoji + domaine réel + titre de l'article + nb de mots + statut image.
  - Événement **♻️ « backlog épuisé → nouveaux thèmes »** quand il se produit.
  - Section **« ⚠️ ACTION REQUISE »** en bas, regroupant les brouillons à valider, avec **lien direct vers l'admin Shopify** (tu cliques, tu ajoutes l'image, tu publies).
  - Ce qui a « failli mal tourner » (retry qui a fini par passer) apparaît en `⚠️` sans être bloquant.
  - **💰 Coût IA du jour + coût projeté/mois.**
- **On N'affiche PAS le nombre de thèmes restants** : inutile puisque la régénération est automatique quand le backlog atteint 0. (Idée d'alerte « plus que X thèmes » explicitement abandonnée.)

---

## 8. Génération de contenu — mots-clés, clusters, priorisation

**Décision : le backlog de thèmes = les mots-clés SEMrush réels (pas du brainstorm IA).**

- L'utilisateur a **SEMrush mais PAS l'API** → il **exporte des CSV manuellement**.
- Fichiers : `boutiques/boutique-N/semrush/keywords.csv` (**obligatoire**) + `boutiques/boutique-N/semrush/clusters.csv` (**OPTIONNEL**).
- **`clusters.csv` optionnel** : s'il est absent (l'utilisateur ne peut souvent exporter que les mots-clés), le bot **regroupe automatiquement les mots-clés en clusters via l'IA** (un appel Haiku, une seule fois au premier seed, quand il y a de nouveaux mots-clés). Implémenté dans `src/clusters.js` → `clusterWithAI()`. Le clustering SEMrush reste préférable (basé sur le SERP) mais l'IA fait un bon fallback sémantique.
- **Exporter seulement le top filtré** (KD < 30 + volume correct), **pas les 55 000 mots-clés** → repo léger + meilleur ciblage. Une seule export = des **années** de contenu (55K variations + 1,5K questions).
- **Priorisation « facile d'abord »** : filtrer **KD < 30** (mots-clés faciles/verts), puis trier par **volume décroissant**. **Prioriser les « Questions »** (intention claire + potentiel de featured snippet).
- **Pourquoi vrais mots-clés et pas brainstorm IA** : du contenu IA que personne ne cherche ne rank pas. Les vrais mots-clés SEMrush = alignés sur la demande réelle = vrai potentiel de ranking.
- **Régénération quasi-théorique** : avec des dizaines de milliers de mots-clés, on ne tombe jamais à court. Si un jour épuisé → alerte Telegram « exporte un nouveau CSV » (on garde du vrai SEO, pas de l'invention IA).

---

## 9. Contexte boutique — `infos.md` minimal + auto Shopify

**Décision : `infos.md` réduit au strict minimum, le reste pompé dynamiquement depuis l'API Shopify.**

- Le bot récupère **en live via l'API Shopify** : nom de la boutique, description, produits, collections.
- L'utilisateur écrit **seulement 3 lignes** dans `boutiques/boutique-N/infos.md` (ce que Shopify ne connaît pas) :
  - **Ton de marque** (fun / expert / rassurant…)
  - **Persona cible** (jeunes parents / déco haut de gamme…)
  - **Auteur** (nom + mini-bio, pour l'E-E-A-T)
- Résultat : ajouter une nouvelle boutique = quasi zéro config.
- **Bonus coût** : `infos.md` + règles SEO = partie **stable** du prompt → mise en tête → **prompt caching** activé (voir §14).

---

## 10. SEO on-page (le cahier des charges de chaque article)

**Décision : traitement SEO complet (validé « fais le max pour ranker »).**

| Élément | Règle |
|---|---|
| Titre H1 / SEO title | mot-clé cible, 50-60 caractères |
| URL (slug) | court, basé sur le mot-clé |
| Meta description | 110-160 car., mot-clé + accroche |
| Intro (100 premiers mots) | répond **directement** à la question (featured snippet) |
| Structure H2/H3 | reprend les **questions du cluster** SEMrush |
| Section FAQ en bas | 3-5 questions issues de `questions.csv` → **rich snippet FAQPage** |
| Schema JSON-LD | `Article` + `FAQPage` injectés dans le corps |
| Liens internes | vers pages produits (API) + autres articles du cluster (etat.json) |
| Alt text image | basé sur le mot-clé |
| Longueur | ~1200-1500 mots (piliers ~2000) |
| Densité mot-clé | naturelle, **jamais de bourrage** |

- **Maillage interne** — sources des URLs cibles : articles déjà publiés (via `etat.json`, automatique) + pages produits/collections (via API Shopify, automatique). Le bot lie intelligemment selon le cluster.

---

## 11. Variété des structures — archétypes

**Décision : archétype de format choisi ALÉATOIREMENT PAR ARTICLE, matché à l'intention du mot-clé.**

- Pool d'archétypes : Listicle, Guide étape par étape (how-to), Comparatif « X vs Y », Guide d'achat, Question-réponse approfondie (FAQ-led), « Erreurs à éviter », Article narratif.
- Le bot choisit l'archétype **selon l'intention du mot-clé** :
  - « quelle veilleuse pour bébé » → guide d'achat / comparatif
  - « comment endormir bébé » → how-to
  - « pourquoi bébé pleure la nuit » → explicatif
- **Pourquoi par-article et pas per-day-global** : un template global partagé par les 10 boutiques le même jour crée une **empreinte croisée détectable** sur le réseau de sites (pattern « site network » pénalisé par Google) — **pire** que le problème qu'on veut éviter. Le choix par-article = aucun pattern ni temporel ni entre boutiques.
- Le pilier utilise l'archétype « guide complet ».

---

## 12. Les 6 leviers de ranking (tous adoptés)

1. **Indexation rapide** — voir détail §13.
2. **Maillage interne bidirectionnel** — à chaque publication, le bot **édite 1-2 anciens articles du même cluster** pour ajouter un lien vers le nouvel article. Distribue le jus SEO **et** accélère la découverte Google.
3. **Architecture pilier-cluster** — export **clusters SEMrush** ; le bot publie d'abord le **pilier** (article complet ~2000 mots) puis les satellites ; **interconnexion auto** pilier ↔ satellites. Autorité thématique = levier SEO moderne le plus fort.
4. **Rafraîchissement du contenu** — 1×/semaine par boutique, le bot reprend le plus vieil article, met à jour la date + enrichit une section + renvoie à IndexNow. Signal de fraîcheur.
5. **E-E-A-T** — auteur cohérent par boutique (nom + bio via `infos.md`), dates publié/modifié, `Article` schema avec auteur. Crucial pour niches « produits bébé » (YMYL / sécurité).
6. **Optimisation images (vitesse)** — redimension ~1200px + compression + **WebP** + nom de fichier descriptif + alt text mot-clé, avant upload Shopify.

---

## 13. Indexation rapide (précisions importantes)

- **Google Search Console + sitemap : DÉJÀ configuré** sur toutes les boutiques par l'utilisateur. ✅
- **⚠️ Le « ping sitemap » Google est MORT** (déprécié par Google en 2023). Ne pas l'utiliser.
- **Il n'existe PAS de bouton officiel** pour forcer Google à indexer un blog instantanément. La « Google Indexing API » est officiellement réservée aux offres d'emploi/événements → **à éviter** (gris/contre les règles) sur de vraies boutiques.
- **IndexNow (Bing/Yandex)** : ADOPTÉ. Protocole gratuit → poser un fichier « clé » sur le site + POST de l'URL à chaque publication → crawl en heures. ~10 lignes de code.
- **Pour Google** : on s'appuie sur (a) le sitemap déjà en place + (b) le **maillage bidirectionnel (levier #2)** qui accélère naturellement la découverte via les liens depuis des pages déjà indexées.

---

## 14. Modèle IA & coût

**Décision (révisée) : TOUT Haiku 4.5 par défaut, configurable via `.env`.**

- Défaut : **`claude-haiku-4-5`** pour piliers ET satellites. Configurable : `MODEL_PILIER` / `MODEL_SATELLITE` dans `.env` (ex. `MODEL_PILIER=claude-sonnet-5` pour remettre Sonnet sur les piliers).
- **Pourquoi tout-Haiku** : à l'usage, Haiku 4.5 écrit des articles longs et de bonne qualité (testé : pilier de 3142 mots vs 2251 pour Sonnet), pour ~2× moins cher. La priorité de l'utilisateur est le **coût** ; Sonnet reste dispo en 1 variable si besoin de qualité max sur les piliers.
- **Coût réel mesuré** : pilier Haiku ~**0,04 €** (2 appels : corps + méta), satellite ~0,015-0,02 €. Steady state ≈ **0,02 €/article** → ~**6 €/mois** (72 €/an) pour 10 boutiques.
- Génération en **2 appels** (corps texte libre + méta JSON) — le JSON structuré bridait la longueur. Validation longueur : **600 à 3000 mots pour TOUS** (piliers et satellites, tolérance ~3200). Le pilier vise plutôt le haut de la fourchette (article complet), le satellite le milieu — mais tout reste dans 600-3000.

**Hacks coût :**
- **Prompt caching** : ACTIVÉ (gratuit), mais **bénéfice marginal à cette échelle** — le cache expire après 5 min-1h, donc n'aide que **dans un même run** (partie commune du prompt partagée entre les 10 boutiques). Ordonner le prompt : partie stable (règles SEO, `infos.md`) en tête. Ne pas surestimer le gain.
- **Batch API : REJETÉE.** -50 % sur les tokens mais complexité + timing incertain (jusqu'à 24h) pour ~50 €/an d'économie → pas rentable. On garde des **appels synchrones simples**.
- **Right-sizing** : `max_tokens` ~2500-3000 (article 1500 mots), effort raisonnable sur Sonnet. Pas de streaming nécessaire (< 16K tokens).
- **Vérité** : le coût est déjà quasi-optimal. Les vrais hacks sont déjà faits (mix, images gratuites, pas d'API SEMrush, pas de Batch, régénération quasi-jamais).

---

## 15. Images — banques d'images gratuites uniquement

**Décision : UNIQUEMENT des API de banques d'images gratuites (Pexels / Unsplash). 0 à 2 images par article, « au feeling ».**

- **JAMAIS d'images Google** (droit d'auteur → contrefaçon, risque DMCA / fermeture boutique, mauvais SEO). Décision ferme.
- **Attribution** : Unsplash **exige** un crédit (auteur + lien) ; Pexels le recommande. L'API renvoie l'auteur → à automatiser (légende / bas d'article).
- **Rate limits** : Unsplash prod 5000 req/h, Pexels 200 req/h / 20 000/mois → très largement suffisant (~20 req/jour max).
- **L'IA décide 0 à 2 images** : la génération renvoie un tableau `images[]` structuré `{ position, requete }` ; le script cherche sur Pexels/Unsplash et insère. Tableau vide = 0 image.
- **Image introuvable** → article en **BROUILLON + alerte Telegram** (voir §5/§7).
- **PAS de ligne « Crédits photos »** dans l'article : Pexels et Unsplash ne l'exigent PAS (licence libre, attribution appréciée mais optionnelle). Décision de l'utilisateur : rien de superflu dans le contenu publié.
- Coût images = **0 €**. (Génération d'images IA explicitement écartée : coûterait plus cher que le texte pour peu de valeur ajoutée ici.)

---

## 16. Publication Shopify

**Décision : API GraphQL Admin de Shopify.**

- **Pourquoi GraphQL** : REST est en cours de dépréciation par Shopify → on part sur le futur-proof.
- **Schema JSON-LD** (`Article` + `FAQPage`) → **injecté directement dans le corps** de l'article (`body_html`). Avantage : 100 % automatisable, **zéro modif du thème** boutique par boutique.
- **Champs SEO** (meta title + meta description) → via les champs SEO natifs de l'article Shopify.
- **Tags** auto-générés depuis le cluster → servent de **catégories**.

**Blog & catégories :**
- **1 seul blog par boutique**, nommé **« Blog »** (créé manuellement par l'utilisateur, 2 min).
- **Catégories = tags dynamiques** basés sur le cluster du mot-clé. Article « veilleuse » → catégorie *Sommeil bébé*, etc. **Déduit du contenu, zéro travail manuel.**
- **Pourquoi tags et pas plusieurs blogs** : plusieurs blogs **fragmentent** le site → maillage interne et autorité thématique dilués. Un seul blog = articles « frères » qui se lient bien. **Bonus** : chaque page de catégorie (tag) devient une page de ranking + un mini-hub qui renforce le pilier-cluster. URL auto : `/blogs/blog/tagged/{tag}`.

---

## 17. Principe transversal : TOUT est dynamique

Éléments dynamiques (déjà par design) :
- Mots-clés/thèmes → CSV, triés par opportunité
- Clusters & piliers → export SEMrush
- Catégories → tags par cluster
- Structure d'article → archétype selon l'intention
- Liens internes → produits (API) + articles (etat.json)
- Images → recherche selon le mot-clé
- Modèle IA → Sonnet (pilier) / Haiku (satellite)
- Meta, slug, alt, schema → par article
- Contexte boutique → auto depuis Shopify (+ 3 lignes `infos.md`)
- Rapport Telegram → selon ce qui s'est réellement passé

---

## 18. Le strict minimum MANUEL par boutique (onboarding)

1. Créer un blog « Blog » dans Shopify (2 min).
2. Exporter 2 CSV SEMrush : `keywords.csv` (filtré KD<30) + `clusters.csv`.
3. Écrire **3 lignes** dans `infos.md` (ton, persona, auteur).
4. Ajouter le token Shopify + clé Pexels au secret `STORES_SECRETS`.
5. Ajouter l'entrée de config dans `stores.json`.
*(Google Search Console : déjà fait ✅)*

---

## 19. ❌ Décisions REJETÉES (ne PAS réintroduire)

| Idée rejetée | Pourquoi |
|---|---|
| **Images prises sur Google** | Droit d'auteur, risque DMCA, mauvais SEO |
| **Génération d'images IA** | Plus chère que le texte, peu de valeur ici |
| **Base de données pour l'état** | Overkill à 10 boutiques ; JSON committé suffit |
| **Cron parallèle (matrix)** | Conflits de `git push` concurrents |
| **Un template global partagé par jour** | Empreinte croisée détectable entre boutiques |
| **Brainstorm IA pur pour les thèmes** | Ne rank pas ; on utilise les vrais mots-clés SEMrush |
| **IA-juge de qualité (au début)** | Coût inutile ; checks déterministes suffisent |
| **Ping sitemap Google** | Déprécié par Google en 2023, ne marche plus |
| **Google Indexing API pour blogs** | Contre les règles Google (réservée emploi/événements) |
| **Plusieurs blogs Shopify par boutique** | Fragmente le site, dilue le SEO ; on utilise des tags |
| **Batch API Anthropic** | -50 % mais complexité + timing incertain pour ~50 €/an |
| **Afficher le nb de thèmes restants** | Inutile, régénération automatique |
| **Sonnet partout / Haiku partout** | Le mix est le bon équilibre qualité/coût |

---

## 20. Chiffres de référence

- **Volume** : 10 boutiques × 1 article/jour = ~300 articles/mois.
- **Coût IA** : ~100 €/an (mix Sonnet/Haiku).
- **Autres coûts** : GitHub Actions (gratuit < 2000 min/mois), IndexNow (gratuit), Pexels/Unsplash (gratuit) = **0 €**.
- **Hypothèses par article** : ~2000 tokens entrée + ~4000 tokens sortie ; corps 600-2500 mots (cible ~1200-1500, piliers ~2000).
