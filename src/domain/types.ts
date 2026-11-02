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
