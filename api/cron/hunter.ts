// GET /api/cron/hunter — Vercel Cron, deux passages par jour. Veille des annonces (BOAMP, flux RSS) et, en mode assisté,
// analyse + rédaction des propositions. N'ENVOIE RIEN : la réponse se fait sur la plateforme, après validation de Yannis.
import { hunterDeps } from "../_lib/hunter-deps.js";
import { runHunter } from "../_lib/hunter.js";
import { adminClient, json } from "../_lib/server.js";

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, { error: "Non autorisé" });
  const db = adminClient();
  const report = await runHunter(hunterDeps(db));
  await db.from("settings").upsert({ key: "hunter_report", value: report });
  return json(200, report);
}
