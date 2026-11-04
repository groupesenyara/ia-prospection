// Sources publiques : offres d'emploi France Travail (API officielle, compte francetravail.io)
// et registre des entreprises (API Recherche d'entreprises de l'État, sans clé).
import { parseFirms, parseFranceTravail, SALES_ROME, type Firm, type JobOffer } from "../../src/domain/discovery.js";

type Fetch = typeof fetch;

const FT_TOKEN = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const FT_SEARCH = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

export async function franceTravailToken(clientId: string, secret: string, f: Fetch = fetch): Promise<string> {
  const res = await f(FT_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secret, scope: "api_offresdemploiv2 o2dsoffre" }),
  });
  if (!res.ok) throw new Error(`France Travail : authentification refusée (${res.status})`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("France Travail : jeton absent");
  return body.access_token;
}

/** Offres commerciales publiées depuis `days` jours (1, 3, 7, 14 ou 31), par pages de 150. */
export async function salesOffers(token: string, opts: { days?: number; pages?: number } = {}, f: Fetch = fetch): Promise<JobOffer[]> {
  const out: JobOffer[] = [];
  for (let page = 0; page < (opts.pages ?? 4); page++) {
    const q = new URLSearchParams({ codeROME: SALES_ROME.join(","), publieeDepuis: String(opts.days ?? 7), range: `${page * 150}-${page * 150 + 149}`, sort: "1" });
    const res = await f(`${FT_SEARCH}?${q}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    if (res.status === 204) break;
    if (!res.ok && res.status !== 206) throw new Error(`France Travail : recherche refusée (${res.status})`);
    const batch = parseFranceTravail(await res.json());
    out.push(...batch);
    if (res.status === 200 || batch.length === 0) break; // 200 = dernière page, 206 = il en reste
  }
  return out;
}

/** Recherche dans le registre (SIRENE + RNE) : entreprises actives portant ce nom. */
export async function findFirms(name: string, f: Fetch = fetch, attempt = 0): Promise<Firm[]> {
  const q = new URLSearchParams({ q: name, etat_administratif: "A", per_page: "5", page: "1" });
  const res = await f(`https://recherche-entreprises.api.gouv.fr/search?${q}`, { headers: { accept: "application/json" } });
  if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); return findFirms(name, f, attempt + 1); }
  if (!res.ok) throw new Error(`Registre des entreprises : ${res.status}`);
  return parseFirms(await res.json());
}

/** Registre : entreprises actives d'un département, pour une activité (code NAF) et des tranches d'effectif. 25 par page. */
export async function registryPage(q: { departement: string; naf: string; tranches: string[]; page: number }, f: Fetch = fetch, attempt = 0): Promise<{ firms: Firm[]; totalPages: number }> {
  const params = new URLSearchParams({ departement: q.departement, activite_principale: q.naf, tranche_effectif_salarie: q.tranches.join(","), etat_administratif: "A", per_page: "25", page: String(q.page) });
  const res = await f(`https://recherche-entreprises.api.gouv.fr/search?${params}`, { headers: { accept: "application/json" } });
  if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); return registryPage(q, f, attempt + 1); }
  if (!res.ok) throw new Error(`Registre des entreprises : ${res.status}`);
  const body = (await res.json()) as { total_pages?: number };
  return { firms: parseFirms(body), totalPages: Number(body.total_pages) || 1 };
}
