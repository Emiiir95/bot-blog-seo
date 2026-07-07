# Obtenir un Access Token Shopify (2026)

## Prérequis

- Une app créée dans le [Dev Dashboard Shopify](https://dev.shopify.com)
- Le **Client ID** et le **Secret** de l'app
- Les **scopes** configurés et une version publiée
- L'app installée sur la boutique cible

---

## Étape 1 — Créer et configurer l'app dans le Dev Dashboard

1. Aller sur `https://dev.shopify.com`
2. Créer une nouvelle app
3. Aller dans **Versions** → **Créer une version**
4. Dans le champ **Champs d'accès**, saisir les scopes nécessaires séparés par des virgules, ex :
   ```
   read_products,write_products,read_metaobjects,write_metaobjects
   ```
5. Cliquer sur **Publier** → confirmer dans la modale

---

## Étape 2 — Installer l'app sur la boutique

1. Depuis la page **Aperçu** de l'app, cliquer sur **Installer l'application**
2. Sélectionner la boutique cible
3. Confirmer l'installation

---

## Étape 3 — Générer le code OAuth

Coller cette URL dans le navigateur en remplaçant les valeurs :

```
https://TON-STORE.myshopify.com/admin/oauth/authorize?client_id=TON_CLIENT_ID&scope=TON,SCOPE,ICI&redirect_uri=https://example.com&state=random123
```

- Cliquer sur **Install** sur l'écran Shopify
- Shopify redirige vers `https://example.com/?code=XXXXXXXX&...`
- La page ne charge pas — c'est normal
- **Copier le paramètre `code=` dans l'URL**

> ⚠️ Le code expire en **60 secondes**, passer immédiatement à l'étape suivante.

---

## Étape 4 — Échanger le code contre l'access token

Dans le terminal, lancer cette commande en une seule ligne :

```bash
curl -X POST https://TON-STORE.myshopify.com/admin/oauth/access_token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'client_id=TON_CLIENT_ID&client_secret=TON_SECRET&code=LE_CODE_OBTENU'
```

La réponse contient l'access token :

```json
{
  "access_token": "shpat_xxxxxxxxxxxxxxxxxxxxxx",
  "scope": "write_products,..."
}
```

---

## Étape 5 — Sauvegarder dans le .env

```env
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_STORE=TON-STORE.myshopify.com
SHOPIFY_API_VERSION=2026-01
```

> ⚠️ Ne jamais commiter le `.env` — l'ajouter au `.gitignore`.

---

## Tester le token

```bash
curl -X POST https://TON-STORE.myshopify.com/admin/api/2026-01/graphql.json \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Access-Token: shpat_xxxxxxxxxxxxxxxxxxxxxx' \
  -d '{"query": "{ products(first: 3) { edges { node { id title } } } }"}'
```

---

## Notes importantes

| Point | Détail |
|---|---|
| Durée du token | Permanent tant que l'app est installée |
| Durée du code OAuth | 60 secondes max |
| Version API stable | `2026-01` (mise à jour trimestrielle) |
| Révocation | Désinstaller l'app depuis le Shopify Admin |
| Sécurité | Toujours via `.env`, jamais en dur dans le code |
