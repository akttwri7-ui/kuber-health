import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode } from "lightweight-charts";
import { Sparkles, Send, Loader2, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi, fmtINR, fmtPct, tone } from "@/lib/api";
import { streamSSE } from "@/lib/stream";
import { PageTitle, Skeleton, ErrorBox, PriceStatus } from "@/components/Bits";
import CoinSearch from "@/components/CoinSearch";
import Md from "@/components/Md";

const INTERVALS = ["5m", "15m", "1h", "4h", "1d", "1w"];
const IND = [["volume", "Volume"], ["sma", "SMA 20/50"], ["ema", "EMA 20"], ["bb", "Bollinger"], ["rsi", "RSI"], ["macd", "MACD"]];
const QUICK = ["What is happening with this coin?", "Explain the current trend.", "What does RSI indicate?",
  "Where are the important support and resistance levels?", "Is trading volume increasing?", "Explain the latest candlestick pattern."];

const INR = { type: "custom", minMove: 0.0001, formatter: (p) => `₹${p.toLocaleString("en-IN", { maximumFractionDigits: p < 100 ? 4 : 2 })}` };
const OSC = { type: "custom", formatter: (v) => v.toFixed(2) };
const line = (candles, arr) => candles.map((c, i) => (arr[i] == null ? null : { time: c.time, value: arr[i] })).filter(Boolean);

function Chart({ data, ind }) {
  const el = useRef(null);
  useEffect(() => {
    if (!el.current || !data) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94A3B8", fontFamily: "JetBrains Mono", panes: { separatorColor: "rgba(148,163,184,0.15)" } },
      grid: { vertLines: { color: "rgba(148,163,184,0.05)" }, horzLines: { color: "rgba(148,163,184,0.05)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: { borderColor: "rgba(148,163,184,0.15)", timeVisible: true, secondsVisible: false },
    });
    const { candles, series: s } = data;
    chart.addSeries(CandlestickSeries, { upColor: "#10B981", downColor: "#F43F5E", wickUpColor: "#10B981", wickDownColor: "#F43F5E", borderVisible: false, priceFormat: INR }).setData(candles);
    if (ind.volume) {
      const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      v.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)" })));
    }
    const addLine = (arr, color, pane = 0, w = 1.5, extra = {}) => chart.addSeries(LineSeries, { color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane).setData(line(candles, arr));
    const P = { priceFormat: INR };
    if (ind.sma) { addLine(s.sma20, "#F59E0B", 0, 1.5, P); addLine(s.sma50, "#3B82F6", 0, 1.5, P); }
    if (ind.ema) addLine(s.ema20, "#EC4899", 0, 1.5, P);
    if (ind.bb) { addLine(s.bb_upper, "rgba(167,139,250,0.8)", 0, 1, P); addLine(s.bb_mid, "rgba(167,139,250,0.4)", 0, 1, P); addLine(s.bb_lower, "rgba(167,139,250,0.8)", 0, 1, P); }
    let pane = 1;
    if (ind.rsi) {
      const r = chart.addSeries(LineSeries, { color: "#A78BFA", lineWidth: 1.5, priceLineVisible: false, priceFormat: OSC }, pane);
      r.setData(line(candles, s.rsi));
      r.createPriceLine({ price: 70, color: "rgba(244,63,94,0.5)", lineStyle: 2, axisLabelVisible: true });
      r.createPriceLine({ price: 30, color: "rgba(16,185,129,0.5)", lineStyle: 2, axisLabelVisible: true });
      pane++;
    }
    if (ind.macd) {
      chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: OSC }, pane).setData(candles.map((c, i) => (s.macd_hist[i] == null ? null : { time: c.time, value: s.macd_hist[i], color: s.macd_hist[i] >= 0 ? "rgba(16,185,129,0.55)" : "rgba(244,63,94,0.55)" })).filter(Boolean));
      addLine(s.macd, "#38BDF8", pane, 1.5, { priceFormat: OSC });
      addLine(s.macd_signal, "#F59E0B", pane, 1.5, { priceFormat: OSC });
    }
    const panes = chart.panes();
    panes.forEach((p, i) => i > 0 && p.setHeight(110));
    chart.timeScale().setVisibleLogicalRange({ from: candles.length - 120, to: candles.length + 3 });
    return () => chart.remove();
  }, [data, ind]);
  const extra = (ind.rsi ? 110 : 0) + (ind.macd ? 110 : 0);
  return <div ref={el} style={{ height: 420 + extra }} className="w-full" data-testid="candlestick-chart" />;
}

