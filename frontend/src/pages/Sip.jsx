import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import { Sparkles, Loader2, ChevronDown, ShieldAlert, TrendingUp, TrendingDown, Minus, Info, Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { http, errMsg, fmtINR, fmtPct, tone } from "@/lib/api";
import { streamSSE } from "@/lib/stream";
import { PageTitle, Skeleton } from "@/components/Bits";
import CoinSearch from "@/components/CoinSearch";
import Md from "@/components/Md";

const STATUS = {
  "ACCUMULATE THROUGH SIP": "from-emerald-500/25 to-emerald-500/5 text-emerald-200 border-emerald-500/40",
  "LUMP SUM ENTRY": "from-blue-500/25 to-blue-500/5 text-blue-200 border-blue-500/40",
  "HYBRID STRATEGY": "from-violet-500/25 to-violet-500/5 text-violet-200 border-violet-500/40",
  "WAIT FOR BETTER ENTRY": "from-amber-500/25 to-amber-500/5 text-amber-200 border-amber-500/40",
  "NO NEW POSITION": "from-rose-500/25 to-rose-500/5 text-rose-200 border-rose-500/40",
  "INSUFFICIENT DATA": "from-slate-500/25 to-slate-500/5 text-slate-200 border-slate-500/40",
};
const PIE = ["#3B82F6", "#10B981", "#475569"];
const dtime = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const useDebounced = (v, ms = 600) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };

function Pills({ value, options, onChange, testid }) {
  return (
    <div className="flex flex-wrap bg-white/5 rounded-full p-1 w-fit" data-testid={testid}>
      {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} data-testid={`${testid}-${v}`} className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${value === v ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>{l}</button>)}
    </div>
  );
}

function Inputs({ s, set }) {
  return (
    <div className="k-card p-5 sm:p-6 fade-up space-y-5" data-testid="sip-inputs">
      <div><Label>Cryptocurrency</Label><div className="mt-1.5"><CoinSearch onSelect={(c) => set({ coin: { id: c.id, symbol: c.symbol, name: c.name, image: c.thumb } })} placeholder={`${s.coin.name} (${s.coin.symbol.toUpperCase()}) — search to change`} testid="sip-coin" /></div></div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div><Label>Chart-analysis timeframe</Label><div className="mt-1.5"><Pills value={s.interval} onChange={(v) => set({ interval: v })} options={[["1h", "1H"], ["4h", "4H"], ["1d", "1D"], ["1w", "1W"]]} testid="sip-interval" /></div><p className="text-[11px] text-slate-500 mt-1.5">Short-term chart signals — separate from your horizon.</p></div>
        <div><Label>Investment horizon</Label><div className="mt-1.5"><Pills value={String(s.horizon)} onChange={(v) => set({ horizon: Number(v) })} options={[["0.5", "6M"], ["1", "1Y"], ["3", "3Y"], ["5", "5Y"]]} testid="sip-horizon" /></div></div>
        <div><Label>Risk appetite</Label><div className="mt-1.5"><Pills value={s.risk} onChange={(v) => set({ risk: v })} options={[["conservative", "Conservative"], ["moderate", "Moderate"], ["aggressive", "Aggressive"]]} testid="sip-risk" /></div></div>
        <div><Label>Available investment budget (₹)</Label><Input data-testid="sip-budget-input" type="number" min="0" className="mt-1.5 h-10 font-mono-num" placeholder="Optional — needed for ₹ amounts" value={s.budget} onChange={(e) => set({ budget: e.target.value })} /></div>
      </div>
    </div>
  );
}

function AllocPie({ a }) {
  const data = [["Lump sum now", a.lump_pct], ["Via SIP", a.sip_pct], ["Reserved", a.reserve_pct]].map(([n, v]) => ({ n, v })).filter((x) => x.v > 0);
  return (
    <div className="h-36 w-36 shrink-0 relative" data-testid="sip-alloc-pie">
      <ResponsiveContainer><PieChart><Pie data={data} dataKey="v" innerRadius="62%" outerRadius="95%" stroke="none" paddingAngle={2}>{data.map((d) => <Cell key={d.n} fill={PIE[["Lump sum now", "Via SIP", "Reserved"].indexOf(d.n)]} />)}</Pie></PieChart></ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center text-center"><div><p className="font-mono-num text-lg">{(a.lump_pct + a.sip_pct).toFixed(0)}%</p><p className="text-[10px] text-slate-500">deployed</p></div></div>
    </div>
  );
}

