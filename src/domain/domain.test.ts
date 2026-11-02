import { describe, expect, it } from "vitest";
import { addDays, today } from "./dates";
import { findDuplicate, normName } from "./dedup";
import { foundingAlerts, startTrial } from "./founding";
import { objectionCounts, perfBy } from "./performance";
import { scoreOf, signalLevel } from "./scoring";
import { buildInteraction, campaignStatusAfterEdit, enroll, fillTemplate, patchAfter, RuleError } from "./sequence";
import { contentSuggestions } from "./suggestions";
import type { Campaign, Interaction, Prospect } from "./types";
import { canApproveContent, pendingValidation } from "./validation";

const base = (o: Partial<Prospect> = {}): Prospect => ({
  id: "p1", company: "Acme", website: "", sector: "", size: "Inconnue", kind: "Entreprise qui recrute", roles: "", source: "x", verifiedAt: today(),
  decisionName: "", decisionTitle: "", decisionVerified: false, email: "", linkedin: "", phone: "", contactSource: "",
  signal: "", signalSource: "", signalDate: "", need: "", crit: {}, stage: "À qualifier", nextAction: "", nextDate: "",
  stripeSubId: "", stripeVerified: false, optOut: false, notes: "", segment: "", commsConsent: false, commsConsentDate: "",
  partnerStatus: "Identifié", partnerModel: "", conventionOk: false, partnerNotes: "", trialStart: "", trialEnd: "", engagementOk: false,
  offerPublished: false, offerDate: "", feedbackScore: null, feedbackNotes: "", referenceOk: false, campaignId: null, enrolledAt: "", campaignState: "",
  ...o,
});
const camp = (o: Partial<Campaign> = {}): Campaign => ({
  id: "c1", name: "C — Vente directe", segment: "C", goal: "", angle: "", cta: "", dailyCap: 20, status: "Validée", validatedAt: today(),
  steps: [{ day: 0, channel: "E-mail", template: "Bonjour {Prénom}" }, { day: 3, channel: "LinkedIn", template: "Relance" }], ...o,
});

describe("score", () => {
  it("pondère, distingue faits et hypothèses, calcule la priorité", () => {
    const p = base({ crit: { volume: { v: 3, b: "f" }, pertinence: { v: 2, b: "h" } }, signal: "Offre SDR", signalSource: "https://x", signalDate: today() });
    const s = scoreOf(p);
    expect(s.total).toBe(53); // 25 + 13,3 + 15
    expect(s.fact).toBe(40);
    expect(s.prio).toBe("B");
  });
  it("signal sans source = 0, ancien = 1, 31-90 j = 2", () => {
    expect(signalLevel({ signal: "x", signalSource: "", signalDate: today() })).toBe(0);
    expect(signalLevel({ signal: "x", signalSource: "s", signalDate: addDays(today(), -120) })).toBe(1);
    expect(signalLevel({ signal: "x", signalSource: "s", signalDate: addDays(today(), -60) })).toBe(2);
  });
});

describe("doublons", () => {
  it("même domaine ou même nom normalisé", () => {
    expect(normName("ACME SAS")).toBe("acme");
    const all = [base({ id: "a", company: "Acme", website: "https://www.acme.fr/careers" })];
    expect(findDuplicate({ company: "Autre", website: "acme.fr" }, all)?.id).toBe("a");
    expect(findDuplicate({ company: "acme sas", website: "" }, all)?.id).toBe("a");
    expect(findDuplicate({ company: "Acme", website: "" }, all, "a")).toBeUndefined();
  });
});

