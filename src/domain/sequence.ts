// Ce qui se passe quand on journalise une interaction : étape du pipeline, prochaine action, avancement de la campagne.
import { CHANNEL_OF, CONTACT_TYPES, EVENT_STAGE, FOLLOWUP, STAGES } from "./constants.js";
import { addDays, today } from "./dates.js";
import type { Campaign, EventType, Interaction, Prospect } from "./types.js";

export type ProspectPatch = Partial<Prospect>;

export class RuleError extends Error {}

/** Construit l'interaction à enregistrer, ou lève RuleError si une règle l'interdit. */
export function buildInteraction(p: Prospect, type: EventType, note: string, objection = "", now = new Date()): Interaction {
  if (CONTACT_TYPES.includes(type) && p.optOut) throw new RuleError("Cette entreprise a demandé à ne plus être contactée");
  if (type === "objection" && !objection) throw new RuleError("Choisissez l’objection entendue");
  const day = today();
  return {
    prospectId: p.id, at: now.toISOString(), day, type, note,
    channel: CHANNEL_OF[type], objection: type === "objection" ? objection : undefined,
    campaignId: p.campaignId || null,
  };
}

/** Calcule les champs du prospect à mettre à jour après l'interaction `ev` (déjà incluse dans `history`). */
export function patchAfter(p: Prospect, history: Interaction[], ev: Interaction, campaign?: Campaign | null): ProspectPatch {
  const t = ev.type;
  const patch: ProspectPatch = {};
  const target = EVENT_STAGE[t];
  const ci = STAGES.indexOf(p.stage as (typeof STAGES)[number]);
  if (target != null && (ci < target || ci === 13)) patch.stage = STAGES[target];

  if (CONTACT_TYPES.includes(t)) {
    const n = history.filter((h) => CONTACT_TYPES.includes(h.type)).length;
    const f = FOLLOWUP[Math.min(n, 4)];
    if (f) { patch.nextAction = f.a; patch.nextDate = addDays(today(), f.d); }
    if (n >= 4 && !history.some((h) => h.type === "reponse")) patch.stage = "À recontacter";
  }
  if (t === "reponse") { patch.nextAction = "Répondre et proposer une démo"; patch.nextDate = today(); }
  if (t === "rdv") patch.nextAction = "Préparer la démo";
  if (t === "demo") { patch.nextAction = "Envoyer la proposition"; patch.nextDate = addDays(today(), 1); }
  if (t === "offre") { patch.nextAction = "Relancer la proposition"; patch.nextDate = addDays(today(), 3); }

  Object.assign(patch, campaignPatch(p, history, t, campaign));
  return patch;
}

/** Avancement d'une campagne : l'étape suivante est datée depuis l'inscription ; une réponse arrête la séquence. */
export function campaignPatch(p: Prospect, history: Interaction[], t: EventType, c?: Campaign | null): ProspectPatch {
  if (!c || p.campaignId !== c.id || p.campaignState !== "En cours") return {};
  if (t === "reponse") return { campaignState: "Arrêtée : réponse reçue" };
  if (!CONTACT_TYPES.includes(t)) return {};
  const n = history.filter((h) => CONTACT_TYPES.includes(h.type) && h.campaignId === c.id).length;
  const steps = c.steps || [];
  if (n >= steps.length) {
    return { campaignState: "Terminée sans réponse", nextAction: "Séquence terminée : recontacter dans 3 mois", nextDate: addDays(today(), 90), stage: "À recontacter" };
  }
  const s = steps[n];
  const d = addDays(p.enrolledAt || today(), Number(s.day) || 0);
  return { nextAction: `Étape ${n + 1}/${steps.length} · ${s.channel} — ${c.name}`, nextDate: d < today() ? today() : d };
}

/** Inscription à une campagne : seulement validée, segment compatible, contact autorisé. */
export function enroll(p: Prospect, c: Campaign): ProspectPatch {
  if (c.status !== "Validée") throw new RuleError("Seule une campagne validée peut recevoir des inscriptions");
  if (p.optOut) throw new RuleError("Ne plus contacter : inscription impossible");
  if (c.segment && p.segment && c.segment !== p.segment) throw new RuleError("Le segment de la campagne ne correspond pas à celui de l’entreprise");
  const s0 = c.steps[0];
  return {
    campaignId: c.id, enrolledAt: today(), campaignState: "En cours",
    nextAction: s0 ? `Étape 1/${c.steps.length} · ${s0.channel} — ${c.name}` : "Campagne sans étape",
    nextDate: today(),
  };
}

/** Une campagne validée puis modifiée repasse en brouillon. */
export function campaignStatusAfterEdit(prev: Campaign, next: Omit<Campaign, "id" | "status" | "validatedAt">): Campaign["status"] {
  const keys = ["name", "segment", "goal", "angle", "cta", "dailyCap", "steps"] as const;
  const changed = keys.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  return prev.status === "Validée" && changed ? "Brouillon" : prev.status;
}

/** Remplit un modèle de message ; refuse si une variable reste vide (on n'envoie pas un message à trous). */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  const out = tpl.replace(/\{([^}]+)\}/g, (m, k: string) => {
    const v = vars[k.trim()];
    return v ? v : m;
  });
  const missing = out.match(/\{[^}]+\}/g);
  if (missing) throw new RuleError("Variables non remplies : " + [...new Set(missing)].join(", "));
  return out;
}