function AmountTable({ r }) {
  const a = r.allocation, m = r.amounts;
  const rows = [["Initial lump sum", a.lump_pct, m?.lump_sum, PIE[0]],
    [`SIP (${a.sip_months ? `${m?.instalments || ""} ${a.frequency} instalments` : "none"})`, a.sip_pct, m?.sip_total, PIE[1]],
    ["Reserved / not deployed", a.reserve_pct, m?.reserve, PIE[2]]];
  return (
    <div className="flex-1 min-w-0">
      <table className="w-full text-sm" data-testid="sip-amount-table">
        <tbody>{rows.map(([l, p, v, c]) => (
          <tr key={l} className="border-b border-white/5"><td className="py-2"><span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: c }} />{l}</td>
            <td className="text-right font-mono-num text-slate-400">{p}%</td><td className="text-right font-mono-num pl-3">{m ? fmtINR(v) : "—"}</td></tr>))}</tbody>
      </table>
      {m && a.sip_pct > 0 && <p className="text-xs text-slate-400 mt-2" data-testid="sip-per-instalment">≈ <b className="font-mono-num text-slate-200">{fmtINR(m.sip_per_instalment)}</b> per {a.frequency === "weekly" ? "week" : "month"}</p>}
      {!m && <p className="text-xs text-amber-300 mt-2 flex items-center gap-1" data-testid="sip-budget-missing"><Info className="h-3 w-3" />Enter your available budget to see rupee amounts. We never assume your capital.</p>}
      {m?.allocation_after_full_pct != null && <p className="text-[11px] text-slate-500 mt-1">{r.symbol} would be ~{m.allocation_after_full_pct.toFixed(0)}% of your tracked portfolio after full deployment.</p>}
    </div>
  );
}

function Recommendation({ r, busy, onRun, stale }) {
  if (!r) return (
    <div className="k-card-ai p-6 sm:p-8 fade-up text-center" data-testid="sip-recommendation-empty">
      <Sparkles className="h-8 w-8 mx-auto text-violet-300" />
      <p className="font-display text-lg mt-3">Should you invest now — and how much?</p>
      <p className="text-sm text-slate-400 mt-2 max-w-lg mx-auto">Kuber combines the AI Chart Analyst's indicators (trend, RSI, MACD, moving averages, ATR, volume, breakouts, divergences, higher-timeframe confirmation) with your budget, risk and portfolio.</p>
      <Button onClick={onRun} disabled={busy} className="mt-5 rounded-full bg-violet-500 hover:bg-violet-400" data-testid="sip-analyse-btn">{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}Analyse Market & Generate SIP Strategy</Button>
    </div>
  );
  return (
    <div className={`rounded-[1.1rem] border bg-gradient-to-br p-5 sm:p-7 fade-up ${STATUS[r.status]}`} data-testid="sip-recommendation">
      <div className="flex flex-col lg:flex-row lg:items-start gap-5 justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest opacity-70">AI investment recommendation · {r.name} ({r.symbol})</p>
          <p className="font-display text-2xl sm:text-3xl mt-2 text-white" data-testid="sip-status">{r.status}</p>
          <p className="text-sm text-slate-300 mt-2 max-w-2xl" data-testid="sip-market-condition">{r.insufficient ? r.reason : `Market condition: ${r.market_condition}.`}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-400">
            <span>Price <b className="font-mono-num text-slate-200" data-testid="sip-price">{fmtINR(r.price, r.price < 100)}</b></span>
            <span>Last candle {dtime(r.data_time)}</span><span>Generated {dtime(r.generated_at)}</span>
            <span>Chart {r.interval} + {r.higher_timeframe} confirmation · horizon {r.horizon_years}y · {r.risk}</span>
          </div>
        </div>
        <div className="flex flex-col items-start lg:items-end gap-2">
          {!r.insufficient && <div className="w-48" data-testid="sip-confidence"><div className="flex justify-between text-xs"><span className="opacity-70">Confidence</span><span className="font-mono-num">{r.confidence}%</span></div><div className="h-1.5 bg-white/10 rounded-full mt-1"><div className="h-1.5 rounded-full bg-white/70" style={{ width: `${r.confidence}%` }} /></div></div>}
          <Button onClick={onRun} disabled={busy} size="sm" className="rounded-full bg-white/10 hover:bg-white/20 text-white" data-testid="sip-reanalyse-btn">{busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}Analyse Market & Generate SIP Strategy</Button>
          {stale && <p className="text-[11px] text-amber-300" data-testid="sip-stale-note">Inputs changed — recommendation updated, AI explanation needs a refresh.</p>}
        </div>
      </div>
      {!r.insufficient && (
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-6 mt-6">
          <div className="rounded-2xl bg-black/20 p-4 flex flex-col sm:flex-row gap-4 items-center">
            <AllocPie a={r.allocation} /><AmountTable r={r} />
          </div>
          <div className="rounded-2xl bg-black/20 p-4" data-testid="sip-reasons">
            <p className="text-xs uppercase tracking-wider opacity-70 mb-2">Key technical reasons</p>
            <ul className="space-y-1.5 text-sm">{r.reasons.slice(0, 7).map((x, i) => {
              const I = x.impact === "positive" ? TrendingUp : x.impact === "negative" ? TrendingDown : Minus;
              return <li key={i} className="flex gap-2"><I className={`h-4 w-4 shrink-0 mt-0.5 ${x.impact === "positive" ? "text-emerald-400" : x.impact === "negative" ? "text-rose-400" : "text-slate-400"}`} /><span className="text-slate-200">{x.text}</span></li>;
            })}</ul>
          </div>
        </div>
      )}
      {r.reconsider_if?.length > 0 && <div className="mt-4 text-sm text-slate-300" data-testid="sip-reconsider"><p className="text-xs uppercase tracking-wider opacity-70 mb-1">We'd reconsider if</p>{r.reconsider_if.map((t) => <p key={t}>• {t}</p>)}</div>}
    </div>
  );
}

function Strategies({ r }) {
  if (!r || r.insufficient) return null;
  const fitCls = { high: "border-emerald-500/50 bg-emerald-500/5", medium: "border-white/10", low: "border-white/5 opacity-60" };
  const key = r.status.startsWith("WAIT") || r.status === "NO NEW POSITION" ? "WAIT / NO NEW POSITION" : r.status;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="sip-strategy-comparison">
      {Object.entries(r.strategies).map(([k, v]) => (
        <div key={k} className={`k-card p-5 border ${fitCls[v.fit]} fade-up`} data-testid={`strategy-${k.split(" ")[0].toLowerCase()}`}>
          <div className="flex items-center justify-between"><p className="font-semibold text-sm">{k}</p>{k === key && <span className="text-[10px] rounded-full bg-emerald-500 text-slate-950 px-2 py-0.5 font-bold">PICK</span>}</div>
          <p className="text-[11px] uppercase mt-2 text-slate-500">Fit now: <span className={v.fit === "high" ? "text-emerald-400" : v.fit === "medium" ? "text-amber-300" : "text-slate-500"}>{v.fit}</span></p>
          <p className="text-sm text-slate-400 mt-2">{v.summary}</p>
        </div>
      ))}
    </div>
  );
}

