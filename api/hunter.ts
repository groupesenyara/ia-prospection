// POST /api/hunter — Opportunity Hunter depuis l'interface (membre owner ou editor).
//   { action: "run" }                                  : passage de veille immédiat
//   { action: "add", source, url, text, buyer? }       : annonce collée (e-mail Malt, ComeUp, LinkedIn…)
//   { action: "analyse", id }                          : (ré)analyse et rédaction d'une annonce
//   { action: "toCrm", id }                            : crée ou retrouve la fiche entreprise et l'opportunité du pôle
//   { action: "pause", paused }                        : arrêt d'urgence (owner)
import { findDuplicate } from "../src/domain/dedup.js";
import type { HunterSource } from "../src/domain/hunter.js";
import { hunterDeps } from "./_lib/hunter-deps.js";
import { addManual, analyseOne, readConfig, runHunter } from "./_lib/hunter.js";
import { adminClient, json, teamUser } from "./_lib/server.js";

const SOURCES: HunterSource[] = ["malt", "comeup", "linkedin", "codeur", "boamp", "rss", "manuel"];

export async function POST(req: Request): Promise<Response> {
  const db = adminClient();
  const user = await teamUser(req, db);
  if (!user || user.role === "viewer") return json(403, { error: "Réservé aux membres de l’équipe" });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return json(400, { error: "JSON invalide" }); }
  const d = hunterDeps(db);
  try {
    if (b.action === "pause") {
      if (user.role !== "owner") return json(403, { error: "Seul Yannis déclenche ou lève l’arrêt d’urgence" });
      const { data } = await db.from("settings").select("value").eq("key", "hunter").maybeSingle();
      const cfg = { ...readConfig(data?.value), paused: b.paused === true };
      await db.from("settings").upsert({ key: "hunter", value: cfg });
      await d.store.log(cfg.paused ? "arrêt d'urgence" : "reprise", cfg.paused ? "veille suspendue par Yannis" : "veille relancée par Yannis");
      return json(200, cfg);
    }
    if (b.action === "run") {
      const report = await runHunter(d);
      await db.from("settings").upsert({ key: "hunter_report", value: report });
      return json(200, report);
    }
    if (b.action === "add") {
      const source = SOURCES.includes(b.source as HunterSource) ? (b.source as HunterSource) : "manuel";
      const text = String(b.text || "").trim();
      if (text.length < 30) return json(400, { error: "Collez le texte complet de l’annonce (30 caractères au moins)" });
      const url = String(b.url || "").trim();
      if (url && !/^https?:\/\//.test(url)) return json(400, { error: "Adresse invalide" });
      const r = await addManual(d, { source, url, text, buyer: String(b.buyer || "") });
      return r.duplicate ? json(409, { error: "Annonce déjà enregistrée" }) : json(200, r);
    }
    if (b.action === "analyse" || b.action === "toCrm") {
      const { data: row } = await db.from("hunter_items").select("*").eq("id", String(b.id)).maybeSingle();
      if (!row) return json(404, { error: "Annonce introuvable" });
      if (b.action === "analyse") {
        if ((await d.store.config()).paused) return json(409, { error: "Arrêt d’urgence actif" });
        if (!d.analyse) return json(503, { error: "IA désactivée" });
        if (row.send_status !== "non envoyée") return json(409, { error: "Proposition déjà envoyée" });
        await analyseOne(d, row.id, { source: row.source, externalId: row.external_id, url: row.url, title: row.title, description: row.description, buyer: row.buyer, publishedAt: row.published_at || "", deadline: row.deadline || "", budgetMin: row.budget_min, budgetMax: row.budget_max, budgetText: row.budget_text }, await d.store.facts());
        return json(200, { ok: true });
      }
      // Rattachement au CRM unique : une fiche par entreprise (pas de doublon), une opportunité ouverte par pôle
      if (!row.unit) return json(409, { error: "Aucun pôle retenu pour cette annonce" });
      if (row.prospect_id && row.opportunity_id) return json(200, { prospectId: row.prospect_id, opportunityId: row.opportunity_id });
      const company = String(row.buyer || "").trim() || `Client ${row.source} : ${String(row.title).slice(0, 60)}`;
      const { data: all } = await db.from("prospects").select("id,company,website");
      let prospectId = findDuplicate({ company, website: "" }, (all || []) as { id: string; company: string; website: string }[])?.id as string | undefined;
      if (!prospectId) {
        const { data: p, error } = await db.from("prospects").insert({ company, source: row.url || `Opportunity Hunter (${row.source})`, origin: `hunter_${row.source}`, assigned_by: "orchestrateur", stage: "Entreprise identifiée", signal: String(row.title).slice(0, 200), signal_source: row.url || "", signal_date: row.published_at }).select("id").single();
        if (error) return json(400, { error: error.message });
        prospectId = p.id as string;
      }
      const value = row.budget_max ?? row.budget_min ?? null;
      const { data: existing } = await db.from("opportunities").select("id").eq("prospect_id", prospectId).eq("unit", row.unit).in("status", ["ouverte", "en attente"]).maybeSingle();
      const fields = { score: row.score, offer: row.service_type, reason: `Annonce ${row.source} : ${String(row.title).slice(0, 150)}`, signal: String(row.title).slice(0, 200), signal_source: row.url || "", signal_date: row.published_at, value_estimate: value, next_action: row.follow_up_date ? "Relance de la proposition" : "", next_date: row.follow_up_date };
      const opp = existing
        ? await db.from("opportunities").update(fields).eq("id", existing.id).select("id").single()
        : await db.from("opportunities").insert({ prospect_id: prospectId, unit: row.unit, stage: "Besoin qualifié", ...fields }).select("id").single();
      if (opp.error) return json(400, { error: opp.error.message });
      await db.from("hunter_items").update({ prospect_id: prospectId, opportunity_id: opp.data.id }).eq("id", row.id);
      await d.store.log("ajout au CRM", company, row.id);
      return json(200, { prospectId, opportunityId: opp.data.id });
    }
    return json(400, { error: "Action inconnue" });
  } catch (e) {
    console.error("[hunter]", e);
    return json(500, { error: (e as Error).message.slice(0, 200) });
  }
}
