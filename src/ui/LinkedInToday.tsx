// Liste LinkedIn du jour : préparée par l'agent, envoyée à la main par vous (aucune automatisation sur LinkedIn).
import { useEffect, useMemo, useState } from "react";
import { checkClaims, type ConfirmedFact } from "../domain/claims";
import { addDays, today } from "../domain/dates";
import { linkedinQueue, LINKEDIN_DAILY, NOTE_MAX, type LinkedInTask } from "../domain/linkedin";
import { buildInteraction, patchAfter } from "../domain/sequence";
import { UNITS, type UnitId } from "../domain/units";
import { supabase } from "../lib/supabase";
import type { Data } from "../lib/useData";
import { Empty } from "./common";

export function LinkedInToday({ data, open, notify }: { data: Data; open: (id: string | null) => void; notify: (m: string) => void }) {
  const [active, setActive] = useState(new Map<string, string>());
  const [facts, setFacts] = useState<Partial<Record<UnitId, ConfirmedFact[]>>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    supabase.from("opportunities").select("prospect_id,unit").eq("active", true).then(({ data: rows }) => setActive(new Map((rows || []).map((r) => [r.prospect_id as string, r.unit as string]))));
    supabase.from("unit_facts").select("unit,kind,text").eq("status", "Confirmé").then(({ data: rows }) => {
      const out: Partial<Record<UnitId, ConfirmedFact[]>> = {};
      for (const r of (rows || []) as { unit: UnitId; kind: ConfirmedFact["kind"]; text: string }[]) (out[r.unit] ||= []).push({ kind: r.kind, text: r.text });
      setFacts(out);
    });
  }, [data.interactions.length]);

  const t = today();
  const sentThisWeek = data.interactions.filter((i) => i.type === "contact_linkedin" && i.day > addDays(t, -7)).length;
  const sentToday = data.interactions.filter((i) => i.type === "contact_linkedin" && i.day === t).length;
  const queue = useMemo(() => linkedinQueue(data.prospects.filter((p) => !skipped.includes(p.id)), data.history, active, t, Math.max(0, LINKEDIN_DAILY - sentToday)), [data.prospects, data.history, active, skipped, t, sentToday]);

  async function done(task: LinkedInTask, note: string) {
    const p = task.prospect;
    setBusy(p.id);
    try {
      const ev = { ...buildInteraction(p, "contact_linkedin", `Invitation LinkedIn : ${note}`.slice(0, 500)), unit: task.unit };
      if (task.unit === "swipsales") {
        // Pipeline Swipe Sales historique : la fiche avance, l'opportunité suit automatiquement
        await data.addInteraction(ev);
        await data.updateProspect(p.id, patchAfter(p, [...(data.history.get(p.id) || []), ev], ev, data.campaigns.find((c) => c.id === p.campaignId) || null));
      } else {
        // Autre pôle : on active SON opportunité (refusé par la base si un autre pôle sollicite déjà l'entreprise)
        const { data: opp } = await supabase.from("opportunities").select("id").eq("prospect_id", p.id).eq("unit", task.unit).in("status", ["ouverte", "en attente"]).maybeSingle();
        const r = opp
          ? await supabase.from("opportunities").update({ active: true, status: "ouverte", stage: "Contact effectué", next_action: "Relance (LinkedIn ou e-mail)", next_date: addDays(t, 4) }).eq("id", opp.id)
          : await supabase.from("opportunities").insert({ prospect_id: p.id, unit: task.unit, active: true, stage: "Contact effectué", next_action: "Relance (LinkedIn ou e-mail)", next_date: addDays(t, 4) });
        if (r.error) throw new Error(r.error.message);
        await data.addInteraction(ev);
        await data.updateProspect(p.id, { nextAction: `Relance ${UNITS[task.unit].name}`, nextDate: addDays(t, 4) });
      }
      notify(`Invitation journalisée pour ${p.company} (${UNITS[task.unit].name}), relance dans 4 jours`);
    } catch (e) { notify((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <div className="panel">
      <h2>LinkedIn du jour</h2>
      <p className="small muted">{sentToday} invitation(s) aujourd’hui, {sentThisWeek} sur 7 jours. Rythme conseillé : {LINKEDIN_DAILY} par jour au maximum. L’envoi se fait à la main sur LinkedIn : ses conditions interdisent l’automatisation.</p>
      <div className="list">{queue.length ? queue.map((task) => <Row key={task.prospect.id} task={task} facts={facts[task.unit] || []} busy={busy === task.prospect.id} open={open} onDone={done} onSkip={() => setSkipped((s) => [...s, task.prospect.id])} />)
        : <Empty title={sentToday >= LINKEDIN_DAILY ? "Quota du jour atteint" : "Personne à inviter aujourd’hui"} text="La liste se remplit avec les entreprises recherchées par l’agent (décideur identifié et note LinkedIn rédigée)." />}</div>
    </div>
  );
}

function Row({ task, facts, busy, open, onDone, onSkip }: { task: LinkedInTask; facts: ConfirmedFact[]; busy: boolean; open: (id: string) => void; onDone: (t: LinkedInTask, note: string) => void; onSkip: () => void }) {
  const [note, setNote] = useState(task.note.slice(0, NOTE_MAX));
  const issues = checkClaims(note, facts);
  const p = task.prospect;
  return (
    <div className="item" style={{ cursor: "default" }}>
      <div className="t"><a href="#" onClick={(e) => { e.preventDefault(); open(p.id); }}>{p.company}</a> · {p.decisionName}{p.decisionTitle ? `, ${p.decisionTitle}` : ""}</div>
      <div className="r"><span className="tag">{UNITS[task.unit].name}</span><span className="prio B">{task.score}</span></div>
      <div className="s" style={{ display: "block" }}>
        {task.reason && <p className="small muted">{task.reason}</p>}
        <textarea rows={3} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} aria-label="Note d’invitation" />
        <p className="small muted">{note.length}/{NOTE_MAX} caractères{task.profile.direct ? "" : " · profil non trouvé : la recherche LinkedIn s’ouvrira"}</p>
        {!!issues.length && <div className="notice"><b>À corriger avant envoi :</b> {issues.map((i) => `${i.hint} (« ${i.excerpt} »)`).join(" ; ")}</div>}
        <div className="row">
          <a className="btn sm" href={task.profile.url} target="_blank" rel="noreferrer">{task.profile.direct ? "Ouvrir le profil" : "Chercher sur LinkedIn"}</a>
          <button className="btn sm" disabled={!!issues.length} onClick={() => navigator.clipboard?.writeText(note)}>Copier la note</button>
          <button className="btn sm primary" disabled={busy || !!issues.length || !note.trim()} onClick={() => onDone(task, note)}>{busy ? "…" : "Invitation envoyée"}</button>
          <button className="btn sm ghost" onClick={onSkip}>Passer</button>
        </div>
      </div>
    </div>
  );
}
