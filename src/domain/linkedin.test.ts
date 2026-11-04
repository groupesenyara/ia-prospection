import { describe, expect, it } from "vitest";
import { linkedinNote, linkedinQueue, profileUrl } from "./linkedin.js";
import type { Interaction, Prospect } from "./types.js";

const p = (id: string, o: Partial<Prospect> & { drafts?: Record<string, unknown> } = {}) => ({
  id, company: `Société ${id}`, decisionName: "Claire Martin", decisionTitle: "Directrice commerciale", optOut: false, linkedin: "", signal: "Recrute 2 SDR", signalDate: "2026-11-01", crit: {},
  drafts: { unit: "swipsales", raw: "Accroche : x\nObjet : y\n\nBonjour\n\nLinkedIn : Bonjour Claire, j'ai vu vos offres de SDR. Échangeons ?\n\nAppel : …" },
  research: { primaryUnit: "swipsales", units: [{ unit: "swipsales", score: 70, offer: "", reason: "2 offres SDR", signal: "", signalSource: "" }] },
  ...o,
}) as unknown as Prospect & { drafts: Record<string, unknown> };
const ev = (prospectId: string, type: Interaction["type"], day: string): Interaction => ({ prospectId, type, day, at: day, note: "" });

describe("LinkedIn du jour", () => {
  it("note d'invitation reprise des brouillons de l'agent (texte ou JSON)", () => {
    expect(linkedinNote(p("a"))).toBe("Bonjour Claire, j'ai vu vos offres de SDR. Échangeons ?");
    expect(linkedinNote(p("b", { drafts: { raw: JSON.stringify({ linkedin: "Note JSON" }) } }))).toBe("Note JSON");
    expect(linkedinNote(p("c", { drafts: { raw: "Pas de note" } }))).toBe("");
  });
  it("profil direct s'il est connu, sinon recherche LinkedIn à ouvrir soi-même", () => {
    expect(profileUrl(p("a", { linkedin: "https://www.linkedin.com/in/claire-martin" }))).toEqual({ url: "https://www.linkedin.com/in/claire-martin", direct: true });
    expect(profileUrl(p("a")).url).toBe("https://www.linkedin.com/search/results/people/?keywords=Claire%20Martin%20Soci%C3%A9t%C3%A9%20a");
  });
  it("sélection : opposition, déjà invité, contact récent, autre pôle actif, sans décideur ou sans note sont exclus ; quota respecté", () => {
    const list = [
      p("ok1"), p("ok2", { research: { primaryUnit: "northreef", units: [{ unit: "northreef", score: 90, offer: "", reason: "Site daté", signal: "", signalSource: "" }] } as never, drafts: { unit: "northreef", raw: "LinkedIn : Bonjour, votre site…" } }),
      p("stop", { optOut: true }), p("invite"), p("recent"), p("other"), p("noboss", { decisionName: "" }), p("nonote", { drafts: { raw: "" } }),
    ];
    const history = new Map([["invite", [ev("invite", "contact_linkedin", "2026-10-01")]], ["recent", [ev("recent", "contact_email", "2026-11-04")]]]);
    const active = new Map([["other", "amandis"]]);
    const q = linkedinQueue(list, history, active, "2026-11-05");
    expect(q.map((t) => [t.prospect.id, t.unit])).toEqual([["ok2", "northreef"], ["ok1", "swipsales"]]);
    expect(linkedinQueue(list, history, active, "2026-11-05", 1)).toHaveLength(1);
  });
});
