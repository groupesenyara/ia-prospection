// Dates au format AAAA-MM-JJ, en heure locale (Europe/Paris côté navigateur).
export const localISO = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const today = (): string => localISO(new Date());
export const addDays = (s: string, n: number): string => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localISO(d);
};
export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 864e5);
export const frDate = (s?: string | null): string => {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
