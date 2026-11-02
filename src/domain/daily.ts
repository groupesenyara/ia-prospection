// Préparation quotidienne : ce que l'agent prépare chaque matin. Il ne fait qu'écrire des brouillons « À valider ».
import { CONTACT_TYPES } from "./constants";
import { addDays, today } from "./dates";
import { foundingAlerts } from "./founding";
import { fillTemplate, RuleError } from "./sequence";
import type { Campaign, Interaction, Prospect } from "./types";

export interface OutboxDraft { prospectId: string; campaignId: string; stepIndex: number; channel: string; subject: string; body: string }
export interface DailyPlan { drafts: OutboxDraft[]; skipped: { prospectId: string; reason: string }[]; due: Prospect[]; alerts: ReturnType<typeof foundingAlerts> }

export function varsFor(p: Prospect): Record<string, string> {
  return {
    "Prénom": p.decisionName && p.decisionVerified ? p.decisionName.split(" ")[0] : "",
    Entreprise: p.company,
    "intitulé": p.roles.split(",")[0]?.trim() || "",
    signal: p.signal,
  };
}

/** Sépare « Objet : … » de la première ligne du modèle. */
export function splitSubject(text: string): { subject: string; body: string } {
  const m = text.match(/^Objet\s*:\s*(.+)\n+/);
  return m ? { subject: m[1].trim(), body: text.slice(m[0].length) } : { subject: "", body: text };
}

export function dailyPlan(
  prospects: Prospect[],
  campaigns: Campaign[],
  history: Map<string, Interaction[]>,
  alreadyQueued: Set<string>, // `${prospectId}|${campaignId}|${stepIndex}` déjà présents dans outbox
  now = today(),
): DailyPlan {
  const drafts: OutboxDraft[] = [];
  const skipped: DailyPlan["skipped"] = [];
  const perCampaign = new Map<string, number>();
  for (const p of prospects) {
    const c = campaigns.find((x) => x.id === p.campaignId);
    if (!c || c.status !== "Validée" || p.campaignState !== "En cours") continue;
    if (p.optOut) { skipped.push({ prospectId: p.id, reason: "opposition" }); continue; }
    const hs = history.get(p.id) || [];
    const n = hs.filter((h) => CONTACT_TYPES.includes(h.type) && h.campaignId === c.id).length;
    const step = c.steps[n];
    if (!step) continue;
    if (addDays(p.enrolledAt || now, step.day) > now) continue; // pas encore le jour
    const key = `${p.id}|${c.id}|${n}`;
    if (alreadyQueued.has(key)) continue;
    const count = perCampaign.get(c.id) || 0;
    if (count >= c.dailyCap) { skipped.push({ prospectId: p.id, reason: `plafond de ${c.dailyCap} par jour atteint` }); continue; }
    if (step.channel === "E-mail" && !p.email) { skipped.push({ prospectId: p.id, reason: "pas d'e-mail professionnel sourcé" }); continue; }
    try {
      const { subject, body } = splitSubject(fillTemplate(step.template, varsFor(p)));
      drafts.push({ prospectId: p.id, campaignId: c.id, stepIndex: n, channel: step.channel, subject, body });
      perCampaign.set(c.id, count + 1);
    } catch (e) {
      if (e instanceof RuleError) skipped.push({ prospectId: p.id, reason: e.message });
      else throw e;
    }
  }
  const due = prospects.filter((p) => !p.optOut && p.nextDate && p.nextDate <= now && p.stage !== "Client perdu");
  return { drafts, skipped, due, alerts: foundingAlerts(prospects, now) };
}
