// Liste LinkedIn du jour : les décideurs à inviter aujourd'hui, avec la note d'invitation préparée par l'agent.
// L'envoi se fait À LA MAIN sur LinkedIn (ses conditions interdisent l'automatisation) ; l'outil prépare et journalise.
import { CONTACT_TYPES } from "./constants.js";
import { daysBetween } from "./dates.js";
import { scoreOf } from "./scoring.js";
import type { Interaction, Prospect } from "./types.js";
import type { UnitId } from "./units.js";

/** Rythme prudent : LinkedIn limite les invitations hebdomadaires ; 10 par jour ouvré reste largement en dessous. */
export const LINKEDIN_DAILY = 10;
export const NOTE_MAX = 300;

type P = Prospect & { drafts?: Record<string, unknown> | null };

/** Note d'invitation : ligne « LinkedIn : … » des brouillons rédigés par l'agent. */
export function linkedinNote(p: P): string {
  const raw = typeof p.drafts?.raw === "string" ? p.drafts.raw : "";
  const fromLine = raw.match(/^LinkedIn\s*:\s*(.+)$/m)?.[1]?.trim();
  if (fromLine) return fromLine;
  try { const j = JSON.parse(raw) as { linkedin?: unknown }; return typeof j.linkedin === "string" ? j.linkedin.trim() : ""; } catch { return ""; }
}

/** Profil du décideur s'il a été trouvé (lien /in/), sinon une recherche LinkedIn à ouvrir soi-même. */
export function profileUrl(p: P): { url: string; direct: boolean } {
  const cands = [p.linkedin, ...(p.research?.contacts || []).filter((c) => c.type === "linkedin").map((c) => c.value)].filter(Boolean);
  const person = cands.find((u) => /linkedin\.com\/in\//i.test(u));
  if (person) return { url: person, direct: true };
  const q = [p.decisionName, p.company].filter(Boolean).join(" ");
  return { url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`, direct: false };
}

export interface LinkedInTask { prospect: P; unit: UnitId; note: string; profile: { url: string; direct: boolean }; score: number; reason: string }

/**
 * Sélection du jour : fiches recherchées, sans opposition, avec un décideur identifié, jamais invitées sur LinkedIn,
 * pas contactées dans les 3 derniers jours, et pas déjà sollicitées par un AUTRE pôle que celui de la note.
 * Classement : score, puis fraîcheur du signal.
 */
export function linkedinQueue(prospects: P[], history: Map<string, Interaction[]>, activeUnitOf: Map<string, string>, today: string, limit = LINKEDIN_DAILY): LinkedInTask[] {
  const out: LinkedInTask[] = [];
  for (const p of prospects) {
    if (p.optOut || !p.decisionName) continue;
    const hs = history.get(p.id) || [];
    if (hs.some((h) => h.type === "contact_linkedin")) continue;
    const last = hs.filter((h) => CONTACT_TYPES.includes(h.type)).map((h) => h.day).sort().pop();
    if (last && daysBetween(last, today) < 3) continue;
    const unit = ((p.drafts?.unit as string) || p.research?.primaryUnit || "swipsales") as UnitId;
    const active = activeUnitOf.get(p.id);
    if (active && active !== unit) continue;
    const note = linkedinNote(p);
    if (!note) continue;
    out.push({ prospect: p, unit, note, profile: profileUrl(p), score: p.research?.units?.find((u) => u.unit === unit)?.score ?? scoreOf(p).total, reason: p.research?.units?.find((u) => u.unit === unit)?.reason || p.signal });
  }
  return out.sort((a, b) => b.score - a.score || (b.prospect.signalDate || "").localeCompare(a.prospect.signalDate || "")).slice(0, limit);
}
