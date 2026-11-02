// Fiche entreprise : édition, segment ABM, partenariat, Founding, campagne, journal et messages.
import { useEffect, useState } from "react";
import { EVENT_LABEL, KINDS, OBJECTIONS, PARTNER_STATUS, SEGMENT_LABEL, STAGES } from "../domain/constants";
import { frDate } from "../domain/dates";
import { findDuplicate } from "../domain/dedup";
import { startTrial } from "../domain/founding";
import { scoreOf } from "../domain/scoring";
import { buildInteraction, enroll, patchAfter } from "../domain/sequence";
import type { EventType, Prospect } from "../domain/types";
import type { Data, ProspectRow } from "../lib/useData";
import { api } from "../lib/supabase";

type Draft = Partial<ProspectRow>;
const blank: Draft = { company: "", website: "", sector: "", kind: KINDS[0], roles: "", source: "", segment: "", stage: STAGES[0], crit: {} };

export function ProspectPanel({ data, id, onClose, notify }: { data: Data; id: string | null; onClose: () => void; notify: (m: string) => void }) {
  const current = id ? data.prospects.find((p) => p.id === id) : null;
  const [f, setF] = useState<Draft>(current || blank);
  const [note, setNote] = useState("");
  const [obj, setObj] = useState("");
  const [campId, setCampId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(current || blank); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof ProspectRow) => (e: { target: { value: string; type?: string; checked?: boolean } }) =>
    setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify(ok); } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };
  const dup = findDuplicate({ company: f.company || "", website: f.website || "" }, data.prospects, id || undefined);
  const history = id ? data.history.get(id) || [] : [];
  const score = scoreOf(f as Prospect);
  const camps = data.campaigns.filter((c) => c.status === "Validée");

  async function save() {
    if (!f.company || !f.source) return notify("Nom et source obligatoires");
    if (dup) return notify(`Doublon : ${dup.company} existe déjà`);
    await run(() => (id ? data.updateProspect(id, f) : data.insertProspect(f)), id ? "Fiche enregistrée" : "Entreprise ajoutée");
  }
  async function log(t: EventType) {
    if (!current) return;
    await run(async () => {
      const ev = buildInteraction(current, t, note, obj);
      const campaign = data.campaigns.find((c) => c.id === current.campaignId) || null;
      const patch = patchAfter(current, [...history, ev], ev, campaign);
      await data.addInteraction(ev);
      await data.updateProspect(current.id, patch);
      setNote(""); setObj("");
    }, EVENT_LABEL[t] + " — journalisé");
  }
  const L = (label: string, k: keyof ProspectRow, type = "text") => (
    <label className="f">{label}<input type={type} value={(f[k] as string) ?? ""} onChange={set(k)} /></label>
  );
  const C = (label: string, k: keyof ProspectRow) => (
    <label className="check"><input type="checkbox" checked={!!f[k]} onChange={set(k)} /> {label}</label>
  );

  return (
    <div className="view">
      <div className="row between"><h2>{f.company || "Nouvelle entreprise"}</h2><button className="btn ghost" onClick={onClose}>Fermer</button></div>
      <div className="panel">
        <h3>Entreprise</h3>
        <div className="fgrid">
          {L("Nom *", "company")}{L("Site web", "website", "url")}{L("Secteur", "sector")}
          <label className="f">Type<select value={f.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          {L("Postes commerciaux recherchés", "roles")}{L("Source *", "source")}
          <label className="f">Segment ABM (décidé par Yannis)<select value={f.segment} onChange={set("segment")}>{Object.entries(SEGMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        {dup && <div className="notice"><b>Doublon probable :</b> {dup.company} ({dup.stage}).</div>}
      </div>
      <div className="panel">
        <h3>Décideur et coordonnées</h3>
        <div className="fgrid">{L("Nom", "decisionName")}{L("Fonction", "decisionTitle")}{L("E-mail professionnel", "email", "email")}{L("Source des coordonnées", "contactSource")}</div>
        {C("Nom et fonction vérifiés sur une source publique récente", "decisionVerified")}
        {C("Ne plus contacter (opposition exprimée)", "optOut")}
        {C("Accord écrit pour citer l’entreprise publiquement", "commsConsent")}
      </div>
      <div className="panel">
        <h3>Signal et qualification · {score.total}/100 (priorité {score.prio}, {score.fact} pts sur faits vérifiés)</h3>
        <div className="fgrid">{L("Signal observé", "signal")}{L("Source du signal", "signalSource")}{L("Date du signal", "signalDate", "date")}</div>
      </div>
      {f.segment === "A" && (
        <div className="panel"><h3>Partenariat</h3><div className="fgrid">
          <label className="f">Statut<select value={f.partnerStatus || "Identifié"} onChange={set("partnerStatus")}>{PARTNER_STATUS.map((s) => <option key={s}>{s}</option>)}</select></label>
          {L("Modèle proposé", "partnerModel")}
        </div>{C("Convention validée par Yannis", "conventionOk")}</div>
      )}
      {f.segment === "B" && (
        <div className="panel"><h3>Founding Recruiter {f.trialStart ? `· essai du ${frDate(f.trialStart)} au ${frDate(f.trialEnd)}` : ""}</h3>
          {C("Engagement écrit reçu", "engagementOk")}{C("Offre réelle publiée", "offerPublished")}{C("Référence possible (satisfait)", "referenceOk")}
          {current && !current.trialStart && (
            <div className="row"><button className="btn sm primary" disabled={busy} onClick={() => run(() => data.updateProspect(current.id, startTrial({ ...current, ...f } as Prospect, data.prospects)), "Essai démarré")}>Démarrer l’essai de 45 jours</button></div>
          )}
        </div>
      )}
      <div className="panel"><h3>Suivi</h3><div className="fgrid">
        <label className="f">Étape<select value={f.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select></label>
        {L("Prochaine action", "nextAction")}{L("Date", "nextDate", "date")}
      </div></div>
      <div className="row"><button className="btn primary" disabled={busy} onClick={save}>Enregistrer</button></div>

      {current && (<>
        <div className="panel"><h3>Campagne {current.campaignId ? `· ${data.campaigns.find((c) => c.id === current.campaignId)?.name || ""} · ${current.campaignState}` : ""}</h3>
          <div className="row">
            <select value={campId} onChange={(e) => setCampId(e.target.value)} style={{ flex: 1, minWidth: 200 }}><option value="">Choisir une campagne validée</option>{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn sm" disabled={busy || !campId} onClick={() => run(() => data.updateProspect(current.id, enroll(current, data.campaigns.find((c) => c.id === campId)!)), "Inscrite à la campagne")}>Inscrire</button>
          </div>
        </div>
        <div className="panel"><h3>Journal des interactions</h3>
          <div className="row">{(Object.keys(EVENT_LABEL) as EventType[]).map((t) => <button key={t} className="btn sm" disabled={busy} onClick={() => log(t)}>{EVENT_LABEL[t]}</button>)}</div>
          <input type="text" placeholder="Détail (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="f">Objection entendue<select value={obj} onChange={(e) => setObj(e.target.value)}><option value="">—</option>{OBJECTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <div className="hist">{[...history].reverse().map((h, i) => <div key={h.id || i}><span className="mono small muted">{frDate(h.day)}</span><span><b>{EVENT_LABEL[h.type]}</b>{h.objection ? ` : « ${h.objection} »` : ""}{h.note ? ` — ${h.note}` : ""}</span></div>)}</div>
        </div>
        <div className="panel"><h3>Messages</h3>
          <div className="row">
            <button className="btn sm primary" disabled={busy} onClick={() => run(async () => {
              const r = await api<{ text: string }>("/api/ai/generate", { kind: "outreach", prospectId: current.id });
              await data.updateProspect(current.id, { drafts: { by: "claude", generatedAt: new Date().toISOString().slice(0, 10), raw: r.text, validated: false } });
            }, "Brouillons rédigés : à valider")}>Rédiger avec Claude</button>
            {current.drafts && !current.drafts.validated && <button className="btn sm" disabled={busy} onClick={() => run(() => data.updateProspect(current.id, { drafts: { ...current.drafts, validated: true, validatedAt: new Date().toISOString().slice(0, 10) } }), "Messages validés")}>Valider ces messages</button>}
          </div>
          {current.drafts ? <pre className="report">{String(current.drafts.raw ?? JSON.stringify(current.drafts, null, 2))}</pre> : <p className="small muted">Aucun brouillon.</p>}
        </div>
      </>)}
    </div>
  );
}