describe("séquence et campagne", () => {
  it("refuse de contacter une entreprise en opposition, exige l'objection", () => {
    expect(() => buildInteraction(base({ optOut: true }), "contact_email", "")).toThrow(RuleError);
    expect(() => buildInteraction(base(), "objection", "")).toThrow(/objection/);
  });
  it("inscription : campagne validée et segment compatible seulement", () => {
    expect(() => enroll(base({ segment: "C" }), camp({ status: "Brouillon" }))).toThrow(/validée/);
    expect(() => enroll(base({ segment: "A" }), camp())).toThrow(/segment/);
    expect(enroll(base({ segment: "C" }), camp()).nextAction).toBe("Étape 1/2 · E-mail — C — Vente directe");
  });
  it("l'étape suivante est datée depuis l'inscription ; une réponse arrête la séquence", () => {
    const c = camp();
    const p = base({ segment: "C", campaignId: "c1", enrolledAt: today(), campaignState: "En cours" });
    const ev = buildInteraction(p, "contact_email", "");
    const patch = patchAfter(p, [ev], ev, c);
    expect(patch.stage).toBe("Contact effectué");
    expect(patch.nextAction).toBe("Étape 2/2 · LinkedIn — C — Vente directe");
    expect(patch.nextDate).toBe(addDays(today(), 3));
    const rep = buildInteraction(p, "reponse", "");
    expect(patchAfter(p, [ev, rep], rep, c).campaignState).toBe("Arrêtée : réponse reçue");
  });
  it("séquence épuisée sans réponse : à recontacter dans 3 mois", () => {
    const c = camp();
    const p = base({ campaignId: "c1", enrolledAt: today(), campaignState: "En cours" });
    const h: Interaction[] = [0, 1, 2].map(() => buildInteraction(p, "contact_email", ""));
    const patch = patchAfter(p, h, h[2], c);
    expect(patch.campaignState).toBe("Terminée sans réponse");
    expect(patch.stage).toBe("À recontacter");
  });
  it("une campagne validée modifiée repasse en brouillon", () => {
    const c = camp();
    expect(campaignStatusAfterEdit(c, { ...c, angle: "nouveau" })).toBe("Brouillon");
    expect(campaignStatusAfterEdit(c, { ...c })).toBe("Validée");
  });
  it("modèle : refuse d'envoyer un message à trous", () => {
    expect(fillTemplate("Bonjour {Prénom}", { Prénom: "Léa" })).toBe("Bonjour Léa");
    expect(() => fillTemplate("Bonjour {Prénom}, {signal}", { Prénom: "Léa" })).toThrow(/signal/);
  });
});

describe("Founding Recruiters", () => {
  it("segment B, engagement écrit, 10 places maximum", () => {
    expect(() => startTrial(base({ segment: "C", engagementOk: true }), [])).toThrow(/segment B/);
    expect(() => startTrial(base({ segment: "B" }), [])).toThrow(/Engagement/);
    const full = Array.from({ length: 10 }, (_, i) => base({ id: "x" + i, trialStart: today() }));
    expect(() => startTrial(base({ segment: "B", engagementOk: true }), full)).toThrow(/10 places/);
    const r = startTrial(base({ segment: "B", engagementOk: true }), [], "2026-11-02");
    expect(r.trialEnd).toBe("2026-12-17");
    expect(r.stage).toBe("Essai Founding en cours");
  });
  it("échéances", () => {
    const p = base({ segment: "B", trialStart: addDays(today(), -15) });
    const labels = foundingAlerts([p]).map((a) => a.label);
    expect(labels).toContain("Point de mi-parcours (J+15)");
    expect(labels.some((l) => l.includes("offre pas encore publiée"))).toBe(true);
  });
});

describe("validation, contenus, performances", () => {
  it("file à valider et accord obligatoire pour citer une entreprise", () => {
    const items = pendingValidation([{ ...base(), drafts: { by: "modele", generatedAt: today() } }], [camp({ status: "Brouillon" })], []);
    expect(items.map((i) => i.kind)).toEqual(["campaign", "drafts"]);
    expect(canApproveContent({ prospectId: "p1", status: "Validé" }, [{ id: "p1", commsConsent: false }])).toBe(false);
    expect(canApproveContent({ prospectId: "", status: "Validé" }, [])).toBe(true);
  });
  it("aucune suggestion qui cite une entreprise sans accord", () => {
    const withConsent = base({ id: "b", segment: "B", trialStart: today(), commsConsent: true });
    const noConsent = base({ id: "c", segment: "B", trialStart: today() });
    const s = contentSuggestions([withConsent, noConsent], [], [["Prix / budget", 2]]);
    expect(s.map((x) => x.prospectId)).toEqual(["b", null]);
  });
  it("performance par canal et objections", () => {
    const p = base();
    const h = new Map([["p1", [buildInteraction(p, "contact_email", ""), buildInteraction(p, "reponse", ""), { ...buildInteraction(p, "objection", "", "Prix / budget") }]]]);
    const rows = perfBy([p], h, (_, f) => f.channel || "?");
    expect(rows[0]).toMatchObject({ key: "E-mail", contacted: 1, replied: 1, rate: 1 });
    expect(objectionCounts(h)).toEqual([["Prix / budget", 1]]);
  });
});