function Calculator({ coin }) {
  const [f, setF] = useState({ amount: "5000", dur: "2", unit: "years", freq: "monthly" });
  const months = Math.round(Number(f.dur) * (f.unit === "years" ? 12 : 1));
  const key = useDebounced(JSON.stringify({ c: coin.id, s: coin.symbol, a: f.amount, months, q: f.freq }));
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const k = JSON.parse(key);
    if (!(Number(k.a) > 0) || !(k.months >= 3 && k.months <= 120)) { setErr("Enter an amount above 0 and a duration between 3 months and 10 years."); return; }
    setErr(""); setBusy(true);
    http.post("/sip/calculate", { coin_id: k.c, symbol: k.s, amount: Number(k.a), months: k.months, frequency: k.q })
      .then(({ data }) => setRes(data)).catch((e) => setErr(errMsg(e))).finally(() => setBusy(false));
  }, [key]);
  const r = res?.available ? res : null;
  return (
    <div className="k-card p-5 sm:p-6 fade-up" data-testid="sip-calculator">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-lg">SIP & historical returns calculator</h2><p className="text-xs text-slate-500 mt-1">Simulates real periodic buys of {coin.name} using past prices, ending today.</p></div>{busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        <div><Label>{f.freq === "weekly" ? "Monthly budget (split weekly)" : "Monthly SIP"} (₹)</Label><Input data-testid="calc-amount-input" type="number" min="0" className="mt-1.5 h-10 font-mono-num" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><Label>Duration</Label><div className="flex gap-2 mt-1.5"><Input data-testid="calc-duration-input" type="number" min="1" className="h-10 font-mono-num" value={f.dur} onChange={(e) => setF({ ...f, dur: e.target.value })} />
          <select data-testid="calc-unit-select" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className="h-10 rounded-md bg-transparent border border-input px-2 text-sm"><option value="months" className="bg-slate-900">months</option><option value="years" className="bg-slate-900">years</option></select></div></div>
        <div className="col-span-2"><Label>Frequency</Label><div className="mt-1.5"><Pills value={f.freq} onChange={(v) => setF({ ...f, freq: v })} options={[["monthly", "Monthly"], ["weekly", "Weekly"]]} testid="calc-freq" /></div></div>
      </div>
      {err && <p className="text-sm text-rose-400 mt-4" data-testid="calc-error">{err}</p>}
      {res && !res.available && <p className="text-sm text-amber-300 mt-4" data-testid="calc-unavailable">{res.reason}</p>}
      {!res && !err && <Skeleton className="h-64 mt-5" />}
      {r && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
            {[["Total invested", fmtINR(r.invested), "calc-invested"], ["Value today", fmtINR(r.value), "calc-value"], ["Gain / loss", `${r.gain >= 0 ? "+" : "-"}${fmtINR(Math.abs(r.gain))}`, "calc-gain", tone(r.gain)],
              ["Absolute return", fmtPct(r.abs_return_pct), "calc-abs", tone(r.abs_return_pct)], ["CAGR", r.cagr_pct == null ? "N/A (<1 yr)" : fmtPct(r.cagr_pct), "calc-cagr", tone(r.cagr_pct)]].map(([l, v, t, c]) => (
              <div key={t} className="rounded-xl bg-white/[0.03] p-3.5" data-testid={t}><p className="text-[11px] text-slate-500 uppercase">{l}</p><p className={`font-mono-num text-lg mt-1 ${c || ""}`}>{v}</p></div>))}
          </div>
          <div className="h-64 mt-5" data-testid="calc-growth-chart">
            <ResponsiveContainer><AreaChart data={r.series}>
              <defs><linearGradient id="sipv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.3} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })} tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis hide /><Tooltip labelFormatter={(t) => new Date(t).toLocaleDateString("en-IN")} formatter={(v, n) => [fmtINR(v), n === "value" ? "Portfolio value" : "Invested"]} contentStyle={{ background: "#0B1220", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, fontSize: 12 }} />
              <Area dataKey="invested" stroke="#64748B" strokeDasharray="4 4" fill="none" isAnimationActive={false} /><Area dataKey="value" stroke="#10B981" fill="url(#sipv)" strokeWidth={2} isAnimationActive={false} />
            </AreaChart></ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-400 mt-2">{r.instalments} instalments · average cost {fmtINR(r.avg_cost, r.avg_cost < 100)} · same total as a one-time buy at the start would be worth <b className="font-mono-num">{fmtINR(r.lump_sum_value)}</b> today.</p>
          <div className="overflow-x-auto mt-6"><p className="font-semibold text-sm mb-2">Compare amounts & durations <span className="text-xs text-slate-500 font-normal">(absolute return, value today)</span></p>
            <table className="w-full min-w-[560px] text-sm" data-testid="calc-comparison"><thead><tr className="text-[11px] uppercase text-slate-500"><th className="text-left py-2">Monthly</th>{r.comparison[0].results.map((x) => <th key={x.months} className="text-right">{x.months} mo</th>)}</tr></thead>
              <tbody>{r.comparison.map((row) => <tr key={row.amount} className="border-t border-white/5"><td className="py-2.5 font-mono-num">{fmtINR(row.amount)}</td>{row.results.map((x) => <td key={x.months} className="text-right font-mono-num">{x.invested == null ? <span className="text-slate-600">no data</span> : <><span className={tone(x.abs_return_pct)}>{fmtPct(x.abs_return_pct)}</span><span className="block text-[11px] text-slate-500">{fmtINR(x.value)}</span></>}</td>)}</tr>)}</tbody></table></div>
          <p className="text-[11px] text-slate-500 mt-3">{r.source}. {r.disclaimer}</p>
        </>
      )}
    </div>
  );
}

