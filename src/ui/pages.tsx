// Les espaces de pilotage. Le prototype complet (prototype/swipsales-growth.html) sert de référence pour les détails.
import { useMemo, useState } from "react";
import { CHANNELS, FOUNDING_SEATS, PARTNER_KINDS, SEGMENT_LABEL } from "../domain/constants";
import { daysBetween, frDate, today } from "../domain/dates";
import { foundingAlerts } from "../domain/founding";
import { isSignificant, objectionCounts, perfBy } from "../domain/performance";
import { contentSuggestions } from "../domain/suggestions";
import type { Campaign, CampaignStep, ContentItem } from "../domain/types";
import { canApproveContent, pendingValidation } from "../domain/validation";
import { downloadCsv } from "../lib/csv";
import { api } from "../lib/supabase";
import type { Data } from "../lib/useData";
import { Empty, Kpi, pct, ProspectItem } from "./common";

type P = { data: Data; open: (id: string | null) => void; notify: (m: string) => void; isOwner: boolean };

export function Today({ data, open }: P) {
  const t = today();
  const due = data.prospects.filter((p) => !p.optOut && p.nextDate && p.nextDate <= t).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const pending = pendingValidation(data.prospects as never, data.campaigns, data.content);
  const report = data.settings.daily_report as { at?: string; drafts?: number; skipped?: { reason: string }[] } | undefined;
  return (
    <section className="view">
      <div className="kpis">
        <Kpi label="Actions dues" value={due.length} formula="date de prochaine action ≤ aujourd’hui" source="CRM" />
        <Kpi label="À valider" value={pending.length + data.outbox.filter((o) => o.status === "À valider").length} formula="campagnes, messages, envois, publications" source="CRM" />
        <Kpi label="Dernière préparation" value={report?.at ? frDate(report.at.slice(0, 10)) : "—"} formula={report ? `${report.drafts} brouillons, ${report.skipped?.length || 0} ignorés` : "tâche quotidienne non lancée"} source="Agent" />
      </div>
      <div className="grid2">
        <div className="panel"><h2>Relances et actions dues</h2><div className="list">{due.length ? due.map((p) => <ProspectItem key={p.id} p={p} onOpen={open} />) : <Empty title="Rien d’urgent" />}</div></div>
        <div className="panel"><h2>À valider par Yannis</h2><div className="list">{pending.length ? pending.map((i) => <div key={i.kind + i.id} className="item" onClick={() => i.kind === "drafts" || i.kind === "convention" ? open(i.id) : undefined}><div className="t">{i.title}</div><div className="r"><span className="pill g-risk">À valider</span></div><div className="s">{i.detail}</div></div>) : <Empty title="Rien à valider" />}</div></div>
      </div>
    </section>
  );
}

type ProspectingReport = { at: string; seconds: number; discovery: { offers: number; companies: number; added: string[]; skipped: Record<string, number>; note?: string }; enrichment: { done: string[]; failed: string[]; left: number; note?: string } };

