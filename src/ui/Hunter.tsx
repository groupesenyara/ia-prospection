// Opportunity Hunter : veille des demandes de prestations publiées, analyse, propositions à valider, suivi et performances.
import { useCallback, useEffect, useMemo, useState } from "react";
import { checkClaims, type ClaimIssue, type ConfirmedFact } from "../domain/claims";
import { frDate, today } from "../domain/dates";
import { hunterStats, PLATFORMS, type HunterItem, type HunterSource } from "../domain/hunter";
import { UNIT_IDS, UNITS, type UnitId } from "../domain/units";
import { fromRow } from "../lib/mapping";
import { api, supabase } from "../lib/supabase";
import type { Data } from "../lib/useData";
import { Empty, Kpi } from "./common";

type P = { data: Data; open: (id: string | null) => void; notify: (m: string) => void; isOwner: boolean };
type Cfg = { mode: "surveillance" | "assiste"; paused: boolean; dailyLimit: number; boamp: boolean; feeds: { source: HunterSource; url: string }[] };
type Report = { at: string; collected: number; relevant: number; added: number; analysed: number; drafted: number; errors: string[]; usd: number; note?: string; paused?: boolean };

const PRIOS = ["très élevée", "élevée", "à étudier", "à analyser", "non pertinente"] as const;
const PRIO_CLASS: Record<string, string> = { "très élevée": "g-won", "élevée": "g-eng", "à étudier": "g-out", "à analyser": "g-early", "non pertinente": "g-lost" };
const OUTCOMES = ["en cours", "réponse", "rendez-vous", "gagné", "perdu", "sans suite"] as const;
const eur = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €");
const budgetOf = (i: HunterItem) => i.budgetText || (i.budgetMin != null || i.budgetMax != null ? [eur(i.budgetMin), eur(i.budgetMax)].filter(Boolean).join(" à ") : "non précisé");
const toItem = (r: Record<string, unknown>) => {
  const x = fromRow<HunterItem>(r);
  return { ...x, budgetMin: r.budget_min == null ? null : Number(r.budget_min), budgetMax: r.budget_max == null ? null : Number(r.budget_max), wonAmount: r.won_amount == null ? null : Number(r.won_amount), proposalIssues: (r.proposal_issues as ClaimIssue[]) || [], publishedAt: String(r.published_at || ""), deadline: String(r.deadline || ""), followUpDate: String(r.follow_up_date || "") };
};

