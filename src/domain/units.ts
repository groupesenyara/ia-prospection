// Les trois pôles du Groupe Senyara : ce que chacun vend, à qui, quels signaux le révèlent, son pipeline.
// Ces descriptions viennent de Yannis (brief du 2026-11-04). Prix, certifications, financements et références
// clients n'y figurent PAS : ils ne s'utilisent qu'une fois saisis et confirmés par Yannis (table unit_facts).
import { STAGES } from "./constants.js";

export type UnitId = "swipsales" | "amandis" | "northreef";
export const UNIT_IDS: UnitId[] = ["swipsales", "amandis", "northreef"];

export interface UnitPlaybook {
  id: UnitId;
  name: string;
  pitch: string; // ce qu'est le pôle, en une phrase, sans promesse
  offers: string[]; // catalogue (descriptif, sans prix)
  targets: string[]; // entreprises et interlocuteurs visés
  buyers: string[]; // fonctions à approcher en priorité
  signals: string[]; // signaux d'achat concrets à rechercher
  discovery: string[]; // requêtes types pour la détection
  qualify: string[]; // ce qu'il faut comprendre avant de proposer un rendez-vous
  stages: readonly string[];
  wonStages: string[];
  lostStages: string[];
  activeStages: string[]; // l'entreprise est en cours de sollicitation
  probability: Record<string, number>; // probabilité de gain par étape (chiffre d'affaires pondéré)
  forbidden: string[]; // consignes absolues propres au pôle
}

const P = (pairs: [string, number][]) => Object.fromEntries(pairs);

