import type { EventType } from "./types.js";

export const STAGES = [
  "Entreprise identifiée", "À qualifier", "Prospect qualifié", "À contacter", "Contact effectué",
  "Réponse reçue", "Rendez-vous planifié", "Démonstration réalisée", "Offre présentée",
  "Abonnement commencé", "Client payant", "Client à risque", "Client perdu", "À recontacter",
  "Essai Founding en cours",
] as const;

export const KINDS = [
  "Entreprise qui recrute", "Cabinet de recrutement", "École / formation (partenaire)",
  "Apporteur d'affaires", "Autre partenaire",
] as const;
export const PARTNER_KINDS: readonly string[] = KINDS.slice(1);

export const SEGMENT_LABEL: Record<string, string> = { "": "Non segmenté", A: "A · Partenaire", B: "B · Founding Recruiter", C: "C · Vente directe" };
export const PARTNER_STATUS = ["Identifié", "Proposition envoyée", "En négociation", "Convention à valider", "Actif", "Refusé"] as const;
export const OBJECTIONS = [
  "On a déjà LinkedIn / Indeed", "On passe par un cabinet", "On recrute peu", "Prix / budget", "Je vais réfléchir",
  "Envoyez une présentation", "Pas intéressé", "On a notre réseau", "Vous êtes nouveaux / combien d'utilisateurs",
  "Veut tester avant de payer", "Ne veut pas d'abonnement", "Autre",
] as const;
export const CHANNELS = ["E-mail", "LinkedIn", "WhatsApp", "Téléphone"] as const;

export const EVENT_LABEL: Record<EventType, string> = {
  contact_email: "E-mail envoyé", contact_linkedin: "Message LinkedIn envoyé", contact_appel: "Appel passé",
  contact_whatsapp: "Message WhatsApp envoyé", reponse: "Réponse reçue", rdv: "Rendez-vous fixé",
  demo: "Démo réalisée", offre: "Offre présentée", objection: "Objection entendue", note: "Note",
};
export const CONTACT_TYPES: EventType[] = ["contact_email", "contact_linkedin", "contact_appel", "contact_whatsapp"];
export const CHANNEL_OF: Partial<Record<EventType, string>> = {
  contact_email: "E-mail", contact_linkedin: "LinkedIn", contact_appel: "Téléphone", contact_whatsapp: "WhatsApp",
};
/** Étape minimale atteinte quand on journalise un événement (index dans STAGES). */
export const EVENT_STAGE: Partial<Record<EventType, number>> = {
  contact_email: 4, contact_linkedin: 4, contact_appel: 4, contact_whatsapp: 4, reponse: 5, rdv: 6, demo: 7, offre: 8,
};
/** Relances par défaut hors campagne : délai après le n-ième contact. */
export const FOLLOWUP: (null | { d: number; a: string })[] = [
  null,
  { d: 3, a: "Relance 1 (autre canal)" },
  { d: 4, a: "Relance 2 : question courte" },
  { d: 7, a: "Dernier message, puis clore" },
  { d: 90, a: "Recontacter dans 3 mois" },
];

export const FOUNDING_SEATS = 10;
export const TRIAL_DAYS = 45;
