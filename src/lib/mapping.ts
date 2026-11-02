// Conversion base (snake_case) <-> application (camelCase). Les dates nulles deviennent "".
import type { Campaign, ContentItem, Interaction, Prospect } from "../domain/types.js";

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

const DATE_FIELDS = new Set(["verifiedAt", "signalDate", "nextDate", "commsConsentDate", "trialStart", "trialEnd", "offerDate", "enrolledAt", "date"]);

export function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = toCamel(k);
    out[ck] = v === null && DATE_FIELDS.has(ck) ? "" : v;
  }
  return out as T;
}

export function toRow(obj: Record<string, unknown>, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (omit.includes(k) || v === undefined) continue;
    out[toSnake(k)] = v === "" && DATE_FIELDS.has(k) ? null : v;
  }
  return out;
}

export const prospectFromRow = (r: Record<string, unknown>) => fromRow<Prospect & { drafts: Record<string, unknown> | null }>(r);
export const campaignFromRow = (r: Record<string, unknown>) => fromRow<Campaign>(r);
export const contentFromRow = (r: Record<string, unknown>) => fromRow<ContentItem>(r);
export const interactionFromRow = (r: Record<string, unknown>): Interaction => {
  const x = fromRow<Interaction & { type: Interaction["type"] }>(r);
  return { ...x, objection: x.objection || undefined, channel: x.channel || undefined };
};

export function groupHistory(list: Interaction[]): Map<string, Interaction[]> {
  const m = new Map<string, Interaction[]>();
  for (const i of [...list].sort((a, b) => a.at.localeCompare(b.at))) {
    const arr = m.get(i.prospectId) || [];
    arr.push(i);
    m.set(i.prospectId, arr);
  }
  return m;
}
