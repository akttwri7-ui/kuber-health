import { Link } from "react-router-dom";
import { useSWRConfig } from "swr";
import { ArrowUpRight, Sparkles, CalendarDays, TrendingUp, TrendingDown } from "lucide-react";
import { useApi, fmtINR, fmtPct, fmtSigned, tone } from "@/lib/api";
import { PageTitle, Skeleton, EmptyPortfolio, ErrorBox, CoinIcon } from "@/components/Bits";
import { PerformanceChart, AllocationChart, ScoreRing, riskTone } from "@/components/Charts";

export const useRefreshAll = () => {
  const { mutate } = useSWRConfig();
  return () => mutate(() => true);
};

function Stat({ label, value, sub, subTone, testid, big, delay }) {
  return (
    <div className={`k-card p-5 fade-up ${big ? "col-span-2" : ""}`} style={{ animationDelay: delay }} data-testid={testid}>
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`font-mono-num mt-2 ${big ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"} ${subTone && !sub ? subTone : ""}`}>{value}</p>
      {sub && <p className={`text-sm mt-1 font-mono-num ${subTone}`}>{sub}</p>}
    </div>
  );
}

function HealthTeaser() {
  const { data } = useApi("/portfolio/health");
  const h = data?.health;
  if (!h) return <Skeleton className="h-full min-h-[220px]" />;
  return (
    <Link to="/health" data-testid="dashboard-health-card" className="k-card p-6 flex flex-col sm:flex-row items-center gap-6 hover:border-emerald-500/30 transition-colors fade-up group">
      <ScoreRing score={h.score} size={130} stroke={11} />
      <div className="flex-1">
        <div className="flex items-center gap-2"><p className="text-xs text-slate-500 uppercase tracking-wider">Portfolio health</p><ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition-colors" /></div>
        <span className={`inline-block mt-2 rounded-full px-3 py-1 text-xs font-semibold ${riskTone(h.risk)}`}>{h.risk}</span>
        <p className="font-display text-base mt-3">{h.persona.title}</p>
        <p className="text-sm text-slate-400 mt-1">{h.observations[0]}</p>
      </div>
    </Link>
  );
}

function Weekly({ w }) {
  return (
    <div className="k-card p-6 fade-up" data-testid="weekly-summary">
      <div className="flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wider"><CalendarDays className="h-4 w-4" />This week</div>
      <p className={`font-mono-num text-2xl mt-3 ${tone(w.change)}`}>{fmtSigned(w.change)}</p>
      <p className={`text-sm font-mono-num ${tone(w.change_pct)}`}>{fmtPct(w.change_pct)} over 7 days</p>
      <div className="grid grid-cols-2 gap-3 mt-5">
        {w.best && <div className="rounded-xl bg-emerald-500/10 p-3"><p className="text-[11px] text-slate-400 flex items-center gap-1"><TrendingUp className="h-3 w-3" />Best</p><p className="text-sm font-semibold mt-1">{w.best.symbol} <span className={tone(w.best.change)}>{fmtPct(w.best.change)}</span></p></div>}
        {w.worst && <div className="rounded-xl bg-rose-500/10 p-3"><p className="text-[11px] text-slate-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" />Worst</p><p className="text-sm font-semibold mt-1">{w.worst.symbol} <span className={tone(w.worst.change)}>{fmtPct(w.worst.change)}</span></p></div>}
      </div>
    </div>
  );
}

function AITeaser() {
  return (
    <Link to="/analyst" className="k-card-ai p-6 block fade-up group" data-testid="dashboard-ai-card">
      <div className="flex items-center gap-2 text-violet-300 text-xs uppercase tracking-wider"><Sparkles className="h-4 w-4" />Kuber AI</div>
      <p className="font-display text-lg mt-3">"Am I overexposed to any coin?"</p>
      <p className="text-sm text-slate-400 mt-2">Ask anything about your portfolio — answers use only your real numbers.</p>
      <span className="inline-flex items-center gap-1 text-sm text-violet-300 mt-4 group-hover:gap-2 transition-all">Ask the analyst <ArrowUpRight className="h-4 w-4" /></span>
    </Link>
  );
}

