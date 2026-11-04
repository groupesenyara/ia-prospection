import { describe, expect, it } from "vitest";
import { hunterStats, manualItem, normalizeAnalysis, parseBoamp, parseBudget, parseRss, prefilter, priorityOf, referenceList, type HunterItem, type RawItem } from "./hunter.js";
import type { UnitFacts } from "./research.js";

const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Projets</title>
<item><title><![CDATA[Refonte du site vitrine d'un cabinet d'avocats]]></title><link>https://www.codeur.com/projects/1-refonte</link>
<guid>https://www.codeur.com/projects/1-refonte</guid><pubDate>Wed, 04 Nov 2026 09:12:00 +0100</pubDate>
<description><![CDATA[<p>Site WordPress de 2016, non adapté au mobile.</p><p>Budget : 1 000 € à 10 000 €</p>]]></description></item>
<item><title>Traduction de 30 pages en anglais</title><link>https://www.codeur.com/projects/2-trad</link><description>Budget : Moins de 500 €</description></item>
<item><title>Sans lien</title><description>x</description></item>
</channel></rss>`;

const facts: UnitFacts = {
  northreef: [
    { kind: "tarif", text: "Site vitrine : à partir de 1 000 € HT" },
    { kind: "reference", text: "Phil Multi-Services : site web philmultiservices59.fr" },
    { kind: "reference", text: "Bosphore Kebab : cartes de menu" },
  ],
  amandis: [{ kind: "reference", text: "Charna Voyage (agence Selectour) : formations" }, { kind: "interdit", text: "Pas de Qualiopi" }],
};
const item = (o: Partial<RawItem> = {}): RawItem => ({ source: "codeur", externalId: "x", url: "https://x", title: "Refonte de site", description: "", buyer: "", publishedAt: "2026-11-04", deadline: "", budgetMin: 1000, budgetMax: 10000, budgetText: "1 000 € à 10 000 €", ...o });
const notes = (n: number) => ({ correspondance: n, budget: n, faisabilite: n, delai: n, rentabilite: n, qualite_brief: n, references: n });

describe("lecture des sources", () => {
  it("flux RSS : titre, lien, date, texte nettoyé, budget ; ignore les items sans lien", () => {
    const items = parseRss(rss, "codeur");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Refonte du site vitrine d'un cabinet d'avocats", url: "https://www.codeur.com/projects/1-refonte", publishedAt: "2026-11-04", budgetMin: 1000, budgetMax: 10000 });
    expect(items[0].description).toContain("non adapté au mobile");
    expect(items[1]).toMatchObject({ externalId: "https://www.codeur.com/projects/2-trad", budgetMin: 0, budgetMax: 500 });
  });
  it("budgets", () => {
    expect(parseBudget("Budget : Plus de 10 000 €")).toMatchObject({ budgetMin: 10000, budgetMax: null });
    expect(parseBudget("Budget de 3 000 euros pour une appli")).toMatchObject({ budgetMin: 3000, budgetMax: 3000 });
    expect(parseBudget("Pas de budget")).toMatchObject({ budgetMin: null, budgetMax: null });
  });
  it("BOAMP : avis, acheteur, dates, lien vers l'avis", () => {
    const [a] = parseBoamp({ results: [{ idweb: "26-123456", objet: "Refonte du site internet de la commune", nomacheteur: "Commune de Raismes", dateparution: "2026-11-03", datelimitereponse: "2026-12-01T12:00:00+01:00", descripteur_libelle: ["Site internet"], code_departement: ["59"] }] });
    expect(a).toMatchObject({ source: "boamp", externalId: "26-123456", buyer: "Commune de Raismes", publishedAt: "2026-11-03", deadline: "2026-12-01", url: 'https://www.boamp.fr/pages/avis/?q=idweb:"26-123456"' });
    expect(a.description).toContain("Département 59");
  });
  it("annonce collée : identifiant stable (URL ou empreinte du texte)", () => {
    const t = "Bonjour, nous cherchons un formateur IA pour 12 commerciaux, 2 jours en janvier. Budget : 3 000 €";
    const a = manualItem({ source: "malt", url: "", text: t }, "2026-11-05"), b = manualItem({ source: "malt", url: "", text: t }, "2026-11-06");
    expect(a.externalId).toBe(b.externalId);
    expect(a).toMatchObject({ budgetMax: 3000, title: t.slice(0, 160) });
  });
});

describe("pré-filtre gratuit", () => {
  it("garde nos métiers, écarte le hors périmètre sans appeler l'IA", () => {
    expect(prefilter({ title: "Refonte du site vitrine", description: "" })).toEqual(["northreef"]);
    expect(prefilter({ title: "Formation à l'intelligence artificielle pour nos commerciaux", description: "" }).sort()).toEqual(["amandis", "swipsales"]);
    expect(prefilter({ title: "Traduction de 30 pages", description: "" })).toEqual([]);
    expect(prefilter({ title: "Stage développeur web", description: "site" })).toEqual([]);
    expect(prefilter({ title: "Travaux de peinture", description: "" })).toEqual([]);
  });
});

describe("analyse et proposition", () => {
  const base = { pole: "northreef", type_prestation: "Refonte de site", besoin: "Refaire le site", secteur: "Juridique", profil_client: "Cabinet", budget_annonce: "1 000 à 10 000 €", delai: "", complexite: "moyenne", technologies: ["WordPress"], concurrence: "", alertes: [], hypotheses: ["5 pages"], budget_propose: "À partir de 1 000 € HT" };
  it("score recalculé sur les sous-notes, priorité, référence du bon pôle, proposition contrôlée", () => {
    const refs = referenceList(facts);
    const phil = refs.findIndex((r) => /Phil/.test(r.text)) + 1;
    const a = normalizeAnalysis({ ...base, notes: notes(9), reference_index: phil, proposition: "Bonjour, un site vitrine démarre à 1 000 € HT. Nous avons réalisé le site de Phil Multi-Services." }, item(), ["northreef"], facts);
    expect(a).toMatchObject({ unit: "northreef", score: 90, priority: "très élevée", reference: refs[phil - 1].text, validation: "à valider", proposalIssues: [] });
  });
  it("écarte une référence d'un autre pôle et bloque un prix ou une certification non confirmés", () => {
    const charna = referenceList(facts).findIndex((r) => /Charna/.test(r.text)) + 1;
    const a = normalizeAnalysis({ ...base, notes: notes(7), reference_index: charna, proposition: "Notre agence certifiée réalise votre refonte pour 1 500 €." }, item(), ["northreef"], facts);
    expect(a.reference).toBe(""); // Charna Voyage est une référence Amandis (formations) : pas une référence web
    expect(new Set(a.proposalIssues.map((i) => i.rule))).toEqual(new Set(["certification", "prix"]));
    expect(a.priority).toBe("élevée");
  });
  it("projet complexe : pas de prix ferme sans qualification", () => {
    const a = normalizeAnalysis({ ...base, complexite: "élevée", notes: notes(7), reference_index: 0, proposition: "Le site vitrine coûtera 1 000 € HT." }, item(), ["northreef"], facts);
    expect(a.proposalIssues.map((i) => i.rule)).toContain("prix définitif");
    const ok = normalizeAnalysis({ ...base, complexite: "élevée", notes: notes(7), reference_index: 0, proposition: "Un site vitrine démarre à partir de 1 000 € HT, à affiner après un échange." }, item(), ["northreef"], facts);
    expect(ok.proposalIssues).toEqual([]);
  });
  it("hors périmètre, fraude ou pôle non envisagé : non pertinente, aucune proposition", () => {
    expect(normalizeAnalysis({ ...base, notes: notes(9), reference_index: 0, alertes: ["Demande de travail gratuit en échange de visibilité"], proposition: "x" }, item(), ["northreef"], facts)).toMatchObject({ priority: "non pertinente", proposal: "", validation: "à rédiger" });
    expect(normalizeAnalysis({ ...base, pole: "amandis", notes: notes(9), reference_index: 0, proposition: "x" }, item(), ["northreef"], facts)).toMatchObject({ unit: null, priority: "non pertinente" });
    expect(priorityOf(64, false)).toBe("à étudier");
    expect(priorityOf(30, false)).toBe("non pertinente");
  });
});

describe("tableau de bord", () => {
  const h = (o: Partial<HunterItem>): HunterItem => ({ ...item(), id: "i", contact: "", detectedAt: "2026-11-05T08:00:00Z", unit: "northreef", serviceType: "", sector: "", score: 70, priority: "élevée", analysis: {}, reference: "", proposal: "", proposalIssues: [], validation: "à valider", sendStatus: "non envoyée", sentAt: null, followUpDate: "", outcome: "en cours", wonAmount: null, prospectId: null, opportunityId: null, ...o });
  it("compte par statut, par plateforme et par pôle ; CA potentiel pondéré", () => {
    const s = hunterStats([
      h({ id: "1" }),
      h({ id: "2", source: "boamp", sendStatus: "envoyée manuellement", validation: "validée", outcome: "rendez-vous", budgetMin: 4000, budgetMax: 6000 }),
      h({ id: "3", sendStatus: "envoyée manuellement", validation: "validée", outcome: "gagné", wonAmount: 2500 }),
      h({ id: "4", priority: "non pertinente", unit: null, detectedAt: "2026-10-01T08:00:00Z" }),
    ], "2026-11-05");
    expect(s).toMatchObject({ fresh: 3, toValidate: 2, sent: 2, replies: 2, meetings: 2, won: 1, wonAmount: 2500, potential: 5000 * 0.5 + 5500 });
    expect(s.bySource.find((x) => x.key.startsWith("BOAMP"))).toMatchObject({ items: 1, sent: 1, replies: 1 });
    expect(s.byUnit.find((x) => x.key === "Aucun pôle")).toMatchObject({ items: 1, relevant: 0 });
  });
});
