import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Database, AlertTriangle } from "lucide-react";

export function PriceStatus({ status, updated, compact }) {
  if (!status) return null;
  const map = {
    live: { t: "Live prices", c: "text-emerald-400 bg-emerald-500/10", I: Wifi },
    stale: { t: "Cached prices", c: "text-amber-400 bg-amber-500/10", I: Database },
    demo: { t: "DEMO prices (live feed unavailable)", c: "text-rose-300 bg-rose-500/10", I: WifiOff },
  };
  const m = map[status] || map.live;
  return (
    <span data-testid="price-status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${m.c}`}>
      <m.I className="h-3 w-3" />{compact ? (status === "live" ? "Live" : status === "stale" ? "Cached" : "Demo") : m.t}
      {!compact && updated && status === "live" && <span className="text-slate-500">· {new Date(updated).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
    </span>
  );
}

export function PageTitle({ title, sub, children, ai }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 fade-up">
      <div>
        <h1 className={`font-display text-2xl sm:text-3xl ${ai ? "bg-gradient-to-r from-violet-300 to-blue-300 bg-clip-text text-transparent" : ""}`}>{title}</h1>
        {sub && <p className="text-slate-400 text-sm mt-2 max-w-2xl">{sub}</p>}
      </div>
      {children && <div className="flex gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export const Skeleton = ({ className = "h-24" }) => <div className={`shimmer ${className}`} />;

export function EmptyPortfolio({ onDemo, onAdd }) {
  return (
    <div className="k-card p-10 sm:p-14 text-center fade-up" data-testid="empty-portfolio">
      <div className="coin-float mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 grid place-items-center font-display text-3xl text-amber-950 shadow-[0_0_60px_rgba(245,158,11,0.35)]">₹</div>
      <h2 className="font-display text-xl mt-6">Your vault is empty</h2>
      <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">Add three coins and Kuber will instantly diagnose your portfolio's health. Or load a sample portfolio to explore.</p>
      <div className="flex gap-3 justify-center mt-7 flex-wrap">
        {onAdd ? <Button data-testid="empty-add-holding-btn" onClick={onAdd} className="rounded-full px-6">Add your first coin</Button>
          : <Button asChild className="rounded-full px-6"><Link to="/portfolio" data-testid="empty-go-portfolio-btn">Add your first coin</Link></Button>}
        {onDemo && <Button data-testid="load-demo-btn" variant="outline" onClick={onDemo} className="rounded-full px-6 bg-transparent">Load sample portfolio</Button>}
      </div>
    </div>
  );
}

export function ErrorBox({ error, retry }) {
  return (
    <div className="k-card p-6 flex items-center gap-4 text-sm" data-testid="error-box">
      <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
      <span className="text-slate-300 flex-1">Couldn't load this data right now. {error?.response?.data?.detail || "Please check your connection."}</span>
      {retry && <Button size="sm" variant="outline" onClick={retry} className="bg-transparent">Retry</Button>}
    </div>
  );
}

export function CoinIcon({ h, size = 9 }) {
  const cls = "rounded-full shrink-0";
  const st = { width: size * 4, height: size * 4 };
  return h.image ? <img src={h.image} alt="" className={cls} style={st} /> :
    <div style={st} className={`${cls} bg-gradient-to-br from-slate-600 to-slate-800 grid place-items-center text-[10px] font-bold uppercase`}>{h.symbol?.slice(0, 3)}</div>;
}
