import { Link } from "react-router-dom";
import { Eye, Lightbulb, Sparkles, AlertCircle } from "lucide-react";
import { useApi } from "@/lib/api";
import { PageTitle, Skeleton, EmptyPortfolio, ErrorBox } from "@/components/Bits";
import { ScoreRing, riskTone } from "@/components/Charts";
import { Button } from "@/components/ui/button";

function Category({ c, i }) {
  const pct = (c.score / c.max) * 100;
  const col = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="k-card p-5 fade-up" style={{ animationDelay: `${0.1 + i * 0.07}s` }} data-testid={`health-category-${c.key}`}>
      <div className="flex items-center justify-between">
        <p className="font-semibold">{c.name}</p>
        <p className="font-mono-num"><span className="text-xl" data-testid={`health-category-score-${c.key}`}>{c.score}</span><span className="text-slate-500 text-sm">/{c.max}</span></p>
      </div>
      <div className="h-2 bg-white/5 rounded-full mt-3 overflow-hidden"><div className={`h-full ${col} rounded-full`} style={{ width: `${pct}%`, transition: "width 1s ease" }} /></div>
      <p className="text-sm text-slate-400 mt-3 leading-relaxed">{c.explanation}</p>
      {c.insufficient_data && <p className="text-xs text-amber-400 mt-2 flex items-center gap-1"><AlertCircle className="h-3 w-3" />Insufficient historical data</p>}
      {c.using_default_targets && <Link to="/settings" className="text-xs text-emerald-400 mt-2 inline-block hover:underline" data-testid="set-targets-link">Set your target allocation →</Link>}
    </div>
  );
}

function ListCard({ title, icon: I, items, color, testid }) {
  return (
    <div className="k-card p-6 fade-up" data-testid={testid}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${color}`}><I className="h-4 w-4" />{title}</div>
      <ol className="mt-4 space-y-3">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-sm text-slate-300"><span className="font-mono-num text-slate-500">0{i + 1}</span><span>{t}</span></li>
        ))}
      </ol>
    </div>
  );
}

function Deviations({ rows, custom }) {
  return (
    <div className="k-card p-6 fade-up" data-testid="allocation-deviations">
      <p className="font-semibold">Allocation vs {custom ? "your target" : "equal weight"}</p>
      <div className="mt-4 space-y-3">
        {rows.map((d) => (
          <div key={d.coin_id} className="grid grid-cols-[60px_1fr_70px] items-center gap-3 text-sm">
            <span className="uppercase font-semibold">{d.symbol}</span>
            <div className="relative h-2 bg-white/5 rounded-full">
              <div className="absolute h-2 rounded-full bg-emerald-500/70" style={{ width: `${Math.min(100, d.actual)}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-white" style={{ left: `${Math.min(100, d.target)}%` }} title="target" />
            </div>
            <span className={`font-mono-num text-right ${Math.abs(d.diff) >= 10 ? "text-amber-400" : "text-slate-400"}`}>{d.diff > 0 ? "+" : ""}{d.diff.toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-4">Bar = actual share, white line = target. Gaps of 10%+ are highlighted.</p>
    </div>
  );
}

export default function Health() {
  const { data, error, isLoading, mutate } = useApi("/portfolio/health");
  if (error) return <ErrorBox error={error} retry={mutate} />;
  if (isLoading) return <Skeleton className="h-96" />;
  const h = data.health;
  if (!h) return (<><PageTitle title="Portfolio Health" sub="Your personalised diagnosis appears once you add holdings." /><EmptyPortfolio message="Add holdings to calculate your portfolio health. The score is only ever calculated from investments you have saved." /></>);
  const custom = !h.categories.find((c) => c.key === "allocation").using_default_targets;
  return (
    <div className="space-y-5">
      <PageTitle title="Portfolio Health" sub="A 0–100 score across four dimensions, calculated from your actual holdings and recent prices." />
      <div className="k-card p-6 sm:p-8 grid md:grid-cols-[auto_1fr] gap-8 items-center fade-up relative overflow-hidden" data-testid="health-hero">
        <ScoreRing score={h.score} size={200} stroke={16} />
        <div>
          <span data-testid="health-risk-label" className={`inline-block rounded-full px-4 py-1.5 text-sm font-semibold ${riskTone(h.risk)}`}>{h.risk}</span>
          <p className="text-xs text-slate-500 uppercase tracking-wider mt-5">Your investor persona</p>
          <p className="font-display text-2xl mt-1" data-testid="health-persona">{h.persona.title}</p>
          <p className="text-slate-400 text-sm mt-1">{h.persona.tagline}</p>
          <p className="text-sm text-slate-300 mt-5 max-w-xl">Why this score: {h.categories.map((c) => `${c.name} ${c.score}/25`).join(" + ")} = <span className="font-semibold">{h.score}</span>. 70+ is Healthy, 45–69 Moderate, below 45 High Risk.</p>
          <Button asChild variant="outline" className="mt-5 rounded-full bg-violet-500/10 border-violet-500/30 text-violet-200 hover:bg-violet-500/20">
            <Link to="/analyst?q=Explain%20my%20portfolio%20health%20score" data-testid="explain-score-ai-btn"><Sparkles className="h-4 w-4 mr-2" />Ask AI to explain my score</Link>
          </Button>
        </div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      </div>
      <div className="grid md:grid-cols-2 gap-5">{h.categories.map((c, i) => <Category key={c.key} c={c} i={i} />)}</div>
      <div className="grid md:grid-cols-2 gap-5">
        <ListCard title="Key observations" icon={Eye} items={h.observations} color="text-blue-300" testid="health-observations" />
        <ListCard title="Things to consider" icon={Lightbulb} items={h.suggestions} color="text-emerald-300" testid="health-suggestions" />
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <Deviations rows={h.deviations} custom={custom} />
        <div className="k-card p-6 fade-up" data-testid="asset-volatility">
          <p className="font-semibold">Volatility by asset <span className="text-xs text-slate-500 font-normal">(30-day, annualised)</span></p>
          {h.asset_volatility.length === 0 ? <p className="text-sm text-slate-500 mt-4">Historical price data is insufficient to estimate volatility right now.</p> : (
            <div className="mt-4 space-y-3">
              {h.asset_volatility.map((a) => (
                <div key={a.coin_id} className="grid grid-cols-[60px_1fr_60px] items-center gap-3 text-sm">
                  <span className="uppercase font-semibold">{a.symbol}</span>
                  <div className="h-2 bg-white/5 rounded-full"><div className={`h-2 rounded-full ${a.vol > 90 ? "bg-rose-500" : a.vol > 55 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, a.vol / 1.5)}%` }} /></div>
                  <span className="font-mono-num text-right text-slate-400">{a.vol.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
          {data.volatility_missing?.length > 0 && <p className="text-xs text-amber-400 mt-3">No history for: {data.volatility_missing.join(", ")}</p>}
        </div>
      </div>
      <p className="text-xs text-slate-500" data-testid="health-disclaimer">{h.disclaimer}</p>
    </div>
  );
}
