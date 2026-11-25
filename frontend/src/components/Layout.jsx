import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Compass, CandlestickChart, PiggyBank, Wallet, HeartPulse, Sparkles, ShieldAlert, Target, Settings, LogOut, Bell } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApi, http } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriceStatus } from "@/components/Bits";

export const NAV = [
  { to: "/home", label: "Crypto Explore", icon: Compass, short: "Explore" },
  { to: "/portfolio", label: "My Portfolio", icon: Wallet, short: "Portfolio" },
  { to: "/health", label: "Portfolio Health", icon: HeartPulse, short: "Health" },
  { to: "/chart", label: "AI Chart Analyst", icon: CandlestickChart, ai: true, short: "Charts" },
  { to: "/sip", label: "SIP", icon: PiggyBank, short: "SIP" },
  { to: "/analyst", label: "AI Portfolio Analyst", icon: Sparkles, ai: true, short: "AI Chat" },
  { to: "/risk", label: "Risk Monitor", icon: ShieldAlert, short: "Risk" },
  { to: "/goals", label: "Investment Goals", icon: Target, short: "Goals" },
  { to: "/settings", label: "Settings", icon: Settings, short: "Settings" },
];

function Notifications() {
  const { data, mutate } = useApi("/notifications", { refreshInterval: 60000 });
  useApi("/risk", { refreshInterval: 120000, onSuccess: () => mutate() });
  const unread = (data || []).filter((n) => !n.read).length;
  const open = async (o) => {
    if (!o && unread) { await http.post("/notifications/read"); mutate(); }
  };
  return (
    <Popover onOpenChange={open}>
      <PopoverTrigger asChild>
        <button data-testid="notifications-bell" className="relative h-10 w-10 rounded-full bg-white/5 hover:bg-white/10 grid place-items-center transition-colors">
          <Bell className="h-4 w-4" />
          {unread > 0 && <span data-testid="notifications-count" className="absolute -top-0.5 -right-0.5 h-5 min-w-5 px-1 rounded-full bg-rose-500 text-[10px] font-bold grid place-items-center">{unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-[#0E1524]" data-testid="notifications-panel">
        <div className="px-4 py-3 border-b border-white/5 text-sm font-semibold">Alerts</div>
        <div className="max-h-80 overflow-auto">
          {(data || []).length === 0 && <p className="p-4 text-sm text-slate-400">No alerts yet. You're all calm.</p>}
          {(data || []).map((n) => (
            <div key={n.notif_id} className={`px-4 py-3 border-b border-white/5 ${n.read ? "opacity-60" : ""}`}>
              <p className={`text-sm font-semibold ${n.severity === "high" ? "text-rose-400" : n.severity === "info" ? "text-emerald-400" : "text-amber-400"}`}>{n.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
              <p className="text-[10px] text-slate-500 mt-1">{n.day}</p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SideLink({ to, label, icon: I, ai }) {
  return (
    <NavLink to={to} data-testid={`nav-${to.slice(1)}`}
      className={({ isActive }) => `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors ${isActive ? (ai ? "bg-violet-500/15 text-violet-200" : "bg-emerald-500/10 text-emerald-300") : "text-slate-400 hover:text-slate-100 hover:bg-white/5"}`}>
      <I className={`h-4 w-4 ${ai ? "text-violet-400" : ""}`} />{label}
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { data: summary } = useApi("/portfolio/summary", { refreshInterval: 90000 });
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r border-white/5 bg-[#060A13]/80 backdrop-blur-xl p-5">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-violet-500 grid place-items-center font-display font-bold text-slate-950">K</div>
          <div><p className="font-display text-sm">Kuber Crypto</p><p className="text-[11px] text-slate-500">Portfolio health analyst</p></div>
        </div>
        <nav className="space-y-1 flex-1">{NAV.map((n) => <SideLink key={n.to} {...n} />)}</nav>
        <div className="flex items-center gap-3 px-2 pt-4 border-t border-white/5">
          {user?.picture ? <img src={user.picture} alt="" className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-white/10 grid place-items-center text-xs font-bold">{user?.name?.[0]}</div>}
          <div className="flex-1 min-w-0"><p className="text-sm truncate" data-testid="sidebar-user-name">{user?.name}</p><p className="text-[11px] text-slate-500 truncate">{user?.email}</p></div>
          <button data-testid="logout-btn" onClick={async () => { await logout(); nav("/login"); }} className="text-slate-500 hover:text-rose-400 transition-colors"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-8 py-4 bg-[#070B14]/70 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-2 lg:hidden">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-violet-500 grid place-items-center font-display font-bold text-slate-950 text-sm">K</div>
          <span className="font-display text-sm">Kuber</span>
        </div>
        <div className="hidden lg:block"><PriceStatus status={summary?.price_status} updated={summary?.updated_at} /></div>
        <div className="flex items-center gap-2">
          <div className="lg:hidden"><PriceStatus status={summary?.price_status} compact /></div>
          <Notifications />
          <button onClick={async () => { await logout(); nav("/login"); }} className="lg:hidden h-10 w-10 rounded-full bg-white/5 grid place-items-center" data-testid="mobile-logout-btn"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="px-4 sm:px-8 py-6 pb-28 lg:pb-10 max-w-[1600px]"><Outlet /></main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#060A13]/95 backdrop-blur-xl border-t border-white/5 flex overflow-x-auto gap-1 px-2 py-2">
        {NAV.map(({ to, short, icon: I, ai }) => (
          <NavLink key={to} to={to} data-testid={`mobile-nav-${to.slice(1)}`} className={({ isActive }) => `shrink-0 min-w-[62px] flex flex-col items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] ${isActive ? (ai ? "text-violet-300" : "text-emerald-300") : "text-slate-500"}`}>
            <I className="h-5 w-5" />{short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