export function Hunter({ data, open, notify, isOwner }: P) {
  const [items, setItems] = useState<HunterItem[]>([]);
  const [log, setLog] = useState<{ at: string; action: string; detail: string }[]>([]);
  const [facts, setFacts] = useState<Partial<Record<UnitId, ConfirmedFact[]>>>({});
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ prio: "pertinentes", unit: "all", source: "all", budget: "", q: "" });
  const [add, setAdd] = useState({ source: "malt" as HunterSource, url: "", buyer: "", text: "" });
  const cfg: Cfg = { mode: "assiste", paused: false, dailyLimit: 30, boamp: true, feeds: [], ...(data.settings.hunter as Partial<Cfg> | undefined) };
  const report = data.settings.hunter_report as Report | undefined;

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      supabase.from("hunter_items").select("*").order("detected_at", { ascending: false }).limit(500),
      supabase.from("hunter_log").select("at,action,detail").order("at", { ascending: false }).limit(30),
    ]);
    if (h.error) return notify(h.error.message);
    setItems((h.data || []).map(toItem));
    setLog((l.data || []) as typeof log);
  }, [notify]);
  useEffect(() => {
    supabase.from("unit_facts").select("unit,kind,text").eq("status", "Confirmé").then(({ data: rows }) => {
      const out: Partial<Record<UnitId, ConfirmedFact[]>> = {};
      for (const r of (rows || []) as { unit: UnitId; kind: ConfirmedFact["kind"]; text: string }[]) (out[r.unit] ||= []).push({ kind: r.kind, text: r.text });
      setFacts(out);
    });
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel("hunter").on("postgres_changes", { event: "*", schema: "public", table: "hunter_items" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try { await fn(); notify(ok); } catch (e) { notify((e as Error).message); } finally { setBusy(""); await load(); await data.reload(); }
  };
  const patch = (id: string, p: Record<string, unknown>, ok: string) => run(id, async () => { const { error } = await supabase.from("hunter_items").update(p).eq("id", id); if (error) throw new Error(error.message); }, ok);
  const saveCfg = (p: Partial<Cfg>) => run("cfg", async () => { const { error } = await supabase.from("settings").upsert({ key: "hunter", value: { ...cfg, ...p } }); if (error) throw new Error(error.message); }, "Réglages enregistrés");

  const stats = useMemo(() => hunterStats(items, today()), [items]);
  const list = items.filter((i) =>
    (f.prio === "all" || (f.prio === "pertinentes" ? i.priority !== "non pertinente" : i.priority === f.prio)) &&
    (f.unit === "all" || i.unit === f.unit) && (f.source === "all" || i.source === f.source) &&
    (!f.budget || (i.budgetMax ?? i.budgetMin ?? 0) >= Number(f.budget)) &&
    (!f.q || `${i.title} ${i.sector} ${i.serviceType} ${i.buyer}`.toLowerCase().includes(f.q.toLowerCase())))
    .sort((a, b) => PRIOS.indexOf(a.priority as (typeof PRIOS)[number]) - PRIOS.indexOf(b.priority as (typeof PRIOS)[number]) || (b.score ?? -1) - (a.score ?? -1));
  const current = items.find((i) => i.id === sel) || null;

  return (
    <section className="view">
      <div className="row between"><h2>Opportunity Hunter</h2>
        <div className="row">
          <button className="btn" disabled={!!busy || cfg.paused} onClick={() => run("run", () => api("/api/hunter", { action: "run" }), "Veille terminée")}>{busy === "run" ? "Veille en cours (jusqu’à 5 min)…" : "Lancer la veille maintenant"}</button>
          {isOwner && <button className={`btn ${cfg.paused ? "primary" : ""}`} disabled={!!busy} onClick={() => run("pause", () => api("/api/hunter", { action: "pause", paused: !cfg.paused }), cfg.paused ? "Veille relancée" : "Arrêt d’urgence activé")}>{cfg.paused ? "Lever l’arrêt d’urgence" : "Arrêt d’urgence"}</button>}
        </div>
      </div>
      {cfg.paused && <div className="notice"><b>Arrêt d’urgence actif :</b> aucune veille, aucune analyse, aucun ajout.</div>}
      {report && <div className="notice info small"><b>Dernier passage · {frDate(report.at.slice(0, 10))} {report.at.slice(11, 16)} UTC</b> — {report.collected} annonces lues, {report.relevant} dans notre périmètre, {report.added} nouvelles, {report.analysed} analysées, {report.drafted} propositions rédigées{report.usd ? `, environ ${report.usd.toLocaleString("fr-FR")} $` : ""}.{report.note ? ` ${report.note}.` : ""}{report.errors?.length ? ` Sources en erreur : ${report.errors.join(" ; ")}` : ""}</div>}

      <div className="kpis">
        <Kpi label="Nouvelles (aujourd’hui)" value={stats.fresh} formula="détectées aujourd’hui, hors non pertinentes" source="Veille" />
        <Kpi label="Forte valeur" value={stats.highValue} formula="priorité très élevée ou budget ≥ 5 000 €" source="Analyse" />
        <Kpi label="À valider" value={stats.toValidate} formula="propositions rédigées, en attente de Yannis" source="Hunter" />
        <Kpi label="Envoyées" value={stats.sent} formula="propositions envoyées sur la plateforme" source="Hunter" />
        <Kpi label="Réponses · RDV · gagnés" value={`${stats.replies} · ${stats.meetings} · ${stats.won}`} formula="résultat commercial saisi" source="Hunter" />
        <Kpi label="CA potentiel" value={eur(stats.potential) || "0 €"} formula={`budget × probabilité du résultat · gagné : ${eur(stats.wonAmount) || "0 €"}`} source="Hunter" />
      </div>

      <div className="grid2">
        <div className="panel"><h3>Réglages</h3>
          <div className="fgrid">
            <label className="f">Mode<select value={cfg.mode} disabled={!isOwner} onChange={(e) => saveCfg({ mode: e.target.value as Cfg["mode"] })}>
              <option value="surveillance">Surveillance : détecter et enregistrer</option>
              <option value="assiste">Assisté : détecter, qualifier, rédiger, soumettre à validation</option>
              <option value="automatique" disabled>Automatique : indisponible (aucune plateforme ne l’autorise)</option>
            </select></label>
            <label className="f">Analyses IA par jour<input type="number" min={0} max={200} value={cfg.dailyLimit} disabled={!isOwner} onChange={(e) => saveCfg({ dailyLimit: Number(e.target.value) })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={cfg.boamp} disabled={!isOwner} onChange={(e) => saveCfg({ boamp: e.target.checked })} /> Marchés publics (BOAMP)</label>
          <p className="small muted">Flux RSS suivis : {cfg.feeds.length ? cfg.feeds.map((x) => x.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)).join(" · ") : "les flux Codeur.com par défaut (site, e-commerce, application, logiciel, automatisation, agent IA, formation)"}.</p>
          <details className="small"><summary>Plateformes : ce qui est possible</summary><ul>{Object.entries(PLATFORMS).map(([k, p]) => <li key={k}><b>{p.name}</b> : {p.integration}</li>)}</ul></details>
        </div>
        <div className="panel"><h3>Ajouter une annonce reçue (Malt, ComeUp, LinkedIn…)</h3>
          <div className="fgrid">
            <label className="f">Plateforme<select value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value as HunterSource })}>{(["malt", "comeup", "linkedin", "codeur", "manuel"] as HunterSource[]).map((s) => <option key={s} value={s}>{PLATFORMS[s].name}</option>)}</select></label>
            <label className="f">Adresse de l’annonce<input type="url" value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} /></label>
            <label className="f">Entreprise (si connue)<input value={add.buyer} onChange={(e) => setAdd({ ...add, buyer: e.target.value })} /></label>
          </div>
          <textarea rows={4} placeholder="Collez le texte complet de l’annonce ou de l’e-mail de notification" value={add.text} onChange={(e) => setAdd({ ...add, text: e.target.value })} />
          <div className="row"><button className="btn primary" disabled={!!busy || cfg.paused || add.text.trim().length < 30} onClick={() => run("add", async () => { await api("/api/hunter", { action: "add", ...add }); setAdd({ ...add, url: "", buyer: "", text: "" }); }, "Annonce enregistrée et analysée")}>{busy === "add" ? "Analyse…" : "Analyser"}</button></div>
        </div>
      </div>

      <div className="fgrid">
        <label className="f">Priorité<select value={f.prio} onChange={(e) => setF({ ...f, prio: e.target.value })}><option value="pertinentes">Pertinentes</option><option value="all">Toutes</option>{PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label className="f">Pôle<select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="all">Tous</option>{UNIT_IDS.map((u) => <option key={u} value={u}>{UNITS[u].name}</option>)}</select></label>
        <label className="f">Plateforme<select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="all">Toutes</option>{Object.entries(PLATFORMS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}</select></label>
        <label className="f">Budget minimum (€)<input type="number" min={0} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></label>
        <label className="f">Secteur ou prestation<input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
      </div>

      <div className="panel"><div className="list">{list.length ? list.map((i) => (
        <div key={i.id} className={`item${sel === i.id ? " active" : ""}`} role="button" tabIndex={0} onClick={() => setSel(sel === i.id ? null : i.id)} onKeyDown={(e) => e.key === "Enter" && setSel(sel === i.id ? null : i.id)}>
          <div className="t">{i.title}</div>
          <div className="r"><span className={`pill ${PRIO_CLASS[i.priority] || "g-early"}`}>{i.priority}{i.score != null ? ` · ${i.score}` : ""}</span></div>
          <div className="s">
            <span className="tag">{PLATFORMS[i.source]?.name || i.source}</span>
            {i.unit && <span className="tag">{UNITS[i.unit as UnitId]?.name}</span>}
            {i.buyer && <span>{i.buyer}</span>}<span>{budgetOf(i)}</span>
            {i.deadline && <span className={i.deadline < today() ? "late" : ""}>réponse avant le {frDate(i.deadline)}</span>}
            <span>{i.validation}{i.sendStatus !== "non envoyée" ? " · envoyée" : ""}{i.outcome !== "en cours" ? ` · ${i.outcome}` : ""}</span>
          </div>
        </div>
      )) : <Empty title="Aucune annonce" text={cfg.paused ? "Arrêt d’urgence actif." : "Lancez la veille, ou collez une annonce reçue par e-mail."} />}</div></div>

      {current && <Detail i={current} facts={current.unit ? facts[current.unit as UnitId] || [] : []} isOwner={isOwner} busy={busy} patch={patch} run={run} open={open} />}

      <div className="grid2">
        <PerfTable title="Performances par plateforme" rows={stats.bySource} />
        <PerfTable title="Performances par pôle" rows={stats.byUnit} />
      </div>
      <div className="panel"><h3>Journal des actions</h3><div className="hist">{log.length ? log.map((l, k) => <div key={k}><span className="mono small muted">{frDate(l.at.slice(0, 10))} {l.at.slice(11, 16)}</span><span><b>{l.action}</b>{l.detail ? ` — ${l.detail}` : ""}</span></div>) : <span className="small muted">Aucune action.</span>}</div></div>
    </section>
  );
}

