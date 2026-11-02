import type { ReactNode } from "react";
import { STAGES } from "../domain/constants";
import { frDate, today } from "../domain/dates";
import { scoreOf } from "../domain/scoring";
import type { Prospect } from "../domain/types";

const GROUP = ["g-early", "g-early", "g-out", "g-out", "g-out", "g-eng", "g-eng", "g-eng", "g-eng", "g-won", "g-won", "g-risk", "g-lost", "g-early", "g-eng"];
const SEG: Record<string, string> = { A: "A · Partenaire", B: "B · Founding", C: "C · Vente directe" };

export const StagePill = ({ stage }: { stage: string }) => (
  <span className={`pill ${GROUP[STAGES.indexOf(stage as (typeof STAGES)[number])] || "g-early"}`}>{stage || "—"}</span>
);

export function ProspectItem({ p, onOpen, extra, active }: { p: Prospect; onOpen: (id: string) => void; extra?: ReactNode; active?: boolean }) {
  const s = scoreOf(p);
  const late = !!p.nextDate && p.nextDate < today();
  return (
    <div className={`item${active ? " active" : ""}`} role="button" tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(p.id)}>
      <div className="t">{p.company}{p.optOut && <span className="tag"> Ne plus contacter</span>}</div>
      <div className="r">
        <span className={`prio ${s.prio}`} title={`Score ${s.total}/100, dont ${s.fact} sur faits vérifiés`}>{s.prio} · {s.total}</span>
        <StagePill stage={p.stage} />
      </div>
      <div className="s">
        {p.segment && <span className="tag">{SEG[p.segment]}</span>}
        {p.roles && <span>{p.roles}</span>}
        {(p.nextAction || p.nextDate) && <span className={late ? "late" : ""}>{p.nextAction || "Action"} · {p.nextDate ? frDate(p.nextDate) : "sans date"}</span>}
        {extra}
      </div>
    </div>
  );
}

export const Empty = ({ title, text, children }: { title: string; text?: string; children?: ReactNode }) => (
  <div className="empty"><b>{title}</b>{text && <span>{text}</span>}{children}</div>
);

export const Kpi = ({ label, value, formula, source }: { label: string; value: ReactNode; formula?: string; source?: string }) => (
  <div className="kpi"><div className="l">{label}</div><div className="v">{value}</div>{formula && <div className="f">{formula}</div>}{source && <div className="src">{source}</div>}</div>
);

export const pct = (n: number) => (isFinite(n) ? (Math.round(n * 1000) / 10).toLocaleString("fr-FR") + " %" : "—");