export const UNITS: Record<UnitId, UnitPlaybook> = {
  swipsales: {
    id: "swipsales",
    name: "Swipe Sales",
    pitch: "SaaS de recrutement réservé aux profils commerciaux : les entreprises et les candidats commerciaux se découvrent par swipe et échangent après un match.",
    offers: ["Abonnement à la plateforme de recrutement de profils commerciaux", "Programme Founding Recruiters (essai encadré, 10 places)", "Partenariats avec écoles et cabinets"],
    targets: ["Entreprises qui recrutent des commerciaux", "Cabinets de recrutement", "Startups et PME", "ESN et sociétés commerciales"],
    buyers: ["DRH ou responsable recrutement", "Directeur commercial", "Dirigeant de PME"],
    signals: ["Offres d'emploi commerciales (SDR, BDR, account executive, commercial terrain)", "Plusieurs postes commerciaux ouverts", "Croissance de l'équipe commerciale", "Levée de fonds ou ouverture d'agence"],
    discovery: ["offre d'emploi SDR BDR", "recrute commercial terrain", "business developer CDI PME"],
    qualify: ["Combien de commerciaux recrutés par an ?", "Comment recrutent-ils aujourd'hui (job boards, cabinet, réseau) ?", "Qui décide de l'outil de recrutement ?"],
    stages: STAGES,
    wonStages: ["Abonnement commencé", "Client payant"],
    lostStages: ["Client perdu"],
    activeStages: ["À contacter", "Contact effectué", "Réponse reçue", "Rendez-vous planifié", "Démonstration réalisée", "Offre présentée", "Essai Founding en cours"],
    probability: P([["Entreprise identifiée", 0.02], ["À qualifier", 0.03], ["Prospect qualifié", 0.08], ["À contacter", 0.08], ["Contact effectué", 0.1], ["Réponse reçue", 0.2], ["Rendez-vous planifié", 0.3], ["Démonstration réalisée", 0.45], ["Offre présentée", 0.6], ["Essai Founding en cours", 0.5], ["Abonnement commencé", 0.9], ["Client payant", 1], ["Client à risque", 0.6], ["Client perdu", 0], ["À recontacter", 0.05]]),
    forbidden: ["N'affirme jamais que Swipe Sales permet de recruter plus vite, moins cher ou mieux.", "Aucun chiffre d'utilisateurs, de candidats ou de résultats non confirmé."],
  },
  amandis: {
    id: "amandis",
    name: "Amandis School",
    pitch: "Organisme de formation : intelligence artificielle, nouveaux métiers, usages numériques et compétences commerciales, pour les entreprises et leurs équipes.",
    offers: [
      "Utilisation professionnelle de l'IA", "Création et utilisation d'agents IA", "Automatisation des processus",
      "Développement des compétences commerciales : prospection et négociation", "Nouveaux usages numériques", "Accompagnement de la transformation des entreprises",
    ],
    targets: ["TPE et PME", "Entreprises qui veulent former leurs collaborateurs", "Organismes de formation"],
    buyers: ["Dirigeant", "DRH", "Responsable formation", "Directeur commercial"],
    signals: [
      "Recrutement de commerciaux juniors ou en reconversion (besoin de montée en compétences)", "Croissance rapide de l'équipe",
      "Projet de digitalisation ou d'adoption de l'IA annoncé", "Nouveaux outils ou nouvelle organisation", "Offres d'emploi mentionnant l'IA ou l'automatisation",
    ],
    discovery: ["PME recrute commerciaux juniors", "entreprise transformation digitale IA collaborateurs", "plan de développement des compétences IA"],
    qualify: ["Quelles compétences manquent aujourd'hui, pour quelle équipe ?", "Combien de personnes à former, à quelle échéance ?", "Qui pilote la formation et le budget ?"],
    stages: ["Entreprise identifiée", "À qualifier", "Besoin qualifié", "Contact effectué", "Réponse reçue", "Rendez-vous planifié", "Proposition de formation", "Devis envoyé", "Formation vendue", "Formation réalisée", "Perdue", "À recontacter"],
    wonStages: ["Formation vendue", "Formation réalisée"],
    lostStages: ["Perdue"],
    activeStages: ["Contact effectué", "Réponse reçue", "Rendez-vous planifié", "Proposition de formation", "Devis envoyé"],
    probability: P([["Entreprise identifiée", 0.02], ["À qualifier", 0.03], ["Besoin qualifié", 0.08], ["Contact effectué", 0.1], ["Réponse reçue", 0.2], ["Rendez-vous planifié", 0.3], ["Proposition de formation", 0.5], ["Devis envoyé", 0.6], ["Formation vendue", 1], ["Formation réalisée", 1], ["Perdue", 0], ["À recontacter", 0.05]]),
    forbidden: [
      "Ne mentionne JAMAIS Qualiopi, une certification, un titre RNCP, une éligibilité OPCO, CPF ou FNE, ni une prise en charge financière, sauf si c'est écrit tel quel dans les faits confirmés.",
      "Aucune durée, aucun tarif, aucun taux de réussite ou de satisfaction non confirmé.",
    ],
  },
  northreef: {
    id: "northreef",
    name: "North Reef",
    pitch: "Développement digital du Groupe Senyara : sites web, applications, logiciels métiers, plateformes SaaS, agents IA et automatisations sur mesure.",
    offers: [
      "Site vitrine, site professionnel, e-commerce, refonte, optimisation et maintenance",
      "Application web ou mobile, logiciel métier, outil professionnel sur mesure, plateforme SaaS, espace client ou portail",
      "Agents IA, automatisation des tâches et de la prospection, intégrations API, connexion entre logiciels, digitalisation des processus",
    ],
    targets: ["Artisans et commerçants", "TPE et PME", "Entreprises locales", "Industries", "Cabinets professionnels", "Organismes de formation", "Startups", "Franchises", "Entreprises de services"],
    buyers: ["Dirigeant", "Responsable des opérations", "Responsable marketing ou communication", "DSI ou responsable informatique"],
    signals: [
      "Pas de site internet, ou site vieillissant (design daté, copyright ancien, pas de HTTPS)", "Site non adapté au mobile", "Faible présence numérique",
      "Processus manuels ou fichiers Excel mis en avant (formulaires papier, commandes par téléphone ou par e-mail)", "Besoin d'un logiciel métier ou d'une application",
      "Recrutement de développeurs ou de profils techniques", "Croissance, nouvel établissement, franchise en développement", "Tâches répétitives à automatiser",
    ],
    discovery: ["artisan site internet", "PME logiciel métier sur mesure", "recrute développeur web PME", "franchise développement réseau"],
    qualify: ["Quel problème concret coûte du temps ou des clients aujourd'hui ?", "Quels outils sont utilisés (site, logiciels, Excel) ?", "Qui décide, avec quel budget et quelle échéance ?"],
    stages: ["Entreprise identifiée", "À qualifier", "Besoin qualifié", "Contact effectué", "Réponse reçue", "Rendez-vous découverte", "Audit ou cahier des charges", "Devis envoyé", "Projet signé", "Projet livré", "Perdu", "À recontacter"],
    wonStages: ["Projet signé", "Projet livré"],
    lostStages: ["Perdu"],
    activeStages: ["Contact effectué", "Réponse reçue", "Rendez-vous découverte", "Audit ou cahier des charges", "Devis envoyé"],
    probability: P([["Entreprise identifiée", 0.02], ["À qualifier", 0.03], ["Besoin qualifié", 0.08], ["Contact effectué", 0.1], ["Réponse reçue", 0.2], ["Rendez-vous découverte", 0.3], ["Audit ou cahier des charges", 0.45], ["Devis envoyé", 0.55], ["Projet signé", 1], ["Projet livré", 1], ["Perdu", 0], ["À recontacter", 0.05]]),
    forbidden: [
      "Ne critique jamais le site ou les outils de l'entreprise : décris un constat factuel et sourcé, sous forme de question.",
      "Aucun délai de livraison, aucun prix, aucune référence client ni aucun gain chiffré non confirmé.",
    ],
  },
};

export const unitName = (id: string): string => UNITS[id as UnitId]?.name || id;

/** Statut de l'opportunité d'après l'étape du pipeline du pôle. */
export function statusOf(unit: UnitId, stage: string): "ouverte" | "gagnée" | "perdue" {
  const u = UNITS[unit];
  return u.wonStages.includes(stage) ? "gagnée" : u.lostStages.includes(stage) ? "perdue" : "ouverte";
}

/** Bloc de consignes d'un pôle, injecté dans les prompts de rédaction et de qualification. */
export function playbookText(unit: UnitId, confirmedFacts: string[]): string {
  const u = UNITS[unit];
  return `PÔLE : ${u.name}
${u.pitch}
Offres (descriptif, sans prix) : ${u.offers.join(" ; ")}
Interlocuteurs à privilégier : ${u.buyers.join(", ")}
À comprendre avant de proposer un rendez-vous : ${u.qualify.join(" ")}
Interdits propres au pôle :
${u.forbidden.map((f) => "- " + f).join("\n")}
FAITS CONFIRMÉS PAR YANNIS (seules affirmations autorisées sur l'offre)
${confirmedFacts.length ? confirmedFacts.map((f) => "- " + f).join("\n") : "- Aucun : décris seulement le domaine d'expertise du pôle, sans prix, sans certification, sans référence."}`;
}
