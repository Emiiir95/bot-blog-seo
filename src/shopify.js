// Client Shopify GraphQL Admin API : contexte boutique, produits, création/édition d'articles.
//
// ⚠️ À VÉRIFIER AU DEV : les noms de champs GraphQL (articleCreate/articleUpdate,
// ArticleCreateInput) évoluent selon la version d'API. Tester sur une boutique et
// ajuster si un champ est rejeté. Version pinée dans config.js (SHOPIFY_API_VERSION).
import { SHOPIFY_API_VERSION } from "./config.js";
import { withRetry } from "./utils.js";

function endpoint(store) {
  return `https://${store.shopify_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

export async function shopifyGraphQL(store, query, variables = {}) {
  return withRetry(
    async () => {
      const res = await fetch(endpoint(store), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": store.shopify_token,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const err = new Error(`Shopify HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const json = await res.json();
      if (json.errors) {
        // Erreur logique GraphQL (mauvaise requête) -> pas de retry.
        const e = new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
        e.status = 400;
        throw e;
      }
      return json.data;
    },
    { label: "shopify" }
  );
}

/** Récupère nom, description, produits et collections pour nourrir le contexte IA. */
export async function getShopContext(store) {
  const data = await shopifyGraphQL(
    store,
    `query {
      shop { name description }
      products(first: 25) {
        nodes { title handle }
      }
      collections(first: 15) {
        nodes { title handle }
      }
    }`
  );
  return {
    nom: data.shop?.name,
    description: data.shop?.description,
    produits: (data.products?.nodes || []).map((p) => ({
      titre: p.title,
      url: `https://${store.domaine}/products/${p.handle}`,
    })),
    collections: (data.collections?.nodes || []).map((c) => ({
      titre: c.title,
      url: `https://${store.domaine}/collections/${c.handle}`,
    })),
  };
}

/** Trouve l'id GraphQL du blog par son handle (ex. "blog"). */
export async function getBlogId(store) {
  const data = await shopifyGraphQL(
    store,
    `query($q: String!) { blogs(first: 5, query: $q) { nodes { id handle } } }`,
    { q: `handle:${store.blog_handle}` }
  );
  const blog = data.blogs?.nodes?.find((b) => b.handle === store.blog_handle) || data.blogs?.nodes?.[0];
  if (!blog) throw new Error(`Blog "${store.blog_handle}" introuvable sur ${store.shopify_domain}`);
  return blog.id;
}

/**
 * Cherche un article existant par son handle dans un blog (idempotence anti-doublon).
 * @returns { id, handle } ou null
 */
export async function findArticleByHandle(store, blogId, handle) {
  // On liste les articles du blog et on matche le handle côté code (les filtres serveur
  // par handle ne sont pas dispo sur Blog.articles). first: 250 suffit largement comme filet
  // anti-doublon ; au-delà, la garde `utilise` au niveau des thèmes empêche déjà les republications.
  const data = await shopifyGraphQL(
    store,
    `query($id: ID!) {
      blog(id: $id) { articles(first: 250) { nodes { id handle } } }
    }`,
    { id: blogId }
  );
  const nodes = data.blog?.articles?.nodes || [];
  return nodes.find((a) => a.handle === handle) || null;
}

/**
 * Crée un article de blog.
 * @returns { id, handle, url }
 */
export async function createArticle(store, blogId, article, { published }) {
  const input = {
    blogId,
    title: article.titre,
    handle: article.slug,
    body: article.body_html, // contient déjà le bloc JSON-LD injecté
    summary: article.meta_description,
    author: { name: article.auteur },
    tags: article.tags,
    isPublished: published,
    image: article.image
      ? { url: article.image.url, altText: article.image.alt }
      : undefined,
    // SEO natif via metafields online store.
    metafields: [
      { namespace: "global", key: "title_tag", type: "single_line_text_field", value: article.titre },
      { namespace: "global", key: "description_tag", type: "single_line_text_field", value: article.meta_description },
    ],
  };

  const data = await shopifyGraphQL(
    store,
    `mutation($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id handle }
        userErrors { field message }
      }
    }`,
    { article: input }
  );

  const errs = data.articleCreate?.userErrors || [];
  if (errs.length) throw new Error(`articleCreate: ${JSON.stringify(errs)}`);
  const created = data.articleCreate.article;
  return {
    id: created.id,
    handle: created.handle,
    url: `https://${store.domaine}/blogs/${store.blog_handle}/${created.handle}`,
  };
}

/**
 * Héberge des octets d'image sur Shopify (staged upload) et renvoie une URL exploitable
 * comme image d'article. Sert aux images générées par IA (qu'on ne peut pas passer par URL).
 */
export async function uploadImageBytes(store, buffer, filename, mimeType = "image/png") {
  const staged = await shopifyGraphQL(
    store,
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{ filename, mimeType, resource: "IMAGE", httpMethod: "POST" }] }
  );
  const errs = staged.stagedUploadsCreate?.userErrors || [];
  if (errs.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(errs)}`);
  const target = staged.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("stagedUploadsCreate: aucune cible");

  // POST multipart des octets vers la cible (GCS/S3) avec les paramètres fournis par Shopify.
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new Error(`upload image staged HTTP ${up.status}`);

  // resourceUrl = URL que Shopify peut ré-ingérer comme image d'article.
  return target.resourceUrl;
}

/** Met à jour le corps HTML d'un article (maillage bidirectionnel + refresh). */
export async function updateArticleBody(store, articleId, bodyHtml, extra = {}) {
  const data = await shopifyGraphQL(
    store,
    `mutation($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }`,
    { id: articleId, article: { body: bodyHtml, ...extra } }
  );
  const errs = data.articleUpdate?.userErrors || [];
  if (errs.length) throw new Error(`articleUpdate: ${JSON.stringify(errs)}`);
  return true;
}

/** Récupère le corps HTML actuel d'un article (pour l'éditer). */
export async function getArticleBody(store, articleId) {
  const data = await shopifyGraphQL(
    store,
    `query($id: ID!) { article(id: $id) { id body } }`,
    { id: articleId }
  );
  return data.article?.body || "";
}
