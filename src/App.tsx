import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import { useData } from "./lib/useData";
import { Campaigns, Comms, Crm, Founding, Partners, Performance, Today } from "./ui/pages";
import { ProspectPanel } from "./ui/ProspectPanel";

const TABS = [
  ["today", "Aujourd’hui"], ["crm", "Prospection et CRM"], ["partners", "Partenariats"], ["founding", "Founding Recruiters"],
  ["campaigns", "Campagnes"], ["comms", "Communication"], ["perf", "Performances"],
] as const;
type Tab = (typeof TABS)[number][0];

function Login() {
  const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); const [err, setErr] = useState("");
  return (
    <form className="login panel" onSubmit={async (e) => {
      e.preventDefault();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
      if (error) setErr(error.message); else setSent(true);
    }}>
      <h2>SwipSales Growth</h2>
      {sent ? <p>Lien de connexion envoyé à {email}.</p> : <>
        <label className="f">Adresse e-mail de l’équipe<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button className="btn primary" type="submit">Recevoir un lien de connexion</button>
        {err && <p className="late">{err}</p>}
      </>}
    </form>
  );
}

function Workspace({ session }: { session: Session }) {
  const data = useData();
  const [tab, setTab] = useState<Tab>("today");
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState("");
  const [role, setRole] = useState<string>("");
  useEffect(() => {
    supabase.from("team_members").select("role").eq("user_id", session.user.id).maybeSingle().then(({ data }) => setRole(data?.role || ""));
  }, [session.user.id]);
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2800); };
  const props = { data, open: (id: string | null) => setOpenId(id), notify, isOwner: role === "owner" };
  if (!role) return <div className="login panel"><p>Ce compte ne fait pas partie de l’équipe SwipSales Growth. Demandez à Yannis de vous ajouter.</p><button className="btn" onClick={() => supabase.auth.signOut()}>Se déconnecter</button></div>;
  return (
    <>
      <header className="top"><div className="top-in">
        <div className="brand"><div className="brand-l"><b>Swip<span>Sales</span> Growth</b></div><span className="scope">{session.user.email} · {role}</span></div>
        <nav className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpenId(undefined); }}>{l}</button>)}</nav>
      </div></header>
      <main className="main">
        {data.error && <div className="notice"><b>Erreur :</b> {data.error}</div>}
        {openId !== undefined ? (
          <ProspectPanel data={data} id={openId} onClose={() => setOpenId(undefined)} notify={notify} />
        ) : tab === "today" ? <Today {...props} /> : tab === "crm" ? <Crm {...props} /> : tab === "partners" ? <Partners {...props} /> :
          tab === "founding" ? <Founding {...props} /> : tab === "campaigns" ? <Campaigns {...props} /> : tab === "comms" ? <Comms {...props} /> : <Performance {...props} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!configured) return <div className="login panel"><h2>Configuration manquante</h2><p>Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir .env.example).</p></div>;
  if (!ready) return null;
  return session ? <Workspace session={session} /> : <Login />;
}
