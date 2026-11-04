// Modèle de données de SwipSales Growth. Miroir des tables Supabase (snake_case côté base, camelCase ici).

export type Segment = "" | "A" | "B" | "C";
export type Basis = "f" | "h"; // fait vérifié / hypothèse

export interface Criterion { v: number; b: Basis }

export interface Prospect {
  id: string;
  company: string;
  website: string;
  sector: string;
  size: string;
  kind: string;
  roles: string;
  source: string;
  verifiedAt: string;
  decisionName: string;
  decisionTitle: string;
  decisionVerified: boolean;
  email: string;
  linkedin: string;
  phone: string;
  contactSource: string;
  signal: string;
  signalSource: string;
  signalDate: string;
  need: string;
  crit: Record<string, Criterion>;
  stage: string;
  nextAction: string;
  nextDate: string;
  stripeSubId: string;
  stripeVerified: boolean;
  optOut: boolean;
  notes: string;
  // ABM
  segment: Segment;
  commsConsent: boolean;
  commsConsentDate: string;
  partnerStatus: string;
  partnerModel: string;
  conventionOk: boolean;
  partnerNotes: string;
  trialStart: string;
  trialEnd: string;
  engagementOk: boolean;
  offerPublished: boolean;
  offerDate: string;
  feedbackScore: number | null;
  feedbackNotes: string;
  referenceOk: boolean;
  // campagne
  campaignId: string | null;
  enrolledAt: string;
  campaignState: string;
  // agent de prospection (facultatifs : absents des fiches créées à la main)
  siren?: string | null;
  city?: string;
  headcount?: string;
  naf?: string;
  origin?: string;
  research?: ResearchDossier | null;
  researchStatus?: "" | "à rechercher" | "en cours" | "fait" | "échec";
  researchedAt?: string | null;
}

/** Une information publique et la page où elle a été lue. Sans source, elle n'est pas conservée. */
export interface Sourced { url: string; date?: string }
export interface PublicContact extends Sourced { type: "email" | "telephone" | "linkedin" | "formulaire"; value: string; owner: string }
export interface DecisionMaker extends Sourced { name: string; title: string }
export interface SourcedFact extends Sourced { text: string }
export interface Angle { angle: string; basis: string }

/** Dossier : registre et offres (détection), puis ce que l'agent a trouvé sur le web public, chaque élément avec sa source. */
export interface ResearchDossier {
  at?: string;
  summary?: string;
  website?: string;
  sector?: string;
  decisionMakers?: DecisionMaker[];
  contacts?: PublicContact[];
  facts?: SourcedFact[];
  signals?: SourcedFact[];
  angles?: Angle[];
  need?: string;
  gaps?: string;
  registry?: { siren: string; name: string; naf: string; headcount: string; city: string; created: string; url: string; officers: { name: string; role: string }[] };
  offers?: { title: string; url: string; date: string; city: string }[];
  rejected?: number;
  cost?: { tokensIn: number; tokensOut: number; searches: number; fetches: number; usd?: number };
}

export type EventType =
  | "contact_email" | "contact_linkedin" | "contact_appel" | "contact_whatsapp"
  | "reponse" | "rdv" | "demo" | "offre" | "objection" | "note";

export interface Interaction {
  id?: string;
  prospectId: string;
  at: string; // ISO
  day: string; // AAAA-MM-JJ
  type: EventType;
  note: string;
  channel?: string;
  objection?: string;
  campaignId?: string | null;
  unit?: string; // pôle (Swipe Sales par défaut)
  opportunityId?: string | null;
}

export interface CampaignStep { day: number; channel: string; template: string }

export interface Campaign {
  id: string;
  name: string;
  segment: Segment;
  goal: string;
  angle: string;
  cta: string;
  dailyCap: number;
  status: "Brouillon" | "Validée" | "En pause" | "Terminée";
  validatedAt: string | null;
  steps: CampaignStep[];
}

export interface Drafts {
  by: "claude" | "modele";
  generatedAt: string;
  validated?: boolean;
  validatedAt?: string | null;
  [k: string]: unknown;
}

export interface ContentItem {
  id: string;
  title: string;
  networks: string[];
  format: string;
  target: string;
  hook: string;
  text: string;
  cta: string;
  status: "Idée" | "Brouillon" | "À valider" | "Validé" | "Publié";
  date: string;
  prospectId: string;
  kind: string;
}

/** Opportunité d'un pôle sur une entreprise (une seule ouverte par pôle, une seule active par entreprise). */
export interface Opportunity {
  id: string;
  prospectId: string;
  unit: string;
  stage: string;
  status: "ouverte" | "en attente" | "gagnée" | "perdue";
  active: boolean;
  score: number | null;
  crit: Record<string, Criterion>;
  offer: string;
  reason: string;
  need: string;
  signal: string;
  signalSource: string;
  signalDate: string;
  valueEstimate: number | null;
  nextAction: string;
  nextDate: string;
  createdAt?: string;
  updatedAt?: string;
}
