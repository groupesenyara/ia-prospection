// GET /api/cron/prospect — Vercel Cron, en semaine à 5 h UTC (avant la préparation des envois).
// 1. Repère les entreprises qui publient des offres commerciales (France Travail) et crée leur fiche (registre public).
// 2. Lance la recherche web par l'IA sur les fiches « à rechercher », dans la limite de RESEARCH_DAILY_LIMIT.
// N'ENVOIE RIEN : les brouillons attendent la validation de Yannis.
import { liveDeps } from "../_lib/deps.js";
import { discover, enrichPending } from "../_lib/prospecting.js";
import { adminClient, json } from "../_lib/server.js";

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, { error: "Non autorisé" });
  return json(200, await runProspecting());
}

export async function runProspecting() {
  const started = Date.now();
  const db = adminClient();
  const d = liveDeps(db, started + 200_000);
  const pending = (await d.store.pending(d.dailyLimit)).length;
  let discovery;
  try { discovery = await discover(d, d.dailyLimit - pending); } catch (e) { discovery = { offers: 0, companies: 0, added: [], skipped: {}, note: `Détection en échec : ${(e as Error).message}` }; }
  const enrichment = await enrichPending(d);
  const report = { at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), discovery, enrichment };
  await db.from("settings").upsert({ key: "prospecting_report", value: report });
  return report;
}