function PerfTable({ title, rows }: { title: string; rows: { key: string; items: number; relevant: number; sent: number; replies: number; won: number }[] }) {
  return (
    <div className="panel"><h3>{title}</h3>{rows.length ? (
      <table className="tbl"><thead><tr><th></th><th>Annonces</th><th>Pertinentes</th><th>Envoyées</th><th>Réponses</th><th>Gagnées</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td>{r.items}</td><td>{r.relevant}</td><td>{r.sent}</td><td>{r.replies}</td><td>{r.won}</td></tr>)}</tbody></table>
    ) : <p className="small muted">Pas encore de données.</p>}</div>
  );
}

function Detail({ i, facts, isOwner, busy, patch, run, open }: { i: HunterItem; facts: ConfirmedFact[]; isOwner: boolean; busy: string; patch: (id: string, p: Record<string, unknown>, ok: string) => Promise<void>; run: (l: string, fn: () => Promise<unknown>, ok: string) => Promise<void>; open: (id: string | null) => void }) {
  const [text, setText] = useState(i.proposal);
  useEffect(() => setText(i.proposal), [i.id, i.proposal]);
  const a = i.analysis as Record<string, unknown>;
  const issues = i.proposalIssues || [];
  const sent = i.sendStatus !== "non envoyée";
  const L = (label: string, v: unknown) => (v && (!Array.isArray(v) || v.length) ? <li><b>{label}</b> : {Array.isArray(v) ? v.join(" ; ") : String(v)}</li> : null);
  return (
    <div className="panel dossier">
      <div className="row between"><h3>{i.title}</h3>{i.url && <a className="btn sm" href={i.url} target="_blank" rel="noreferrer">Ouvrir l’annonce</a>}</div>
      <p className="small muted">{PLATFORMS[i.source]?.name} · publiée le {frDate(i.publishedAt) || "?"} · détectée le {frDate(i.detectedAt.slice(0, 10))}{i.buyer ? ` · ${i.buyer}` : ""} · budget : {budgetOf(i)}</p>
      {a.filtre ? <p className="small muted">Écartée : {String(a.filtre)}</p> : (
        <ul>
          {L("Besoin", a.besoin)}{L("Prestation", i.serviceType)}{L("Secteur", i.sector)}{L("Client", a.profilClient)}{L("Délai", a.delai)}{L("Complexité", a.complexite)}
          {L("Technologies", a.technologies)}{L("Concurrence", a.concurrence)}{L("Alertes", a.alertes)}{L("Budget proposé", a.budgetPropose)}{L("Hypothèses", a.hypotheses)}
          {a.notes ? <li><b>Notes /10</b> : {Object.entries(a.notes as Record<string, number>).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(" · ")}</li> : null}
          {L("Référence proposée", i.reference)}{L("Erreur", a.erreur)}
        </ul>
      )}
      <h4>Proposition {i.validation !== "à rédiger" ? `· ${i.validation}` : ""}{sent ? ` · envoyée le ${frDate(i.sentAt?.slice(0, 10))}` : ""}</h4>
      {!!issues.length && <div className="notice"><b>À vérifier : validation bloquée.</b><ul>{issues.map((x, k) => <li key={k}>{x.hint} : « {x.excerpt} »</li>)}</ul></div>}
      <textarea rows={10} value={text} disabled={sent} onChange={(e) => setText(e.target.value)} placeholder="Pas encore de proposition : lancez l’analyse." />
      <div className="row">
        {!sent && <button className="btn sm" disabled={!!busy} onClick={() => run(i.id, () => api("/api/hunter", { action: "analyse", id: i.id }), "Analyse et proposition mises à jour")}>{i.proposal ? "Réanalyser et réécrire" : "Analyser et rédiger"}</button>}
        {!sent && text !== i.proposal && <button className="btn sm" disabled={!!busy} onClick={() => patch(i.id, { proposal: text, proposal_issues: checkClaims(text, facts), validation: "à valider" }, "Proposition modifiée : à valider")}>Enregistrer la modification</button>}
        {isOwner && !sent && i.validation === "à valider" && text === i.proposal && <button className="btn sm primary" disabled={!!busy || !!issues.length} title={issues.length ? "Corrigez les affirmations signalées" : ""} onClick={() => patch(i.id, { validation: "validée" }, "Proposition validée")}>Valider</button>}
        {!sent && i.validation !== "rejetée" && <button className="btn sm" disabled={!!busy} onClick={() => patch(i.id, { validation: "rejetée" }, "Annonce écartée")}>Écarter</button>}
        {i.proposal && <button className="btn sm" onClick={() => navigator.clipboard?.writeText(i.proposal)}>Copier</button>}
        {i.validation === "validée" && !sent && <button className="btn sm primary" disabled={!!busy} onClick={() => patch(i.id, { send_status: "envoyée manuellement", follow_up_date: i.followUpDate || null }, "Marquée envoyée")}>J’ai envoyé la proposition</button>}
        {i.unit && <button className="btn sm" disabled={!!busy} onClick={() => run(i.id, async () => { const r = await api<{ prospectId: string }>("/api/hunter", { action: "toCrm", id: i.id }); open(r.prospectId); }, "Fiche et opportunité dans le CRM")}>{i.prospectId ? "Voir dans le CRM" : "Ajouter au CRM"}</button>}
      </div>
      {sent && (
        <div className="fgrid">
          <label className="f">Résultat<select value={i.outcome} onChange={(e) => patch(i.id, { outcome: e.target.value }, "Résultat enregistré")}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="f">Relance le<input type="date" value={i.followUpDate} onChange={(e) => patch(i.id, { follow_up_date: e.target.value || null }, "Relance planifiée")} /></label>
          {i.outcome === "gagné" && <label className="f">Montant signé (€)<input type="number" min={0} defaultValue={i.wonAmount ?? ""} onBlur={(e) => patch(i.id, { won_amount: e.target.value ? Number(e.target.value) : null }, "Montant enregistré")} /></label>}
        </div>
      )}
      <p className="small muted">Envoi : toujours fait par vous, sur la plateforme. L’envoi automatique reste désactivé tant qu’aucune plateforme ne l’autorise officiellement.</p>
    </div>
  );
}
