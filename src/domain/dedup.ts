// Déduplication des entreprises : même domaine de site, ou même nom normalisé.
import type { Prospect } from "./types.js";

export const normName = (s: string): string =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(sas|sasu|sarl|sa|eurl|sci|groupe|group|france)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

export const domainOf = (u: string): string => {
  if (!u) return "";
  try {
    const x = new URL(/^https?:/i.test(u) ? u : "https://" + u);
    return x.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

export function findDuplicate<T extends Pick<Prospect, "id" | "company" | "website">>(candidate: Pick<Prospect, "company" | "website">, all: T[], selfId?: string): T | undefined {
  const d = domainOf(candidate.website), n = normName(candidate.company);
  return all.find((x) => x.id !== selfId && ((d && domainOf(x.website) === d) || (n && normName(x.company) === n)));
}
