// Export CSV du CRM (séparateur « ; », UTF-8 avec BOM : s'ouvre tel quel dans Excel).
import { scoreOf } from "../domain/scoring.js";
import type { Prospect } from "../domain/types.js";

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS: [string, (p: Prospect) => unknown][] = [
  ["Entreprise", (p) => p.company],
  ["SIREN", (p) => p.siren || ""],
  ["Ville", (p) => p.city || ""],
  ["Effectif", (p) => p.headcount || p.size],
  ["Secteur", (p) => p.sector],
  ["Site", (p) => p.website],
  ["Décideur", (p) => p.decisionName],
  ["Fonction", (p) => p.decisionTitle],
  ["E-mail", (p) => p.email],
  ["Téléphone", (p) => p.phone],
  ["LinkedIn", (p) => p.linkedin],
  ["Source des coordonnées", (p) => p.contactSource],
  ["Autres coordonnées publiques", (p) => (p.research?.contacts || []).filter((c) => c.value !== p.email && c.value !== p.phone && c.value !== p.linkedin).map((c) => `${c.value} (${c.owner})`).join(" | ")],
  ["Postes recherchés", (p) => p.roles],
  ["Signal", (p) => p.signal],
  ["Date du signal", (p) => p.signalDate],
  ["Source du signal", (p) => p.signalSource],
  ["Pôle principal", (p) => p.research?.primaryUnit || ""],
  ["Scores par pôle", (p) => (p.research?.units || []).map((u) => `${u.unit} ${u.score}`).join(" | ")],
  ["Résumé", (p) => p.research?.summary || ""],
  ["Angles d’approche", (p) => (p.research?.angles || []).map((a) => a.angle).join(" | ")],
  ["Score", (p) => scoreOf(p).total],
  ["Priorité", (p) => scoreOf(p).prio],
  ["Étape", (p) => p.stage],
  ["Ne plus contacter", (p) => (p.optOut ? "oui" : "")],
  ["Recherche IA", (p) => p.researchStatus || ""],
];

export function toCsv(list: Prospect[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => cell(h)).join(";"), ...list.map((p) => CSV_COLUMNS.map(([, f]) => cell(f(p))).join(";"))];
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(list: Prospect[], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(list)], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
