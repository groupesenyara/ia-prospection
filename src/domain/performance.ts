// Ce qui marche : réponses, rendez-vous et clients payants regroupés par canal, campagne, secteur ou segment.
import { CONTACT_TYPES } from "./constants.js";
import type { Interaction, Prospect } from "./types.js";

export interface PerfRow { key: string; contacted: number; replied: number; meetings: number; paid: number; rate: number }

export function perfBy(
  prospects: Prospect[],
  history: Map<string, Interaction[]>,
  keyOf: (p: Prospect, first: Interaction) => string,
): PerfRow[] {
  const g = new Map<string, PerfRow>();
  for (const p of prospects) {
    const hs = history.get(p.id) || [];
    const first = hs.find((h) => CONTACT_TYPES.includes(h.type));
    if (!first) continue;
    const k = keyOf(p, first) || "Non renseigné";
    const r = g.get(k) || { key: k, contacted: 0, replied: 0, meetings: 0, paid: 0, rate: 0 };
    r.contacted++;
    if (hs.some((h) => h.type === "reponse")) r.replied++;
    if (hs.some((h) => h.type === "rdv" || h.type === "demo")) r.meetings++;
    if (p.stage === "Client payant" && p.stripeVerified) r.paid++;
    g.set(k, r);
  }
  return [...g.values()].map((r) => ({ ...r, rate: r.contacted ? r.replied / r.contacted : 0 })).sort((a, b) => b.contacted - a.contacted);
}

/** Moins de 10 entreprises dans un groupe : écart non significatif. */
export const isSignificant = (r: PerfRow): boolean => r.contacted >= 10;

export function objectionCounts(history: Map<string, Interaction[]>): [string, number][] {
  const c = new Map<string, number>();
  for (const hs of history.values()) for (const h of hs) if (h.type === "objection" && h.objection) c.set(h.objection, (c.get(h.objection) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}
