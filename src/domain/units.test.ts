import { describe, expect, it } from "vitest";
import { canValidateDraft, checkClaims, type ConfirmedFact } from "./claims.js";
import { STAGES } from "./constants.js";
import { contactBlocker, kpis, rankCandidates, weightedValue } from "./opportunities.js";
import type { Interaction, Opportunity } from "./types.js";
import { playbookText, statusOf, UNIT_IDS, UNITS } from "./units.js";

describe("pôles", () => {
  it("Swipe Sales garde exactement son pipeline actuel", () => {
    expect(UNITS.swipsales.stages).toBe(STAGES);
    expect(statusOf("swipsales", "Client payant")).toBe("gagnée");
    expect(statusOf("swipsales", "Client perdu")).toBe("perdue");
  });
  it("chaque pôle est cohérent : étapes connues, probabilité définie pour chaque étape", () => {
    for (const id of UNIT_IDS) {
      const u = UNITS[id];
      for (const s of [...u.wonStages, ...u.lostStages, ...u.activeStages]) expect(u.stages).toContain(s);
      for (const s of u.stages) expect(u.probability[s], `${id} / ${s}`).toBeTypeOf("number");
    }
  });
  it("Amandis : interdit Qualiopi, OPCO, CPF et financement sans fait confirmé ; aucun prix dans le catalogue", () => {
    const t = playbookText("amandis", []);
    expect(t).toMatch(/Qualiopi/);
    expect(t).toMatch(/Aucun : décris seulement le domaine/);
    for (const id of UNIT_IDS) expect(UNITS[id].offers.join(" ")).not.toMatch(/\d\s?€|qualiopi|opco|cpf/i);
  });
});

describe("garde-fou sur les affirmations", () => {
  const draft = "Bonjour, nos formations sont certifiées Qualiopi et finançables par votre OPCO, à partir de 990 € HT. Nos clients gagnent 30 % de temps. Dernières places !";
  it("bloque certification, financement, prix, référence, résultat et fausse urgence non confirmés", () => {
    const rules = checkClaims(draft, []).map((i) => i.rule);
    expect(new Set(rules)).toEqual(new Set(["certification", "financement", "prix", "référence", "résultat", "urgence"]));
    expect(canValidateDraft(draft, [])).toBe(false);
  });
  it("une affirmation n'est couverte que par un fait confirmé du bon type et du même sujet", () => {
    const facts: ConfirmedFact[] = [
      { kind: "certification", text: "Amandis School est certifiée Qualiopi (actions de formation) depuis 2025" },
      { kind: "tarif", text: "Formation IA en entreprise : 990 € HT par jour" },
      { kind: "offre", text: "Plateforme réservée aux candidats commerciaux" }, // ne couvre PAS « nos clients »
    ];
    const rules = checkClaims(draft, facts).map((i) => i.rule);
    expect(rules).not.toContain("certification");
    expect(rules).not.toContain("prix");
    expect(rules).toEqual(expect.arrayContaining(["financement", "référence", "résultat", "urgence"]));
    expect(checkClaims("Tarif : 1 200 €", facts).map((i) => i.rule)).toEqual(["prix"]); // autre montant : non couvert
  });
  it("ne signale pas un message sobre ni la citation d'une source", () => {
    const ok = "Bonjour Claire, j'ai vu votre annonce de business developer sur France Travail. Comment formez-vous vos nouveaux commerciaux ? Si ce n'est pas le sujet, dites-le-moi et je ne vous relancerai pas.";
    expect(checkClaims(ok, [])).toEqual([]);
  });
});

const opp = (o: Partial<Opportunity>): Opportunity => ({ id: "o", prospectId: "p1", unit: "swipsales", stage: "Entreprise identifiée", status: "ouverte", active: false, score: null, crit: {}, offer: "", reason: "", need: "", signal: "", signalSource: "", signalDate: "", valueEstimate: null, nextAction: "", nextDate: "", ...o });
const ev = (prospectId: string, type: Interaction["type"], unit = "swipsales"): Interaction => ({ prospectId, type, unit, at: "", day: "2026-11-05", note: "" });

describe("opportunités", () => {
  it("priorise le meilleur score, puis le signal le plus récent si les scores sont proches", () => {
    expect(rankCandidates([{ unit: "amandis", score: 60, reason: "" }, { unit: "northreef", score: 75, reason: "" }])[0].unit).toBe("northreef");
    expect(rankCandidates([{ unit: "amandis", score: 70, signalDate: "2026-11-01", reason: "" }, { unit: "swipsales", score: 72, signalDate: "2026-10-01", reason: "" }])[0].unit).toBe("amandis");
  });
  it("valeur pondérée par l'étape du pipeline du pôle", () => {
    expect(weightedValue(opp({ unit: "northreef", stage: "Devis envoyé", valueEstimate: 10000 }))).toBe(5500);
    expect(weightedValue(opp({ unit: "amandis", stage: "Perdue", status: "perdue", valueEstimate: 3000 }))).toBe(0);
  });
  it("indicateurs par pôle et pour le groupe, sans compter deux fois une entreprise", () => {
    const opps = [
      opp({ id: "1", prospectId: "a", unit: "swipsales", stage: "Rendez-vous planifié", valueEstimate: 1200 }),
      opp({ id: "2", prospectId: "a", unit: "amandis", stage: "Besoin qualifié", status: "en attente", valueEstimate: 4000 }),
      opp({ id: "3", prospectId: "b", unit: "northreef", stage: "Projet signé", status: "gagnée", valueEstimate: 8000 }),
    ];
    const evs = [ev("a", "contact_email"), ev("a", "reponse"), ev("a", "rdv"), ev("b", "contact_appel", "northreef")];
    const g = kpis("groupe", opps, evs);
    expect(g).toMatchObject({ prospects: 2, contacted: 2, replied: 1, meetings: 1, open: 2, won: 1, wonValue: 8000, pipeline: 5200 });
    expect(g.weighted).toBe(1200 * 0.3 + 4000 * 0.08);
    const s = kpis("swipsales", opps, evs);
    expect(s).toMatchObject({ prospects: 1, contacted: 1, replied: 1, replyRate: 1, meetingRate: 1 });
    expect(kpis("amandis", opps, evs)).toMatchObject({ prospects: 1, contacted: 0, qualified: 1 });
  });
  it("un seul pôle sollicite l'entreprise à la fois", () => {
    const opps = [opp({ prospectId: "a", unit: "swipsales", active: true })];
    expect(contactBlocker("a", "amandis", opps)).toMatch(/Swipe Sales/);
    expect(contactBlocker("a", "swipsales", opps)).toBeNull();
  });
});
