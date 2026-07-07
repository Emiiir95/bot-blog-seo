// Lecture / écriture de boutiques/<id>/etat.json + commit git (en CI).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, env } from "./config.js";

export function statePath(storeId) {
  return join(ROOT, "boutiques", storeId, "etat.json");
}

export function loadState(storeId) {
  const p = statePath(storeId);
  if (!existsSync(p)) {
    return { boutique: storeId, derniere_generation_themes: null, dernier_refresh: null, themes: [] };
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveState(storeId, state) {
  writeFileSync(statePath(storeId), JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Commit + push le fichier d'état d'une boutique (silencieux hors CI). */
export function commitState(storeId, message) {
  if (!env.commitState) return;
  const rel = join("boutiques", storeId, "etat.json");
  try {
    git(["config", "user.name", "seo-bot"]);
    git(["config", "user.email", "seo-bot@users.noreply.github.com"]);
    git(["add", rel]);
    // Rien à committer -> git commit renvoie une erreur qu'on ignore.
    try {
      git(["commit", "-m", message]);
    } catch {
      return; // pas de changement
    }
    // Rebase léger en cas de push concurrent, puis push.
    try {
      git(["pull", "--rebase", "--autostash"]);
    } catch {}
    git(["push"]);
  } catch (e) {
    console.warn(`  ⚠️ commit état ${storeId} échoué: ${e.message}`);
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, stdio: "pipe" }).toString();
}