export function Crm({ data, open, notify, isOwner }: P) {
  const [q, setQ] = useState(""); const [seg, setSeg] = useState("all"); const [rs, setRs] = useState("all"); const [busy, setBusy] = useState(false);
  const list = data.prospects.filter((p) =>
    (seg === "all" || (p.segment || "") === seg) &&
    (rs === "all" || (rs === "agent" ? p.origin === "france_travail" : rs === "contact" ? !!(p.email || p.phone) : (p.researchStatus || "") === rs)) &&
    (!q || `${p.company} ${p.roles} ${p.sector} ${p.city || ""} ${p.decisionName}`.toLowerCase().includes(q.toLowerCase())));
  const report = data.settings.prospecting_report as ProspectingReport | undefined;
  async function runAgent() {
    setBusy(true);
    try { const r = await api<ProspectingReport>("/api/research", { run: true }); await data.reload(); notify(`Agent : ${r.discovery.added.length} entreprise(s) ajoutée(s), ${r.enrichment.done.length} dossier(s) complété(s)`); }
    catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="view">
      <div className="row between"><h2>Prospection et CRM</h2>
        <div className="row">
          <button className="btn" onClick={() => downloadCsv(list, `crm-swipsales-${today()}.csv`)} disabled={!list.length}>Exporter ({list.length}) en CSV</button>
          {isOwner && <button className="btn" disabled={busy} onClick={runAgent}>{busy ? "Agent en cours (jusqu’à 5 min)…" : "Lancer l’agent maintenant"}</button>}
          <button className="btn primary" onClick={() => open(null)}>+ Ajouter une entreprise</button>
        </div>
      </div>
      {report && (
        <div className="notice info small"><b>Agent de prospection · {frDate(report.at.slice(0, 10))}</b> — {report.discovery.note || `${report.discovery.offers} offres commerciales lues, ${report.discovery.companies} entreprises, ${report.discovery.added.length} ajoutée(s)${Object.keys(report.discovery.skipped).length ? ` (écartées : ${Object.entries(report.discovery.skipped).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}`}. Recherche : {report.enrichment.note || `${report.enrichment.done.length} dossier(s) complété(s), ${report.enrichment.failed.length} en échec`}.</div>
      )}
      <div className="fgrid">
        <label className="f">Rechercher<input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="f">Segment<select value={seg} onChange={(e) => setSeg(e.target.value)}><option value="all">Tous</option>{Object.entries(SEGMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Dossier<select value={rs} onChange={(e) => setRs(e.target.value)}>
          <option value="all">Tous</option><option value="agent">Trouvées par l’agent</option><option value="contact">Avec e-mail ou téléphone</option>
          <option value="à rechercher">À rechercher</option><option value="fait">Recherche faite</option><option value="échec">Recherche en échec</option>
        </select></label>
      </div>
      <div className="panel"><div className="list">{list.length ? list.map((p) => <ProspectItem key={p.id} p={p} onOpen={open} extra={<>{p.city && <span>{p.city}</span>}{p.researchStatus === "fait" && <span className="tag fact">Dossier sourcé</span>}{p.researchStatus === "à rechercher" && <span className="tag">À rechercher</span>}</>} />) : <Empty title="Aucune entreprise" text="Ajoutez une entreprise avec la source qui prouve son besoin, ou lancez l’agent." />}</div></div>
    </section>
  );
}

export function Partners({ data, open }: P) {
  const list = data.prospects.filter((p) => p.segment === "A" || (!p.segment && PARTNER_KINDS.includes(p.kind)));
  return (
    <section className="view"><h2>Partenariats</h2>
      <div className="panel"><div className="list">{list.length ? list.map((p) => <ProspectItem key={p.id} p={p} onOpen={open} extra={<><span className="tag">{p.kind}</span><span className="tag">{p.partnerStatus}</span></>} />) : <Empty title="Aucun partenaire" text="Passez une fiche en segment A." />}</div></div>
    </section>
  );
}

export function Founding({ data, open }: P) {
  const list = data.prospects.filter((p) => p.segment === "B");
  const alerts = foundingAlerts(list);
  const t = today();
  return (
    <section className="view"><h2>Founding Recruiters</h2>
      <div className="kpis">
        <Kpi label="Places utilisées" value={`${list.filter((p) => p.trialStart).length} / ${FOUNDING_SEATS}`} source="CRM" />
        <Kpi label="Offres publiées" value={list.filter((p) => p.offerPublished).length} source="CRM" />
        <Kpi label="Références possibles" value={list.filter((p) => p.referenceOk).length} source="CRM" />
      </div>
      <div className="grid2">
        <div className="panel"><h3>Échéances</h3><div className="list">{alerts.length ? alerts.map((a, i) => <div key={i} className="item" onClick={() => open(a.prospectId)}><div className="t">{a.company}</div><div className="s"><b className="late">{a.label}</b></div></div>) : <Empty title="Aucune échéance" />}</div></div>
        <div className="panel"><h3>Entreprises du programme</h3><div className="list">{list.map((p) => <ProspectItem key={p.id} p={p} onOpen={open} extra={p.trialStart ? <span className="tag">Essai J{Math.min(daysBetween(p.trialStart, t) + 1, 45)}/45</span> : <span className="tag hyp">essai non démarré</span>} />)}</div></div>
      </div>
    </section>
  );
}

function CampaignForm({ c, data, notify, isOwner, close }: { c: Partial<Campaign>; close: () => void } & Omit<P, "open">) {
  const [f, setF] = useState<Partial<Campaign>>({ segment: "C", dailyCap: 20, steps: [{ day: 0, channel: "E-mail", template: "" }], status: "Brouillon", ...c });
  const step = (i: number, k: keyof CampaignStep, v: string) => setF((x) => ({ ...x, steps: x.steps!.map((s, j) => (j === i ? { ...s, [k]: k === "day" ? Number(v) : v } : s)) }));
  const save = async (status?: Campaign["status"]) => {
    try { await data.saveCampaign({ ...f, ...(status ? { status } : {}) }); notify(status === "Validée" ? "Campagne validée" : "Campagne enregistrée"); close(); } catch (e) { notify((e as Error).message); }
  };
  return (
    <div className="panel">
      <div className="fgrid">
        <label className="f">Nom<input value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="f">Segment<select value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value as Campaign["segment"] })}>{Object.entries(SEGMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Plafond par jour<input type="number" min={1} max={50} value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: Number(e.target.value) })} /></label>
        <label className="f">Objectif<input value={f.goal || ""} onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
      </div>
      {f.steps!.map((s, i) => (
        <div key={i} className="fgrid">
          <label className="f">Jour<input type="number" min={0} value={s.day} onChange={(e) => step(i, "day", e.target.value)} /></label>
          <label className="f">Canal<select value={s.channel} onChange={(e) => step(i, "channel", e.target.value)}>{CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}</select></label>
          <label className="f" style={{ gridColumn: "1/-1" }}>Message<textarea rows={4} value={s.template} onChange={(e) => step(i, "template", e.target.value)} /></label>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => setF({ ...f, steps: [...f.steps!, { day: 3, channel: "E-mail", template: "" }] })}>+ Étape</button>
        <button className="btn primary" onClick={() => save()}>Enregistrer</button>
        {isOwner && f.status !== "Validée" && <button className="btn" onClick={() => save("Validée")}>Valider la campagne</button>}
        <button className="btn ghost" onClick={close}>Fermer</button>
      </div>
      <p className="small muted">Une campagne validée puis modifiée repasse en brouillon (règle appliquée par la base).</p>
    </div>
  );
}

export function Campaigns(props: P) {
  const { data, notify, isOwner } = props;
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  const toValidate = data.outbox.filter((o) => o.status === "À valider");
  const name = (id: string) => data.prospects.find((p) => p.id === id)?.company || "?";
  return (
    <section className="view">
      <div className="panel"><h2>Envois préparés par l’agent</h2>
        <div className="list">{toValidate.length ? toValidate.map((o) => (
          <div key={o.id} className="item" style={{ cursor: "default" }}>
            <div className="t">{name(o.prospect_id)} · {o.channel}{o.subject ? ` · ${o.subject}` : ""}</div>
            <div className="r">{isOwner && <button className="btn sm primary" onClick={() => data.setOutboxStatus(o.id, "Validé").then(() => notify("Envoi validé"), (e) => notify(e.message))}>Valider</button>}<button className="btn sm ghost" onClick={() => data.setOutboxStatus(o.id, "Annulé").then(() => notify("Annulé"))}>Annuler</button></div>
            <div className="s"><span style={{ whiteSpace: "pre-wrap" }}>{o.body}</span></div>
          </div>)) : <Empty title="Aucun envoi en attente" text="La tâche quotidienne prépare ici les étapes du jour des campagnes validées." />}</div>
      </div>
      <div className="row between"><h2>Campagnes</h2><button className="btn primary" onClick={() => setEdit({})}>+ Nouvelle campagne</button></div>
      {edit && <CampaignForm c={edit} data={data} notify={notify} isOwner={isOwner} close={() => setEdit(null)} />}
      <div className="panel"><div className="list">{data.campaigns.map((c) => (
        <div key={c.id} className="item" onClick={() => setEdit(c)}><div className="t">{c.name}</div><div className="r"><span className="tag">{SEGMENT_LABEL[c.segment]}</span><span className={`pill ${c.status === "Validée" ? "g-won" : "g-risk"}`}>{c.status}</span></div><div className="s"><span>{c.steps.length} étapes</span><span>{data.prospects.filter((p) => p.campaignId === c.id).length} inscrits</span></div></div>
      ))}</div></div>
    </section>
  );
}

export function Comms({ data, notify, isOwner }: P) {
  const sug = contentSuggestions(data.prospects, data.content, objectionCounts(data.history));
  const prepare = async (title: string, why: string, prospectId: string | null, kind: string) => {
    try {
      let text = "";
      try { text = (await api<{ text: string }>("/api/ai/generate", { kind: "content", title, why, prospectId })).text; } catch (e) { notify((e as Error).message); }
      await data.saveContent({ title, text: text || `${title}\n\n[À rédiger]`, status: "À valider", prospectId: prospectId || null, kind: prospectId ? kind : "|" + kind, networks: ["LinkedIn", "Instagram"] } as unknown as ContentItem);
      notify("Brouillon créé : à valider");
    } catch (e) { notify((e as Error).message); }
  };
  return (
    <section className="view"><h2>Communication</h2>
      <div className="notice info"><b>Règles :</b> aucune entreprise citée sans accord écrit ; aucun prix ni chiffre sur SwipSales ; témoignages réels uniquement.</div>
      <div className="panel"><h3>Propositions de l’agent</h3><div className="list">{sug.length ? sug.map((s, i) => <div key={i} className="item" style={{ cursor: "default" }}><div className="t">{s.title}</div><div className="r"><button className="btn sm primary" onClick={() => prepare(s.title, s.why, s.prospectId, s.kind)}>Préparer</button></div><div className="s">{s.why}</div></div>) : <Empty title="Pas de suggestion pour l’instant" />}</div></div>
      <div className="panel"><h3>Contenus</h3><div className="list">{data.content.map((c) => (
        <div key={c.id} className="item" style={{ cursor: "default" }}><div className="t">{c.title}</div>
          <div className="r"><span className="pill g-early">{c.status}</span>{isOwner && c.status === "À valider" && <button className="btn sm" disabled={!canApproveContent(c, data.prospects)} title={canApproveContent(c, data.prospects) ? "" : "Pas d’accord écrit"} onClick={() => data.saveContent({ id: c.id, status: "Validé" }).then(() => notify("Publication validée"), (e) => notify(e.message))}>Valider</button>}</div>
          <div className="s"><span style={{ whiteSpace: "pre-wrap" }}>{c.text}</span></div></div>
      ))}</div></div>
    </section>
  );
}

export function Performance({ data }: P) {
  const groups = useMemo(() => ({
    "Par canal du premier contact": perfBy(data.prospects, data.history, (_, f) => f.channel || "?"),
    "Par campagne": perfBy(data.prospects, data.history, (p, f) => data.campaigns.find((c) => c.id === (f.campaignId || p.campaignId))?.name || "Hors campagne"),
    "Par secteur": perfBy(data.prospects, data.history, (p) => p.sector),
    "Par segment ABM": perfBy(data.prospects, data.history, (p) => SEGMENT_LABEL[p.segment || ""]),
  }), [data.prospects, data.history, data.campaigns]);
  const obj = objectionCounts(data.history);
  return (
    <section className="view"><h2>Performances</h2>
      <div className="grid2">{Object.entries(groups).map(([title, rows]) => (
        <div key={title} className="panel"><h3>{title}</h3>{rows.length ? <div className="tbl-wrap"><table><thead><tr><th>Groupe</th><th>Contactés</th><th>Réponses</th><th>Taux</th><th>RDV</th><th>Payants</th></tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}{!isSignificant(r) && " *"}</td><td className="num">{r.contacted}</td><td className="num">{r.replied}</td><td className="num">{pct(r.rate)}</td><td className="num">{r.meetings}</td><td className="num">{r.paid}</td></tr>)}</tbody></table></div> : <p className="small muted">Pas encore de contact journalisé.</p>}
          {rows.some((r) => !isSignificant(r)) && <p className="small muted">* Moins de 10 entreprises : ne pas conclure.</p>}</div>
      ))}</div>
      <div className="panel"><h3>Objections les plus fréquentes</h3>{obj.length ? obj.map(([o, n]) => <div key={o} className="bar"><span>{o}</span><div className="trk"><div className="fill" style={{ width: `${(n / obj[0][1]) * 100}%` }} /></div><span className="n">{n}</span></div>) : <p className="small muted">Aucune objection journalisée.</p>}</div>
    </section>
  );
}
