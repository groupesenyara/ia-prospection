// Import des données de la page « SwipSales Growth » (prototype Claude) vers Supabase.
// Entrée : un dossier exporté au format <dossier>/<collection>/<id>.json (prospects, campaigns, config, feedback, content…).
// Usage : npm run import:artifact -- exports            (simulation : affiche, n'écrit rien)
//         npm run import:artifact -- exports --write    (écrit avec la clé service role)
// Idempotent : chaque ancien identifiant donne toujours le même UUID.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { toRow } from "../src/lib/mapping";

export const uuidFrom = (legacy: string): string => {
  const h = createHash("sha1").update("swipsales-growth:" + legacy).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Doc = Record<string, unknown> & { _id: string };
const readCollection = (dir: string, name: string): Doc[] => {
  const d = join(dir, name);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => ({ ...JSON.parse(readFileSync(join(d, f), "utf8")), _id: f.replace(/\.json$/, "") }));
};

const PROSPECT_FIELDS = ["company", "website", "sector", "size", "kind", "roles", "source", "verifiedAt", "decisionName", "decisionTitle", "decisionVerified", "email", "linkedin", "phone", "contactSource", "signal", "signalSource", "signalDate", "need", "crit", "stage", "nextAction", "nextDate", "stripeSubId", "stripeVerified", "optOut", "notes", "segment", "commsConsent", "commsConsentDate", "partnerStatus", "partnerModel", "conventionOk", "partnerNotes", "trialStart", "trialEnd", "engagementOk", "offerPublished", "offerDate", "feedbackScore", "feedbackNotes", "referenceOk", "enrolledAt", "campaignState", "drafts"];

export function transform(dir: string) {
  const campaigns = readCollection(dir, "campaigns").map((c) => ({
    id: uuidFrom("campaign:" + c._id), name: c.name, segment: c.segment || "", goal: c.goal || "", angle: c.angle || "", cta: c.cta || "",
    daily_cap: c.dailyCap || 20, status: "Brouillon", steps: c.steps || [], // toujours réimportées en brouillon : Yannis revalide
  }));
  const prospects: Record<string, unknown>[] = [];
  const interactions: Record<string, unknown>[] = [];
  for (const p of readCollection(dir, "prospects")) {
    const id = uuidFrom("prospect:" + p._id);
    const picked: Record<string, unknown> = {};
    for (const k of PROSPECT_FIELDS) if (p[k] !== undefined) picked[k] = p[k];
    if (picked.stage === "Client payant" && !(picked.stripeVerified && /^sub_/.test(String(picked.stripeSubId)))) picked.stage = "Abonnement commencé";
    if (picked.segment !== "B") { picked.trialStart = ""; picked.trialEnd = ""; }
    prospects.push({ id, ...toRow(picked), campaign_id: p.campaignId ? uuidFrom("campaign:" + p.campaignId) : null });
    for (const [i, h] of ((p.history as Record<string, string>[]) || []).entries()) {
      interactions.push({
        id: uuidFrom(`interaction:${p._id}:${i}`), prospect_id: id, at: h.at, day: h.d, type: h.t, note: h.note || "",
        channel: h.ch || null, objection: h.obj || null, campaign_id: h.camp ? uuidFrom("campaign:" + h.camp) : null,
      });
    }
  }
  const settings = readCollection(dir, "config").map(({ _id, ...value }) => ({ key: _id, value }));
  const feedback = readCollection(dir, "feedback").map((f) => ({ id: uuidFrom("feedback:" + f._id), title: f.title, detail: f.detail || "", source: f.source || "", stage: f.stage || "Autre", status: f.status || "Ouvert", created_at: f.createdAt || null }));
  const content = readCollection(dir, "content").map((c) => ({
    id: uuidFrom("content:" + c._id), title: c.title, networks: c.networks || [], format: c.format || "", target: c.target || "Recruteur", hook: c.hook || "", text: c.text || "", cta: c.cta || "",
    status: ["Validé", "Publié"].includes(String(c.status)) ? "À valider" : c.status || "Idée", date: c.date || null, prospect_id: c.prospectId ? uuidFrom("prospect:" + c.prospectId) : null, kind: c.kind || "",
  }));
  return { campaigns, prospects, interactions, settings, feedback, content };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Indiquez le dossier d'export");
  const data = transform(dir);
  for (const [k, v] of Object.entries(data)) console.log(`${k} : ${v.length}`);
  if (!process.argv.includes("--write")) { console.log("\nSimulation : rien n'a été écrit. Relancez avec --write."); return; }
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (const table of ["campaigns", "prospects", "interactions", "settings", "feedback", "content"] as const) {
    const rows = data[table];
    if (!rows.length) continue;
    const { error } = await db.from(table).upsert(rows, { onConflict: table === "settings" ? "key" : "id" });
    if (error) throw new Error(`${table} : ${error.message}`);
    console.log(`${table} : ${rows.length} lignes importées`);
  }
}
if (process.argv[1]?.endsWith("import-artifact.ts")) main().catch((e) => { console.error(e.message); process.exit(1); });