function AIPanel({ coin, interval, snap }) {
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(null);
  const [q, setQ] = useState("");
  const end = useRef(null);
  const runId = useRef(0);
  useEffect(() => { runId.current++; setMsgs([]); setStamp(null); setBusy(false); }, [coin.symbol, interval]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [msgs]);

  const run = async (question) => {
    if (busy) return;
    setBusy(true);
    const id = ++runId.current;
    const ctx = msgs.filter((m) => m.content).map(({ role, content }) => ({ role, content }));
    const next = question ? [...msgs, { role: "user", content: question }] : [];
    setMsgs([...next, { role: "assistant", content: "", kind: question ? "answer" : "analysis" }]);
    const append = (d) => id === runId.current && setMsgs((m) => { if (!m.length) return m; const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + d }; return c; });
    try {
      await streamSSE("/chart/analyze", { symbol: coin.symbol, name: coin.name, interval, question: question || null, context: question ? ctx : [] }, append);
      if (!question && id === runId.current) setStamp(new Date());
    } catch (e) { append(e.message || "Analysis unavailable right now."); }
    if (id === runId.current) setBusy(false);
  };

  return (
    <div className="k-card-ai min-w-0 p-4 sm:p-5 flex flex-col lg:max-h-[calc(100vh-150px)] lg:sticky lg:top-24" data-testid="ai-chart-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-violet-200"><Sparkles className="h-4 w-4" />AI Chart Analysis</p>
        <Button onClick={() => run(null)} disabled={busy || !snap} size="sm" className="rounded-full bg-violet-500 hover:bg-violet-400" data-testid="analyze-chart-btn">
          {busy && !msgs.some((m) => m.role === "user") ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : stamp ? <RefreshCw className="h-3.5 w-3.5 mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}Analyze Chart
        </Button>
      </div>
      <p className="text-[11px] text-slate-500 mt-1" data-testid="analysis-timestamp">{stamp ? `Analysis of ${coin.symbol.toUpperCase()} · ${interval} at ${stamp.toLocaleString("en-IN")}` : `${coin.name} · ${interval} — click Analyze Chart for a fresh AI read`}</p>
      {snap && (
        <div className="grid grid-cols-3 gap-2 mt-4 text-[11px]" data-testid="computed-snapshot">
          <div className="rounded-lg bg-white/[0.04] p-2"><p className="text-slate-500">Trend (rules)</p><p className={`font-semibold mt-0.5 ${snap.rule_based_trend === "Bullish" ? "text-emerald-400" : snap.rule_based_trend === "Bearish" ? "text-rose-400" : "text-amber-300"}`}>{snap.rule_based_trend}</p></div>
          <div className="rounded-lg bg-white/[0.04] p-2"><p className="text-slate-500">RSI 14</p><p className="font-mono-num mt-0.5">{snap.rsi14?.toFixed(1) ?? "—"}</p></div>
          <div className="rounded-lg bg-white/[0.04] p-2"><p className="text-slate-500">Vol vs avg</p><p className={`font-mono-num mt-0.5 ${tone(snap.volume_last5_vs_prior20_pct)}`}>{fmtPct(snap.volume_last5_vs_prior20_pct)}</p></div>
          <div className="col-span-3 rounded-lg bg-white/[0.04] p-2"><p className="text-slate-500">Latest candle</p><p className="mt-0.5">{snap.latest_pattern}</p></div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto mt-4 space-y-3 min-h-[120px]" data-testid="chart-ai-messages">
        {msgs.length === 0 && <p className="text-sm text-slate-400">The AI reads only the candles and indicators shown on this chart. Analysis is generated only when you ask.</p>}
        {msgs.map((m, i) => m.role === "user"
          ? <div key={i} className="ml-8 rounded-2xl rounded-br-md bg-emerald-500/15 px-3.5 py-2.5 text-sm" data-testid="chart-user-msg">{m.content}</div>
          : <div key={i} className="rounded-2xl rounded-bl-md bg-violet-500/10 border border-violet-500/20 px-3.5 py-3" data-testid="chart-ai-msg">{m.content ? <Md text={m.content} /> : <span className="dots text-violet-300 text-lg"><span>•</span><span>•</span><span>•</span></span>}</div>)}
        <div ref={end} />
      </div>
      <div className="flex gap-2 overflow-x-auto py-3 -mx-1 px-1" data-testid="chart-quick-questions">
        {QUICK.map((s, i) => <button key={s} disabled={busy || !snap} onClick={() => run(s)} data-testid={`chart-quick-q-${i}`} className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/5 px-3 py-1.5 text-[11px] text-violet-200 hover:bg-violet-500/15 disabled:opacity-40 transition-colors">{s}</button>)}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { run(q.trim()); setQ(""); } }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder={`Ask about ${coin.symbol.toUpperCase()} ${interval}…`} data-testid="chart-ai-input"
          className="flex-1 h-11 rounded-full bg-[#0A0F1C] border border-white/10 px-4 text-sm outline-none focus:border-violet-500/50" />
        <Button type="submit" disabled={busy || !q.trim() || !snap} className="h-11 w-11 rounded-full bg-violet-500 hover:bg-violet-400 p-0" data-testid="chart-ai-send"><Send className="h-4 w-4" /></Button>
      </form>
      <p className="text-[10px] text-slate-500 mt-2 text-center">Educational technical analysis — not a prediction or financial advice.</p>
    </div>
  );
}

export default function ChartAnalyst() {
  const [sp, setSp] = useSearchParams();
  const coin = { id: sp.get("coin") || "bitcoin", symbol: sp.get("symbol") || "btc", name: sp.get("name") || "Bitcoin" };
  const [interval, setIntervalV] = useState("1h");
  const [ind, setInd] = useState({ volume: true, sma: true, ema: false, bb: false, rsi: true, macd: false });
  const { data, error, isLoading, mutate } = useApi(`/chart/candles?symbol=${coin.symbol}&interval=${interval}`, { refreshInterval: 60000 });
  const last = data?.candles?.[data.candles.length - 1];
  const first = data?.candles?.[0];
  return (
    <div>
      <PageTitle ai title="AI Chart Analyst" sub="Candlesticks, indicators and an AI analyst that reads the exact chart you're looking at." />
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center mb-4">
        <div className="lg:w-96"><CoinSearch onSelect={(c) => setSp({ coin: c.id, symbol: c.symbol, name: c.name })} placeholder="Switch coin…" testid="chart-search" /></div>
        <div className="flex items-center gap-3 flex-1">
          <p className="font-display text-lg" data-testid="chart-coin-name">{coin.name} <span className="text-slate-500 text-sm uppercase">{coin.symbol}/INR</span></p>
          {last && <p className="font-mono-num" data-testid="chart-last-price">{fmtINR(last.close, last.close < 100)}</p>}
          {last && first && <p className={`font-mono-num text-sm ${tone(last.close - first.close)}`}>{fmtPct((last.close / first.open - 1) * 100)} <span className="text-slate-500">in view</span></p>}
        </div>
        <Link to={`/coin/${coin.id}?symbol=${coin.symbol}`} className="text-sm text-emerald-400 hover:underline" data-testid="chart-coin-details-link">Coin details →</Link>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
        <div className="k-card p-3 sm:p-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex flex-wrap bg-white/5 rounded-full p-1" data-testid="interval-switch">{INTERVALS.map((i) => (
              <button key={i} onClick={() => setIntervalV(i)} data-testid={`interval-${i}`} className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${interval === i ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>{i.toUpperCase()}</button>))}</div>
            <div className="flex flex-wrap gap-1.5" data-testid="indicator-toggles">{IND.map(([k, l]) => (
              <button key={k} onClick={() => setInd({ ...ind, [k]: !ind[k] })} data-testid={`toggle-${k}`} className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${ind[k] ? "border-violet-400/60 bg-violet-500/15 text-violet-200" : "border-white/10 text-slate-500 hover:text-slate-300"}`}>{l}</button>))}</div>
          </div>
          {error ? <ErrorBox error={error} retry={mutate} /> : isLoading || !data ? <Skeleton className="h-[420px]" /> : <Chart data={data} ind={ind} />}
          {data && (
            <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-slate-500">
              <PriceStatus status={data.status === "cached" ? "stale" : "live"} compact />
              <span className="flex items-center gap-1"><Info className="h-3 w-3" />{data.source}. Scroll to zoom, drag to pan.</span>
              {ind.sma && <span><span className="text-amber-400">━</span> SMA20 <span className="text-blue-400">━</span> SMA50</span>}
              {ind.ema && <span><span className="text-pink-400">━</span> EMA20</span>}
            </div>
          )}
        </div>
        <AIPanel coin={coin} interval={interval} snap={data?.snapshot} />
      </div>
    </div>
  );
}
