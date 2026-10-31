import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ShieldCheck, Sparkles, Activity, Loader2 } from "lucide-react";

const googleLogin = () => {
  // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
  const redirectUrl = window.location.origin + "/home";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

const perks = [
  { icon: Activity, text: "Live INR prices & accurate P&L" },
  { icon: ShieldCheck, text: "Portfolio Health Score out of 100" },
  { icon: Sparkles, text: "AI analyst that reads your real holdings" },
];

export default function Login() {
  const { user, setUser } = useAuth();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/home" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { data } = await http.post(mode === "login" ? "/auth/login" : "/auth/register", form);
      setUser(data);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden lg:flex flex-col justify-between p-14 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-violet-500 grid place-items-center font-display font-bold text-slate-950">K</div>
          <span className="font-display text-lg">Kuber Crypto</span>
        </div>
        <div className="max-w-lg fade-up">
          <p className="text-emerald-400 text-sm font-semibold tracking-widest uppercase mb-4">Portfolio health analyst</p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">Know how healthy your crypto really is.</h1>
          <p className="text-slate-400 mt-6 text-base">Add your coins, get a personalised diagnosis in seconds, and ask an AI that only speaks from your actual numbers.</p>
          <div className="mt-10 space-y-4">
            {perks.map(({ icon: I, text }, i) => (
              <div key={text} className="flex items-center gap-3 fade-up" style={{ animationDelay: `${0.15 + i * 0.1}s` }}>
                <span className="h-9 w-9 rounded-lg bg-white/5 grid place-items-center"><I className="h-4 w-4 text-emerald-400" /></span>
                <span className="text-slate-300">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">We never ask for private keys or seed phrases. Not financial advice.</p>
        <div className="absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="k-card w-full max-w-md p-8 fade-up" data-testid="auth-card">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 grid place-items-center font-display font-bold text-slate-950 text-sm">K</div>
            <span className="font-display">Kuber Crypto</span>
          </div>
          <h2 className="font-display text-2xl">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="text-slate-400 text-sm mt-1">{mode === "login" ? "Sign in to check your portfolio health." : "Start tracking in under a minute."}</p>

          <Button data-testid="google-login-btn" onClick={googleLogin} variant="outline" className="w-full mt-6 h-11 rounded-full bg-white text-slate-900 hover:bg-slate-200 border-0 font-semibold">
            <svg className="h-4 w-4 mr-2" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 my-6 text-xs text-slate-500"><div className="h-px flex-1 bg-white/10" />or with email<div className="h-px flex-1 bg-white/10" /></div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" data-testid="auth-name-input" className="mt-1.5 h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" data-testid="auth-email-input" className="mt-1.5 h-11" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" data-testid="auth-password-input" className="mt-1.5 h-11" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={mode === "register" ? 6 : 1} />
            </div>
            {err && <p className="text-sm text-rose-400" data-testid="auth-error">{err}</p>}
            <Button type="submit" disabled={busy} data-testid="auth-submit-btn" className="w-full h-11 rounded-full font-semibold">
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button data-testid="auth-toggle-mode" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }} className="mt-5 text-sm text-slate-400 hover:text-emerald-400 transition-colors w-full">
            {mode === "login" ? "New to Kuber? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
