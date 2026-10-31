import { Link } from "react-router-dom";
import { ShieldAlert, ShieldCheck, TrendingDown, Activity, PieChart } from "lucide-react";
import { useApi, fmtINR, fmtPct, fmtSigned, tone } from "@/lib/api";
import { PageTitle, Skeleton, EmptyPortfolio, ErrorBox } from "@/components/Bits";

const sevCls = { high: "border-rose-500/40 bg-rose-500/10 text-rose-200", medium: "border-amber-500/40 bg-amber-500/10 text-amber-100", info: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
const typeIcon = { drawdown: TrendingDown, move: Activity, concentration: PieChart };

export default function Risk() {
  const { data: r, error, isLoading, mutate } = useApi("/risk");
  if (error) return <ErrorBox error={error} retry={mutate} />;
  if (isLoading) return <Skeleton className="h-96" />;
  if (!r.allocations.length) return (<><PageTitle title="Risk Monitor" /><EmptyPortfolio message="Risk alerts are only generated from your saved holdings. Add your investments to start monitoring drawdowns and concentration." /></>);
  const thr = r.settings.drawdown_thresholds;
  const limit = r.settings.concentration_limit;
  const dd = r.drawdown_30d;
  return (
    <div className="space-y-5">
      <PageTitle title="Risk Monitor" sub="In-app alerts based on your own thresholds. Checked every time prices refresh.">
        <Link to="/settings" className="text-sm text-emerald-400 hover:underline" data-testid="edit-thresholds-link">Edit thresholds</Link>
      </PageTitle>

      <div className="space-y-3" data-testid="active-alerts">
        {r.alerts.length === 0 ? (
          <div className="k-card p-5 flex items-center gap-3 text-emerald-200" data-testid="no-alerts"><ShieldCheck className="h-5 w-5 text-emerald-400" />No thresholds breached right now. Nice and steady.</div>
        ) : r.alerts.map((a) => {
          const I = typeIcon[a.type] || ShieldAlert;
          return (
            <div key={a.key} className={`rounded-2xl border p-4 flex gap-3 fade-up ${sevCls[a.severity]}`} data-testid={`alert-${a.key}`}>
              <I className="h-5 w-5 shrink-0 mt-0.5" />
              <div><p className="font-semibold text-sm">{a.title}</p><p className="text-sm opacity-80 mt-0.5">{a.message}</p></div>
            </div>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="k-card p-6 fade-up" data-testid="drawdown-card">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Drawdown from 30-day peak</p>
          {dd == null ? <p className="text-sm text-slate-400 mt-3">Not enough price history to calculate drawdown.</p> : (
            <>
              <p className={`font-mono-num text-3xl mt-2 ${dd > 0 ? "text-rose-400" : "text-emerald-400"}`} data-testid="drawdown-value">{dd > 0 ? "-" : ""}{dd.toFixed(2)}%</p>
              <p className="text-sm text-slate-500 mt-1">Peak {fmtINR(r.peak_30d)} → now {fmtINR(r.total_value)}</p>
              <div className="relative h-3 bg-white/5 rounded-full mt-6">
                <div className="absolute h-3 rounded-full bg-gradient-to-r from-amber-500 to-rose-500" style={{ width: `${Math.min(100, (dd / Math.max(...thr, 20)) * 100)}%` }} />
                {thr.map((t) => <div key={t} className="absolute -top-1 h-5 w-0.5 bg-white/60" style={{ left: `${(t / Math.max(...thr, 20)) * 100}%` }} />)}
              </div>
              <div className="relative h-5 mt-1 text-[11px] text-slate-500">{thr.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: `${(t / Math.max(...thr, 20)) * 100}%` }}>{t}%</span>)}</div>
            </>
          )}
        </div>
        <div className="k-card p-6 fade-up" data-testid="change-card">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Last 24 hours</p>
          <p className={`font-mono-num text-3xl mt-2 ${tone(r.change_24h)}`}>{fmtPct(r.change_24h_pct)}</p>
          <p className={`text-sm mt-1 font-mono-num ${tone(r.change_24h)}`}>{fmtSigned(r.change_24h)}</p>
          <p className="text-sm text-slate-500 mt-4">Moves larger than {thr[0]}% in a day trigger an alert.</p>
        </div>
      </div>

      <div className="k-card p-6 fade-up" data-testid="concentration-card">
        <p className="font-semibold">Concentration check <span className="text-xs text-slate-500 font-normal">(limit {limit}%)</span></p>
        <div className="mt-4 space-y-3">
          {r.allocations.map((a) => (
            <div key={a.symbol} className="grid grid-cols-[60px_1fr_60px] items-center gap-3 text-sm">
              <span className="font-semibold">{a.symbol}</span>
              <div className="relative h-2.5 bg-white/5 rounded-full">
                <div className={`h-2.5 rounded-full ${a.allocation > limit ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${a.allocation}%` }} />
                <div className="absolute -top-1 h-4.5 w-0.5 bg-white/50 h-5" style={{ left: `${limit}%` }} />
              </div>
              <span className={`font-mono-num text-right ${a.allocation > limit ? "text-rose-400" : "text-slate-400"}`}>{a.allocation.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
