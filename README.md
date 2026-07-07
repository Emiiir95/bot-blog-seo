# 🤖 Bot SEO multi-boutiques Shopify

Bot Node.js qui, chaque jour, écrit et publie un article de blog optimisé SEO par boutique Shopify, à partir de mots-clés SEMrush réels.

- **Toutes les décisions & le pourquoi** → [`CLAUDE.md`](./CLAUDE.md)
- **La spec technique détaillée** → [`SPEC-technique-bot-seo.md`](./SPEC-technique-bot-seo.md)
- **Ce qu'il reste à faire (avec toi)** → [`CHECKLIST.md`](./CHECKLIST.md)

## Démarrage rapide

```bash
npm install
cp .env.example .env      # remplir les clés (dev local)
node src/index.js         # lance un run
```

En production, tout est piloté par le cron GitHub Actions (`.github/workflows/daily.yml`).

## Structure

```
├── stores.json              # config publique des boutiques
├── boutiques/<id>/
│   ├── infos.md             # 3 lignes de contexte (ton, persona, auteur)
│   ├── semrush/*.csv        # exports SEMrush (mots-clés + clusters)
│   └── etat.json            # état : thèmes utilisés/libres
└── src/                     # le bot
```