function Explanation({ r, text, busy, onExplain }) {
  const [open, setOpen] = useState(true);
  if (!r || r.insufficient) return null;
  return (
    <div className="k-card-ai p-5 sm:p-6 fade-up" data-testid="sip-ai-explanation">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between" data-testid="sip-explanation-toggle">
        <p className="flex items-center gap-2 font-semibold text-violet-200"><Sparkles className="h-4 w-4" />AI technical analysis & risk assessment</p><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-4">
        {!text && !busy && <Button onClick={onExplain} size="sm" className="rounded-full bg-violet-500 hover:bg-violet-400" data-testid="sip-explain-btn">Generate AI explanation</Button>}
        {busy && !text && <p className="text-sm text-violet-300 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Reading the chart analysis…</p>}
        {text && <div data-testid="sip-explanation-text"><Md text={text} /></div>}
        <div className="grid sm:grid-cols-2 gap-3 mt-5 text-xs">
          <div className="rounded-xl bg-black/20 p-3"><p className="text-slate-500 uppercase mb-1">Support</p>{r.levels.support.length ? r.levels.support.map((l) => <p key={l.price} className="font-mono-num">{fmtINR(l.price, l.price < 100)} <span className="text-slate-500">({l.touches} touches)</span></p>) : <p className="text-slate-500">None identified</p>}</div>
          <div className="rounded-xl bg-black/20 p-3"><p className="text-slate-500 uppercase mb-1">Resistance</p>{r.levels.resistance.length ? r.levels.resistance.map((l) => <p key={l.price} className="font-mono-num">{fmtINR(l.price, l.price < 100)} <span className="text-slate-500">({l.touches} touches)</span></p>) : <p className="text-slate-500">None identified</p>}</div>
        </div>
      </div>}
    </div>
  );
}

