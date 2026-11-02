// GET /api/cron/daily — appelée par Vercel Cron en semaine à 6 h UTC (7 h ou 8 h à Paris).
// Prépare les brouillons d'envoi du jour (statut « À valider ») et le rapport. N'ENVOIE RIEN.
import { dailyPlan } from "../../src/domain/daily.js";
import { campaignFromRow, groupHistory, interactionFromRow, prospectFromRow } from "../../src/lib/mapping.js";
import { adminClient, json } from "../_lib/server.js";

export async function GET(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json(401, { error: "Non autorisé" });
  const db = adminClient();
  const [p, c, i, o] = await Promise.all([
    db.from("prospects").select("*"),
    db.from("campaigns").select("*"),
    db.from("interactions").select("*"),
    db.from("outbox").select("prospect_id,campaign_id,step_index").neq("status", "Annulé"),
  ]);
  const err = p.error || c.error || i.error || o.error;
  if (err) return json(500, { error: err.message });
  const queued = new Set((o.data || []).map((r) => `${r.prospect_id}|${r.campaign_id}|${r.step_index}`));
  const plan = dailyPlan((p.data || []).map(prospectFromRow), (c.data || []).map(campaignFromRow), groupHistory((i.data || []).map(interactionFromRow)), queued);
  if (plan.drafts.length) {
    const { error } = await db.from("outbox").insert(plan.drafts.map((d) => ({ prospect_id: d.prospectId, campaign_id: d.campaignId, step_index: d.stepIndex, channel: d.channel, subject: d.subject, body: d.body, status: "À valider" })));
    if (error) return json(500, { error: error.message });
  }
  const report = { at: new Date().toISOString(), drafts: plan.drafts.length, skipped: plan.skipped, due: plan.due.map((x) => ({ id: x.id, company: x.company, nextAction: x.nextAction, nextDate: x.nextDate })), alerts: plan.alerts };
  await db.from("settings").upsert({ key: "daily_report", value: report });
  return json(200, report);
}
