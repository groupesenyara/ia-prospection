// GET /api/cron/prospect — Vercel Cron, 3 passages par jour ouvré. N'ENVOIE RIEN : tout attend la validation de Yannis.
// 1. Détection GRATUITE par le registre officiel, pôle par pôle (activités et tailles visées, départements du jour).
// 2. Détection des entreprises qui recrutent des commerciaux (France Travail si configuré, sinon recherche web).
// 3. Recherche web par l'IA sur les fiches « à rechercher », dans la limite de RESEARCH_DAILY_LIMIT par jour.
import { liveDeps } from "../_lib/deps.js";
import { discover, discoverRegistry, enrichPending, type RegistryReport } from "../_lib/prospecting.js";
import { adminClient, json } from "../_lib/server.js";

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, { error: "Non autorisé" });
  return json(200, await runProspecting());
}

export interface ProspectingConfig { perUnit: number; departements: string[]; units: ("swipsales" | "amandis" | "northreef")[] }
export function readProspectingConfig(v: unknown): ProspectingConfig {
  const c = (v && typeof v === "object" ? v : {}) as Partial<ProspectingConfig>;
  const all = ["swipsales", "amandis", "northreef"] as const;
  const units = (Array.isArray(c.units) ? c.units : [...all]).filter((u): u is ProspectingConfig["units"][number] => (all as readonly string[]).includes(u));
  return { perUnit: Math.max(0, Math.min(100, Number(c.perUnit ?? 20) || 0)), departements: Array.isArray(c.departements) ? c.departements.map(String).slice(0, 20) : [], units };
}

export async function runProspecting() {
  const started = Date.now();
  const db = adminClient();
  const d = liveDeps(db, started + 150_000); // plus de nouvelle recherche après 2 min 30 : les recherches en cours finissent avant la limite de 5 min
  const { data: cfgRow } = await db.from("settings").select("value").eq("key", "prospecting").maybeSingle();
  const cfg = readProspectingConfig(cfgRow?.value);

  const registry: RegistryReport[] = [];
  for (const unit of cfg.units) {
    try { registry.push(await discoverRegistry(d, unit, cfg.perUnit, cfg.departements)); } catch (e) { registry.push({ unit, departements: [], added: [], scanned: 0, note: `Échec : ${(e as Error).message}` }); }
  }
  let discovery;
  try { discovery = cfg.units.includes("swipsales") ? await discover(d, 10) : { offers: 0, companies: 0, added: [], skipped: {}, note: "Swipe Sales désactivé" }; } catch (e) { discovery = { offers: 0, companies: 0, added: [], skipped: {}, note: `Détection en échec : ${(e as Error).message}` }; }
  const enrichment = await enrichPending(d, 8);
  const report = { at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), registry, discovery, enrichment };
  await db.from("settings").upsert({ key: "prospecting_report", value: report });
  return report;
}