export default function Sip() {
  const [s, setS] = useState({ coin: { id: "bitcoin", symbol: "btc", name: "Bitcoin" }, interval: "1d", horizon: 3, risk: "moderate", budget: "" });
  const set = (p) => setS((x) => ({ ...x, ...p }));
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [exBusy, setExBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const started = useRef(false);
  const runRef = useRef(0);
  const key = useDebounced(JSON.stringify(s), 700);

  const fetchStrategy = async () => {
    const id = ++runRef.current;
    setBusy(true); setErr("");
    try {
      const b = Number(s.budget);
      const { data } = await http.post("/sip/strategy", { coin_id: s.coin.id, symbol: s.coin.symbol, name: s.coin.name, interval: s.interval, risk: s.risk, horizon_years: s.horizon, budget: b > 0 ? b : null });
      if (id === runRef.current) setR(data);
      return id === runRef.current ? data : null;
    } catch (e) { setErr(errMsg(e)); return null; } finally { if (id === runRef.current) setBusy(false); }
  };
  const explain = async (d) => {
    if (!d || d.insufficient) return;
    setText(""); setExBusy(true); setStale(false);
    try { await streamSSE(`/sip/explain/${d.id}`, {}, (x) => setText((t) => t + x)); } catch (e) { setText(e.message); }
    setExBusy(false);
  };
  const lastKey = useRef("");
  const analyse = async () => { started.current = true; lastKey.current = JSON.stringify(s); const d = await fetchStrategy(); explain(d); };

  useEffect(() => {
    if (!started.current || key === lastKey.current) return;
    lastKey.current = key;
    setText("");
    fetchStrategy().then((d) => d && setStale(true));
  }, [key]); // eslint-disable-line

  return (
    <div className="space-y-5">
      <PageTitle ai title="SIP Planner" sub="How much could it grow, should you invest now, and how much — powered by the same engine as the AI Chart Analyst." />
      <div className="grid xl:grid-cols-[400px_minmax(0,1fr)] gap-5 items-start">
        <Inputs s={s} set={set} />
        <div className="space-y-3 min-w-0">
          <Recommendation r={r} busy={busy} onRun={analyse} stale={stale && !exBusy} />
          {err && <p className="text-sm text-rose-400 flex items-center gap-2" data-testid="sip-error"><AlertTriangle className="h-4 w-4" />{err}</p>}
          {r?.holding?.quantity && <Link to="/portfolio" className="k-card p-4 flex items-center gap-3 text-sm" data-testid="sip-holding-context"><Wallet className="h-4 w-4 text-emerald-400" />You already hold {r.holding.quantity} {r.symbol} ({r.holding.allocation_pct?.toFixed(1)}% of portfolio, P&L <span className={tone(r.holding.pnl)}>{fmtPct(r.holding.pnl_pct)}</span>) — factored into this recommendation.</Link>}
        </div>
      </div>
      <Strategies r={r} />
      <Calculator coin={s.coin} />
      <Explanation r={r} text={text} busy={exBusy} onExplain={() => explain(r)} />
      <p className="text-[11px] text-slate-500 flex gap-2"><ShieldAlert className="h-4 w-4 shrink-0" />Decision-support only. Recommendations are estimates from current chart data, your inputs and risk rules — not guaranteed outcomes or financial advice. Historical SIP results do not predict future returns.</p>
    </div>
  );
}
