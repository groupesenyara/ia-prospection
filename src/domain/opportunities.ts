// Opportunités par pôle : choix du pôle à solliciter en premier, valeur pondérée, indicateurs par pôle et pour le groupe.
import { CONTACT_TYPES } from "./constants.js";
import type { Interaction, Opportunity } from "./types.js";
import { UNITS, type UnitId } from "./units.js";

export interface Candidate { unit: UnitId; score: number; signalDate?: string; reason: string }

/**
 * Un prospect peut intéresser plusieurs pôles : on n'en sollicite qu'un à la fois.
 * Le meilleur score l'emporte ; à score égal, le signal le plus récent ; un écart de moins de 5 points est une égalité.
 */
export function rankCandidates(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => (Math.abs(b.score - a.score) >= 5 ? b.score - a.score : (b.signalDate || "").localeCompare(a.signalDate || "") || b.score - a.score));
}

export const probabilityOf = (o: Pick<Opportunity, "unit" | "stage" | "status">): number =>
  o.status === "gagnée" ? 1 : o.status === "perdue" ? 0 : UNITS[o.unit as UnitId]?.probability[o.stage] ?? 0.05;

/** Chiffre d'affaires potentiel pondéré : valeur estimée × probabilité de l'étape. */
export const weightedValue = (o: Pick<Opportunity, "unit" | "stage" | "status" | "valueEstimate">): number => (o.valueEstimate || 0) * probabilityOf(o);

export interface UnitKpis {
  unit: string;
  prospects: number; // entreprises avec une opportunité dans ce pôle
  qualified: number;
  contacted: number;
  replied: number;
  meetings: number;
  open: number;
  won: number;
  lost: number;
  pipeline: number; // valeur estimée des opportunités ouvertes
  weighted: number; // chiffre d'affaires potentiel pondéré
  wonValue: number;
  replyRate: number;
  meetingRate: number;
  winRate: number; // gagnées / (gagnées + perdues)
}

const QUALIFIED = /qualifi|rendez|d[ée]mo|offre|proposition|devis|audit|essai|abonnement|client|vendue|sign|livr|r[ée]alis/i;

/** Indicateurs d'un pôle (unit) ou du groupe (unit = "groupe" : une entreprise n'est comptée qu'une fois). */
export function kpis(unit: string, opps: Opportunity[], interactions: Interaction[]): UnitKpis {
  const list = unit === "groupe" ? opps : opps.filter((o) => o.unit === unit);
  const evs = unit === "groupe" ? interactions : interactions.filter((i) => (i.unit || "swipsales") === unit);
  const companies = (f: (o: Opportunity) => boolean) => new Set(list.filter(f).map((o) => o.prospectId)).size;
  const withEvent = (types: string[]) => new Set(evs.filter((i) => types.includes(i.type)).map((i) => i.prospectId)).size;
  const won = list.filter((o) => o.status === "gagnée"), lost = list.filter((o) => o.status === "perdue"), open = list.filter((o) => o.status === "ouverte" || o.status === "en attente");
  const contacted = withEvent(CONTACT_TYPES), replied = withEvent(["reponse"]), meetings = withEvent(["rdv", "demo"]);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    unit,
    prospects: companies(() => true),
    qualified: companies((o) => QUALIFIED.test(o.stage) || o.status === "gagnée"),
    contacted, replied, meetings,
    open: open.length,
    won: companies((o) => o.status === "gagnée"),
    lost: lost.length,
    pipeline: round(open.reduce((s, o) => s + (o.valueEstimate || 0), 0)),
    weighted: round(open.reduce((s, o) => s + weightedValue(o), 0)),
    wonValue: round(won.reduce((s, o) => s + (o.valueEstimate || 0), 0)),
    replyRate: contacted ? replied / contacted : 0,
    meetingRate: contacted ? meetings / contacted : 0,
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : 0,
  };
}

/** Le pôle peut-il contacter l'entreprise ? (même règle que la base : un seul pôle actif à la fois) */
export function contactBlocker(prospectId: string, unit: string, opps: Pick<Opportunity, "prospectId" | "unit" | "active">[]): string | null {
  const other = opps.find((o) => o.prospectId === prospectId && o.active && o.unit !== unit);
  return other ? `Déjà sollicitée par ${UNITS[other.unit as UnitId]?.name || other.unit} : une seule activité à la fois` : null;
}