export function HoldingsMini({ rows }) {
  return (
    <div className="k-card p-2 sm:p-4 fade-up" data-testid="dashboard-holdings">
      <div className="flex items-center justify-between px-3 py-2"><h3 className="font-semibold">Holdings</h3><Link to="/portfolio" className="text-sm text-emerald-400 hover:underline" data-testid="view-all-holdings">Manage</Link></div>
      {rows.map((h) => (
        <div key={h.holding_id} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/[0.03] transition-colors">
          <CoinIcon h={h} />
          <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{h.name}</p><p className="text-xs text-slate-500 font-mono-num">{fmtINR(h.current_price, true)} <span className={tone(h.change_24h)}>{fmtPct(h.change_24h)}</span></p></div>
          <div className="text-right"><p className="font-mono-num text-sm">{fmtINR(h.value)}</p><p className={`text-xs font-mono-num ${tone(h.pnl)}`}>{fmtPct(h.pnl_pct)}</p></div>
        </div>
      ))}
    </div>
  );
}

export function Overview({ s }) {
  return (
    <div className="space-y-5 mb-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <Stat big label="Total value" value={fmtINR(s.total_value)} sub={`${fmtSigned(s.change_24h)} (${fmtPct(s.change_24h_pct)}) 24h`} subTone={tone(s.change_24h)} testid="stat-total-value" />
        <Stat label="Invested" value={fmtINR(s.total_invested)} testid="stat-invested" />
        <Stat label="Unrealised P&L" value={fmtSigned(s.pnl)} subTone={tone(s.pnl)} testid="stat-pnl" />
        <Stat label="P&L %" value={fmtPct(s.pnl_pct)} subTone={tone(s.pnl_pct)} testid="stat-pnl-pct" />
        <Stat label="24h change" value={fmtPct(s.change_24h_pct)} subTone={tone(s.change_24h_pct)} testid="stat-24h" />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><PerformanceChart /></div>
        <AllocationChart holdings={s.holdings} />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><HealthTeaser /></div>
        <Weekly w={s.weekly} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: s, error, isLoading, mutate } = useApi("/portfolio/summary");
  if (error) return <ErrorBox error={error} retry={mutate} />;
  if (isLoading) return <div className="grid sm:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}<Skeleton className="h-72 sm:col-span-4" /></div>;
  if (!s.holdings.length) return (<><PageTitle title="Dashboard" sub="Your crypto portfolio at a glance." /><EmptyPortfolio /></>);
  return (
    <div className="space-y-5">
      <PageTitle title="Dashboard" sub="How is my portfolio doing, how risky is it, and what needs attention?" />
      {s.missing_prices.length > 0 && <ErrorBox error={{ response: { data: { detail: `No price available for ${s.missing_prices.join(", ")} — excluded from value.` } } }} />}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <Stat big label="Total value" value={fmtINR(s.total_value)} sub={`${fmtSigned(s.change_24h)} (${fmtPct(s.change_24h_pct)}) 24h`} subTone={tone(s.change_24h)} testid="stat-total-value" />
        <Stat label="Invested" value={fmtINR(s.total_invested)} testid="stat-invested" delay=".05s" />
        <Stat label="Profit / Loss" value={fmtSigned(s.pnl)} subTone={tone(s.pnl)} testid="stat-pnl" delay=".1s" />
        <Stat label="P&L %" value={fmtPct(s.pnl_pct)} subTone={tone(s.pnl_pct)} testid="stat-pnl-pct" delay=".15s" />
        <Stat label="24h change" value={fmtPct(s.change_24h_pct)} subTone={tone(s.change_24h_pct)} testid="stat-24h" delay=".2s" />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><PerformanceChart /></div>
        <AllocationChart holdings={s.holdings} />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><HealthTeaser /></div>
        <Weekly w={s.weekly} />
      </div>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2"><HoldingsMini rows={s.holdings} /></div>
        <AITeaser />
      </div>
    </div>
  );
}
