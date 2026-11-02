// Programme Founding Recruiters : 10 places, essai de 45 jours réservé aux grands comptes ABM (segment B).
import { FOUNDING_SEATS, TRIAL_DAYS } from "./constants.js";
import { addDays, daysBetween, today } from "./dates.js";
import { RuleError } from "./sequence.js";
import type { Prospect } from "./types.js";

export function startTrial(p: Prospect, all: Prospect[], start = today()): Partial<Prospect> {
  if (p.segment !== "B") throw new RuleError("L’essai est réservé aux grands comptes du segment B");
  if (!p.engagementOk) throw new RuleError("Engagement écrit requis avant de démarrer l’essai");
  if (p.trialStart) throw new RuleError("Essai déjà démarré");
  const used = all.filter((x) => x.trialStart && x.id !== p.id).length;
  if (used >= FOUNDING_SEATS) throw new RuleError(`Les ${FOUNDING_SEATS} places sont prises`);
  return {
    trialStart: start, trialEnd: addDays(start, TRIAL_DAYS), stage: "Essai Founding en cours",
    nextAction: "Vérifier la publication de l’offre (J+7)", nextDate: addDays(start, 7),
  };
}

export interface FoundingAlert { prospectId: string; company: string; label: string }

/** Échéances du programme : J+7 offre, J+15 point, J+35 bilan chiffré, J+40 appel, J+43 proposition. */
export function foundingAlerts(list: Prospect[], now = today()): FoundingAlert[] {
  const out: FoundingAlert[] = [];
  for (const p of list) {
    if (p.segment !== "B" || !p.trialStart) continue;
    const d = daysBetween(p.trialStart, now) + 1;
    const push = (label: string) => out.push({ prospectId: p.id, company: p.company, label });
    if (d >= 7 && !p.offerPublished) push(`J+${d} : offre pas encore publiée`);
    if (d >= 15 && d < 20) push("Point de mi-parcours (J+15)");
    if (d >= 35 && d < 40) push("Envoyer le bilan chiffré (J+35)");
    if (d >= 40 && d < 43 && p.feedbackScore == null) push("Appel de bilan (J+40)");
    if (d >= 43 && d <= TRIAL_DAYS && p.stage !== "Client payant") push("Proposition d’abonnement (J+43)");
  }
  return out;
}
