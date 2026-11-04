// Dossier de recherche d'une entreprise : registre, offres, coordonnées publiques, décideurs, faits et angles, tous sourcés.
import { useState } from "react";
import { frDate } from "../domain/dates";
import type { Prospect, ResearchDossier } from "../domain/types";
import { api } from "../lib/supabase";
import type { Data } from "../lib/useData";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const Src = ({ url }: { url: string }) => (url ? <a className="src-link" href={url} target="_blank" rel="noreferrer">{host(url)}</a> : null);
const LABEL: Record<string, string> = { email: "E-mail", telephone: "Téléphone", linkedin: "LinkedIn", formulaire: "Formulaire" };

export function ResearchPanel({ p, data, notify }: { p: Prospect; data: Data; notify: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const r: ResearchDossier = p.research || {};
  const status = p.researchStatus || "";
  async function launch() {
    setBusy(true);
    try { await api("/api/research", { prospectId: p.id }); await data.reload(); notify("Recherche terminée : dossier mis à jour"); }
    catch (e) { notify((e as Error).message); await data.reload(); }
    finally { setBusy(false); }
  }
  return (
    <div className="panel dossier">
      <div className="row between">
        <h3>Dossier de recherche {r.at ? `· ${frDate(r.at)}` : ""} {status && <span className={`pill ${status === "fait" ? "g-won" : status === "échec" ? "g-risk" : "g-early"}`}>{status}</span>}</h3>
        <button className="btn sm primary" disabled={busy || p.optOut || status === "en cours"} onClick={launch}>{busy ? "Recherche en cours (1 à 3 min)…" : r.at ? "Mettre à jour" : "Rechercher avec l’IA"}</button>
      </div>
      {p.optOut && <div className="notice"><b>Opposition :</b> pas de recherche ni de contact.</div>}
      {r.summary && <p>{r.summary}</p>}
      {r.registry && (
        <p className="small muted">Registre : <a href={r.registry.url} target="_blank" rel="noreferrer">SIREN {r.registry.siren}</a> · {r.registry.naf} · {r.registry.headcount} salariés · {r.registry.city}{r.registry.created ? ` · créée le ${frDate(r.registry.created)}` : ""}{r.registry.officers.length ? ` · ${r.registry.officers.map((o) => `${o.name} (${o.role})`).join(", ")}` : ""}</p>
      )}
      {!!r.contacts?.length && (<><h4>Coordonnées publiques</h4><ul>{r.contacts.map((c, i) => (
        <li key={i}><b>{LABEL[c.type]}</b> {c.type === "email" ? <a href={`mailto:${c.value}`}>{c.value}</a> : c.type === "telephone" ? <a href={`tel:${c.value.replace(/\s/g, "")}`}>{c.value}</a> : <a href={c.value} target="_blank" rel="noreferrer">{host(c.value)}</a>} · {c.owner} · <Src url={c.url} /></li>
      ))}</ul></>)}
      {!!r.decisionMakers?.length && (<><h4>Décideurs</h4><ul>{r.decisionMakers.map((d, i) => <li key={i}><b>{d.name}</b>, {d.title} · <Src url={d.url} /></li>)}</ul></>)}
      {!!(r.signals?.length || r.facts?.length) && (<><h4>Faits et signaux</h4><ul>{[...(r.signals || []), ...(r.facts || [])].map((f, i) => <li key={i}>{f.text}{f.date ? ` (${frDate(f.date)})` : ""} · <Src url={f.url} /></li>)}</ul></>)}
      {!!r.offers?.length && (<><h4>Offres commerciales publiées</h4><ul>{r.offers.map((o, i) => <li key={i}>{frDate(o.date)} · <a href={o.url} target="_blank" rel="noreferrer">{o.title}</a> · {o.city}</li>)}</ul></>)}
      {!!r.angles?.length && (<><h4>Angles d’approche</h4><ul>{r.angles.map((a, i) => <li key={i}><b>{a.angle}</b>{a.basis ? <span className="muted"> — appui : {a.basis}</span> : null}</li>)}</ul></>)}
      {r.gaps && <p className="small muted">Limites : {r.gaps}</p>}
      {r.cost && <p className="small muted">{r.cost.searches} recherches, {r.cost.fetches} pages lues, {Math.round((r.cost.tokensIn + r.cost.tokensOut) / 1000)} k jetons.{r.rejected ? ` ${r.rejected} élément(s) écarté(s) faute de source ou parce que personnels.` : ""}</p>}
      {!r.at && !r.registry && !r.offers && <p className="small muted">Pas encore de dossier. La recherche ne garde que des informations publiques, avec leur source.</p>}
    </div>
  );
}
