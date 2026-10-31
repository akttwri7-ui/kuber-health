import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, CandlestickChart, Globe, FileText, Link2, Plus, Sparkles, Loader2, Wallet, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi, fmtINR, fmtPct, fmtSigned, tone } from "@/lib/api";
import { streamSSE } from "@/lib/stream";
import { Skeleton, ErrorBox, PriceStatus } from "@/components/Bits";
import NewsList from "@/components/NewsList";
import Md from "@/components/Md";
import HoldingDialog from "@/components/HoldingDialog";
import { useRefreshAll } from "@/pages/Dashboard";

const PERIODS = [["24H", "1"], ["7D", "7"], ["30D", "30"], ["90D", "90"], ["1Y", "365"], ["All", "max"]];
const num = (v) => (v == null ? "Not available" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const dt = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

function History({ id, symbol }) {
  const [days, setDays] = useState("30");
  const { data, isLoading } = useApi(`/coins/${id}/history?days=${days}&symbol=${symbol}`);
  const pts = (data?.points || []).map(([t, v]) => ({ t, v }));
  const up = (data?.change_pct ?? 0) >= 0;
  const color = up ? "#10B981" : "#F43F5E";
  return (
    <div className="k-card p-5 sm:p-6 fade-up" data-testid="coin-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-5 text-sm">
          <div><p className="text-[11px] text-slate-500 uppercase">Change</p><p className={`font-mono-num ${tone(data?.change_pct)}`} data-testid="period-change">{fmtPct(data?.change_pct)}</p></div>
          <div><p className="text-[11px] text-slate-500 uppercase">High</p><p className="font-mono-num">{fmtINR(data?.high, data?.high < 100)}</p></div>
          <div><p className="text-[11px] text-slate-500 uppercase">Low</p><p className="font-mono-num">{fmtINR(data?.low, data?.low < 100)}</p></div>
        </div>
        <div className="flex bg-white/5 rounded-full p-1">{PERIODS.map(([l, d]) => (
          <button key={d} onClick={() => setDays(d)} data-testid={`history-period-${l}`} className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-semibold transition-colors ${days === d ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>{l}</button>))}</div>
      </div>
      <div className="h-72 mt-4">
        {isLoading ? <Skeleton className="h-full" /> : pts.length < 2 ? <div className="h-full grid place-items-center text-sm text-slate-500">Historical data is unavailable for this period.</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pts}>
              <defs><linearGradient id="ch" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleDateString("en-IN", days === "1" ? { hour: "2-digit", minute: "2-digit" } : days === "max" || days === "365" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" })} tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={50} />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip labelFormatter={(t) => new Date(t).toLocaleString("en-IN")} formatter={(v) => [fmtINR(v, v < 100), "Price"]} contentStyle={{ background: "#0B1220", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, fontSize: 12 }} />
              <Area type="monotone" dataKey="v" stroke={color} fill="url(#ch)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      {data?.source && <p className="text-[11px] text-slate-500 mt-2">Source: {data.source}{days === "max" && data.first_date ? ` · history available from ${dt(data.first_date)}` : ""}</p>}
    </div>
  );
}

function Research({ id, symbol }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (refresh) => {
    setText(""); setErr(""); setBusy(true);
    try { await streamSSE(`/coins/${id}/research`, { symbol, refresh }, (d) => setText((t) => t + d)); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="k-card-ai p-5 sm:p-6 fade-up" data-testid="ai-research">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold text-violet-200"><Sparkles className="h-4 w-4" />AI research summary</p>
        {text && !busy && <Button size="sm" variant="ghost" onClick={() => run(true)} className="text-violet-300" data-testid="research-refresh-btn"><RefreshCw className="h-3.5 w-3.5 mr-1" />Regenerate</Button>}
      </div>
      {!text && !busy && <div className="mt-4"><p className="text-sm text-slate-400">Kuber AI reads this coin's verified market data and the latest headlines, then explains it simply.</p>
        <Button onClick={() => run(false)} className="mt-4 rounded-full bg-violet-500 hover:bg-violet-400" data-testid="research-generate-btn"><Sparkles className="h-4 w-4 mr-2" />Generate research</Button></div>}
      {busy && !text && <p className="mt-4 text-sm text-violet-300 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Reading market data and news…</p>}
      {text && <div className="mt-4" data-testid="research-text"><Md text={text} /></div>}
      {err && <p className="text-sm text-rose-400 mt-3">{err}</p>}
      <p className="text-[10px] text-slate-500 mt-4 border-t border-white/5 pt-3">AI interpretation — not verified reporting and not financial advice. Verified figures are shown in the Key stats and About sections.</p>
    </div>
  );
}

function Stat({ l, v, testid }) {
  return <div className="rounded-xl bg-white/[0.03] p-3.5" data-testid={testid}><p className="text-[11px] text-slate-500 uppercase tracking-wider">{l}</p><p className="font-mono-num text-sm mt-1 break-words">{v}</p></div>;
}

export default function CoinDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const symbol = sp.get("symbol") || "";
  const { data: d, error, isLoading, mutate } = useApi(`/coins/${id}/detail?symbol=${symbol}`);
  const { data: news, isLoading: nl } = useApi(d ? `/coins/${id}/news?name=${encodeURIComponent(d.name)}&symbol=${d.symbol}` : null);
  const [add, setAdd] = useState(false);
  const refresh = useRefreshAll();
  if (error) return <div className="space-y-4"><Link to="/home" className="text-sm text-slate-400">← Back to Explore</Link><ErrorBox error={error} retry={mutate} /></div>;
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-80" /></div>;
  const sym = d.symbol.toUpperCase();
  const p = (v) => fmtINR(v, v != null && v < 100);
  return (
    <div className="space-y-5">
      <Link to="/home" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-emerald-400 transition-colors" data-testid="back-to-explore"><ArrowLeft className="h-4 w-4" />Explore</Link>
      <div className="k-card p-6 flex flex-col lg:flex-row lg:items-center gap-6 fade-up" data-testid="coin-header">
        <div className="flex items-center gap-4 flex-1">
          {d.image ? <img src={d.image} alt="" className="h-14 w-14 rounded-full" /> : <div className="h-14 w-14 rounded-full bg-white/10" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="font-display text-2xl sm:text-3xl" data-testid="coin-name">{d.name}</h1><span className="text-slate-500">{sym}</span>{d.rank && <span className="text-[11px] rounded-full bg-white/5 px-2 py-0.5">Rank #{d.rank}</span>}</div>
            <div className="flex items-baseline gap-3 mt-1"><p className="font-mono-num text-2xl sm:text-3xl" data-testid="coin-price">{p(d.price)}</p><p className={`font-mono-num ${tone(d.change["24h"])}`} data-testid="coin-change-24h">{fmtPct(d.change["24h"])} 24h</p></div>
            <div className="mt-2 flex items-center gap-2"><PriceStatus status={d.status === "cached" ? "stale" : "live"} /><span className="text-[11px] text-slate-500">{d.source}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="rounded-full bg-violet-500 hover:bg-violet-400"><Link to={`/chart?coin=${d.id}&symbol=${d.symbol}&name=${encodeURIComponent(d.name)}`} data-testid="open-chart-analyst-btn"><CandlestickChart className="h-4 w-4 mr-2" />AI Chart Analyst</Link></Button>
          <Button variant="outline" className="rounded-full bg-transparent" onClick={() => setAdd(true)} data-testid="add-to-portfolio-btn"><Plus className="h-4 w-4 mr-1" />Add to portfolio</Button>
        </div>
      </div>
      {d.holding && (
        <Link to="/portfolio" className="k-card p-4 flex items-center gap-3 border-emerald-500/30 fade-up" data-testid="coin-holding-banner">
          <Wallet className="h-5 w-5 text-emerald-400" /><span className="text-sm flex-1">You hold <b className="font-mono-num">{d.holding.quantity} {sym}</b> worth <b className="font-mono-num">{fmtINR(d.holding.value)}</b> · avg cost {p(d.holding.avg_price)}</span>
          <span className={`font-mono-num text-sm ${tone(d.holding.pnl)}`}>{fmtSigned(d.holding.pnl)}</span>
        </Link>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["1y", "1Y"]].map(([k, l]) => (
          <div key={k} className="k-card p-4" data-testid={`perf-${k}`}><p className="text-[11px] text-slate-500 uppercase">{l} performance</p><p className={`font-mono-num text-lg mt-1 ${tone(d.change[k])}`}>{d.change[k] == null ? "N/A" : fmtPct(d.change[k])}</p></div>
        ))}
      </div>
      <History id={d.id} symbol={d.symbol} />
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5">
        <div className="space-y-5">
          <div className="k-card p-5 sm:p-6 fade-up" data-testid="coin-stats">
            <p className="font-semibold mb-4">Key stats <span className="text-[11px] text-slate-500 font-normal">(verified market data)</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat l="Market cap" v={p(d.market_cap)} testid="stat-mcap" />
              <Stat l="Fully diluted val." v={d.fdv ? p(d.fdv) : "Not available"} />
              <Stat l="24h volume" v={p(d.volume)} />
              <Stat l="Circulating supply" v={num(d.circulating_supply)} />
              <Stat l="Total supply" v={num(d.total_supply)} />
              <Stat l="Max supply" v={d.max_supply ? num(d.max_supply) : "No fixed cap / N/A"} />
              <Stat l="All-time high" v={d.ath ? `${p(d.ath)} · ${dt(d.ath_date)}` : "Not available"} testid="stat-ath" />
              <Stat l="All-time low" v={d.atl ? `${p(d.atl)} · ${dt(d.atl_date)}` : "Not available"} testid="stat-atl" />
              <Stat l="From ATH" v={d.ath_change != null ? fmtPct(d.ath_change) : "—"} />
              {d.high_24h != null && <Stat l="24h high / low" v={`${p(d.high_24h)} / ${p(d.low_24h)}`} />}
              {d.circulating_supply && d.max_supply ? <Stat l="Supply issued" v={`${((d.circulating_supply / d.max_supply) * 100).toFixed(1)}% of max`} /> : null}
            </div>
          </div>
          <div className="k-card p-5 sm:p-6 fade-up" data-testid="coin-about">
            <p className="font-semibold">About {d.name}</p>
            <p className="text-sm text-slate-400 mt-3 leading-relaxed whitespace-pre-line line-clamp-[12]">{d.description || "No project description is available from our data provider."}</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-5 text-sm">
              <Stat l="Launch / genesis" v={d.genesis_date ? dt(d.genesis_date) : "Not available"} />
              <Stat l="Algorithm / consensus" v={d.hashing_algorithm || d.platforms?.join(", ") || "Not available"} />
            </div>
            {d.categories?.length > 0 && <div className="flex flex-wrap gap-2 mt-4">{d.categories.map((c) => <span key={c} className="text-[11px] rounded-full bg-white/5 px-2.5 py-1 text-slate-300">{c}</span>)}</div>}
            <div className="flex flex-wrap gap-2 mt-5" data-testid="coin-links">
              {d.website && <a href={d.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-full border border-white/10 px-3 py-1.5 hover:border-emerald-500/40"><Globe className="h-3.5 w-3.5" />Website</a>}
              {d.whitepaper && <a href={d.whitepaper} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-full border border-white/10 px-3 py-1.5 hover:border-emerald-500/40"><FileText className="h-3.5 w-3.5" />Whitepaper</a>}
              {[...d.socials, ...d.explorers.map((u) => ({ name: "Explorer", url: u }))].map((s, i) => <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs rounded-full border border-white/10 px-3 py-1.5 hover:border-emerald-500/40"><Link2 className="h-3.5 w-3.5" />{s.name}</a>)}
            </div>
          </div>
        </div>
        <div className="space-y-5">
          <Research id={d.id} symbol={d.symbol} />
          <NewsList items={news} loading={nl || !news} testid="coin-news" title={`${d.name} news`} />
        </div>
      </div>
      <HoldingDialog open={add} onOpenChange={setAdd} preset={{ coin_id: d.id, symbol: d.symbol, name: d.name, image: d.image, price: d.price }} onSaved={() => { refresh(); }} />
    </div>
  );
}
