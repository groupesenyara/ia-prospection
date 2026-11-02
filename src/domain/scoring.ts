// Score de qualification transparent : 6 critères pondérés, chacun noté de 0 à 3, fait vérifié ou hypothèse.
import { daysBetween, today } from "./dates";
import type { Basis, Prospect } from "./types";

export interface CriterionDef { k: string; w: number; label: string; levels: string[]; auto?: boolean }

export const CRITERIA: CriterionDef[] = [
  { k: "volume", w: 25, label: "Volume et fréquence des recrutements commerciaux", levels: ["Aucun recrutement commercial repéré", "Un poste ponctuel", "2 à 3 postes, ou recrutements réguliers", "4 postes ou plus, ou recrutement continu"] },
  { k: "pertinence", w: 20, label: "Pertinence des postes recherchés", levels: ["Pas un poste commercial", "Poste commercial annexe (ADV, support)", "SDR, BDR, commercial sédentaire ou terrain", "Plusieurs profils sales (SDR, AE, closer, BizDev)"] },
  { k: "fit", w: 15, label: "Adéquation avec SwipSales", levels: ["Hors cible", "Adéquation faible", "Bonne adéquation", "Cas d’usage idéal"] },
  { k: "access", w: 15, label: "Accès au décideur", levels: ["Décideur inconnu", "Décideur identifié, sans canal", "Décideur identifié et un canal pro", "Décideur, canal et lien existant"] },
  { k: "signal", w: 15, label: "Signal d’achat récent (calculé)", levels: ["Aucun signal sourcé", "Signal de plus de 90 jours", "Signal de 31 à 90 jours", "Signal de moins de 30 jours"], auto: true },
  { k: "recurrence", w: 10, label: "Probabilité d’abonnement récurrent", levels: ["Faible", "Moyenne", "Bonne", "Forte"] },
];

/** Niveau du signal : 0 sans source ; sinon selon l'ancienneté de la date du signal. */
export function signalLevel(p: Pick<Prospect, "signal" | "signalSource" | "signalDate">, now = today()): number {
  if (!p.signal || !p.signalSource) return 0;
  if (!p.signalDate) return 1;
  const age = daysBetween(p.signalDate, now);
  return age <= 30 ? 3 : age <= 90 ? 2 : 1;
}

export interface ScoreResult {
  total: number;
  fact: number;
  prio: "A" | "B" | "C";
  parts: { k: string; w: number; v: number; b: Basis; pts: number }[];
}

export function scoreOf(p: Pick<Prospect, "crit" | "signal" | "signalSource" | "signalDate">, now = today()): ScoreResult {
  const c = p.crit || {};
  let total = 0, fact = 0;
  const parts: ScoreResult["parts"] = [];
  for (const k of CRITERIA) {
    const v = k.auto ? signalLevel(p, now) : Math.max(0, Math.min(3, Number(c[k.k]?.v) || 0));
    const b: Basis = k.auto ? (p.signalSource ? "f" : "h") : c[k.k]?.b === "f" ? "f" : "h";
    const pts = (k.w * v) / 3;
    total += pts;
    if (b === "f") fact += pts;
    parts.push({ k: k.k, w: k.w, v, b, pts });
  }
  total = Math.round(total);
  fact = Math.round(fact);
  return { total, fact, parts, prio: total >= 70 ? "A" : total >= 45 ? "B" : "C" };
}
