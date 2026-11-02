// Chargement des données de l'équipe + rafraîchissement en temps réel (Supabase Realtime).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Campaign, ContentItem, Interaction, Prospect } from "../domain/types";
import { campaignFromRow, contentFromRow, groupHistory, interactionFromRow, prospectFromRow, toRow } from "./mapping";
import { supabase } from "./supabase";

export type ProspectRow = Prospect & { drafts: Record<string, unknown> | null };

export interface Outbox { id: string; prospect_id: string; campaign_id: string | null; channel: string; subject: string; body: string; status: string; created_at: string }

export function useData() {
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    const [p, c, i, k, o, s] = await Promise.all([
      supabase.from("prospects").select("*").order("updated_at", { ascending: false }),
      supabase.from("campaigns").select("*").order("name"),
      supabase.from("interactions").select("*").order("at"),
      supabase.from("content").select("*").order("updated_at", { ascending: false }),
      supabase.from("outbox").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("settings").select("*"),
    ]);
    const e = p.error || c.error || i.error || k.error || o.error || s.error;
    if (e) { setError(e.message); return; }
    setError("");
    setProspects((p.data || []).map(prospectFromRow));
    setCampaigns((c.data || []).map(campaignFromRow));
    setInteractions((i.data || []).map(interactionFromRow));
    setContent((k.data || []).map(contentFromRow));
    setOutbox((o.data || []) as Outbox[]);
    setSettings(Object.fromEntries((s.data || []).map((r) => [r.key, r.value])));
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("growth").on("postgres_changes", { event: "*", schema: "public" }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const history = useMemo(() => groupHistory(interactions), [interactions]);

  /** Écriture avec message d'erreur lisible (les règles de la base renvoient un texte explicite). */
  const write = useCallback(async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await fn();
    if (error) throw new Error(error.message);
    await load();
  }, [load]);

  const updateProspect = (id: string, patch: Partial<ProspectRow>) => write(() => supabase.from("prospects").update(toRow(patch as Record<string, unknown>, ["id"])).eq("id", id));
  const insertProspect = (p: Partial<ProspectRow>) => write(() => supabase.from("prospects").insert(toRow(p as Record<string, unknown>, ["id"])));
  const addInteraction = (i: Interaction) => write(() => supabase.from("interactions").insert(toRow(i as unknown as Record<string, unknown>, ["id"])));
  const saveCampaign = (c: Partial<Campaign>) => write(() => (c.id ? supabase.from("campaigns").update(toRow(c as Record<string, unknown>, ["id", "validatedAt"])).eq("id", c.id) : supabase.from("campaigns").insert(toRow(c as Record<string, unknown>, ["id", "validatedAt"]))));
  const saveContent = (c: Partial<ContentItem>) => write(() => (c.id ? supabase.from("content").update(toRow(c as Record<string, unknown>, ["id"])).eq("id", c.id) : supabase.from("content").insert(toRow(c as Record<string, unknown>, ["id"]))));
  const setOutboxStatus = (id: string, status: string) => write(() => supabase.from("outbox").update({ status }).eq("id", id));

  return { prospects, campaigns, interactions, history, content, outbox, settings, error, reload: load, updateProspect, insertProspect, addInteraction, saveCampaign, saveContent, setOutboxStatus };
}
export type Data = ReturnType<typeof useData>;
