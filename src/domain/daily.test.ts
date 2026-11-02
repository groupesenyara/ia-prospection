import { describe, expect, it } from "vitest";
import { addDays, today } from "./dates.js";
import { dailyPlan, splitSubject } from "./daily.js";
import type { Campaign, Prospect } from "./types.js";

const p = (o: Partial<Prospect>): Prospect => ({
  id: "p", company: "Acme", website: "", sector: "", size: "", kind: "", roles: "SDR, AE", source: "x", verifiedAt: today(),
  decisionName: "Léa Martin", decisionTitle: "CEO", decisionVerified: true, email: "lea@acme.fr", linkedin: "", phone: "", contactSource: "site",
  signal: "offre SDR", signalSource: "s", signalDate: today(), need: "", crit: {}, stage: "Contact effectué", nextAction: "", nextDate: "",
  stripeSubId: "", stripeVerified: false, optOut: false, notes: "", segment: "C", commsConsent: false, commsConsentDate: "", partnerStatus: "",
  partnerModel: "", conventionOk: false, partnerNotes: "", trialStart: "", trialEnd: "", engagementOk: false, offerPublished: false, offerDate: "",
  feedbackScore: null, feedbackNotes: "", referenceOk: false, campaignId: "c", enrolledAt: today(), campaignState: "En cours", ...o,
});
const c: Campaign = { id: "c", name: "C", segment: "C", goal: "", angle: "", cta: "", dailyCap: 2, status: "Validée", validatedAt: today(),
  steps: [{ day: 0, channel: "E-mail", template: "Objet : votre offre {intitulé}\n\nBonjour {Prénom}, {signal}." }, { day: 3, channel: "E-mail", template: "Relance {Prénom}" }] };

describe("préparation quotidienne", () => {
  it("prépare l'étape du jour, remplit les variables, sépare l'objet", () => {
    const plan = dailyPlan([p({})], [c], new Map(), new Set());
    expect(plan.drafts).toEqual([{ prospectId: "p", campaignId: "c", stepIndex: 0, channel: "E-mail", subject: "votre offre SDR", body: "Bonjour Léa, offre SDR." }]);
  });
  it("respecte le jour de l'étape, la file existante, le plafond et l'opposition", () => {
    const h = new Map([["p", [{ prospectId: "p", at: "", day: today(), type: "contact_email" as const, note: "", campaignId: "c" }]]]);
    expect(dailyPlan([p({})], [c], h, new Set()).drafts).toHaveLength(0); // étape 2 à J+3
    expect(dailyPlan([p({ enrolledAt: addDays(today(), -3) })], [c], h, new Set()).drafts).toHaveLength(1);
    expect(dailyPlan([p({})], [c], new Map(), new Set(["p|c|0"])).drafts).toHaveLength(0);
    const many = ["a", "b", "d"].map((id) => p({ id }));
    const plan = dailyPlan(many, [c], new Map(), new Set());
    expect(plan.drafts).toHaveLength(2);
    expect(plan.skipped[0].reason).toMatch(/plafond/);
    expect(dailyPlan([p({ optOut: true })], [c], new Map(), new Set()).skipped[0].reason).toBe("opposition");
  });
  it("n'envoie rien pour une campagne non validée, ni un message à trous", () => {
    expect(dailyPlan([p({})], [{ ...c, status: "Brouillon" }], new Map(), new Set()).drafts).toHaveLength(0);
    const r = dailyPlan([p({ decisionVerified: false })], [c], new Map(), new Set());
    expect(r.drafts).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/Prénom/);
    expect(dailyPlan([p({ email: "" })], [c], new Map(), new Set()).skipped[0].reason).toMatch(/e-mail/);
  });
  it("objet facultatif", () => {
    expect(splitSubject("Bonjour")).toEqual({ subject: "", body: "Bonjour" });
  });
});
