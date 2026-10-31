import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from "recharts";
import { useApi, fmtINR, COLORS } from "@/lib/api";
import { Skeleton } from "@/components/Bits";

const PERIODS = [["7D", 7], ["30D", 30], ["90D", 90], ["1Y", 365]];

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl bg-[#0B1220] border border-white/10 px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400">{new Date(p.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
      <p className="font-mono-num text-sm mt-1">{fmtINR(p.value)}</p>
      <p className="font-mono-num text-slate-500">Invested {fmtINR(p.invested)}</p>
    </div>
  );
}

export function PerformanceChart() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useApi(`/portfolio/history?days=${days}`);
  const pts = data?.points || [];
  const up = pts.length > 1 ? pts[pts.length - 1].value >= pts[0].value : true;
  const color = up ? "#10B981" : "#F43F5E";
  return (
    <div className="k-card p-5 sm:p-6 fade-up" data-testid="performance-chart">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold">Portfolio performance</h3>
          <p className="text-xs text-slate-500 mt-0.5">Daily value of your holdings from their purchase dates</p>
        </div>
        <div className="flex bg-white/5 rounded-full p-1">
          {PERIODS.map(([l, d]) => (
            <button key={d} data-testid={`period-${l}`} onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${days === d ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>
      {isLoading ? <Skeleton className="h-64" /> : pts.length < 2 ? (
        <div className="h-64 grid place-items-center text-sm text-slate-500 text-center px-6">Historical price data is unavailable right now. Try again in a minute.</div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pts} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="invested" stroke="#475569" strokeDasharray="4 4" fill="none" strokeWidth={1.2} />
              <Area type="monotone" dataKey="value" stroke={color} fill="url(#perf)" strokeWidth={2.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {data?.missing?.length > 0 && <p className="text-xs text-amber-400 mt-2">History unavailable for: {data.missing.join(", ")}</p>}
    </div>
  );
}

export function AllocationChart({ holdings }) {
  const rows = holdings.filter((h) => h.value > 0);
  return (
    <div className="k-card p-5 sm:p-6 fade-up" data-testid="allocation-chart">
      <h3 className="font-semibold">Allocation</h3>
      <div className="h-48 relative mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="symbol" innerRadius="68%" outerRadius="95%" paddingAngle={2} stroke="none">
              {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v, n) => [fmtINR(v), String(n).toUpperCase()]} contentStyle={{ background: "#0B1220", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center"><p className="text-xs text-slate-500">Assets</p><p className="font-display text-xl">{rows.length}</p></div>
        </div>
      </div>
      <div className="space-y-2 mt-4">
        {rows.slice(0, 6).map((h, i) => (
          <div key={h.coin_id} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="uppercase text-slate-300 flex-1">{h.symbol}</span>
            <span className="font-mono-num text-slate-400">{h.allocation.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 180, stroke = 14 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = score >= 70 ? "#10B981" : score >= 45 ? "#F59E0B" : "#F43F5E";
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="health-score-ring">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(148,163,184,0.12)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)", filter: `drop-shadow(0 0 12px ${color}66)` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-display font-semibold" style={{ fontSize: size / 3.6 }} data-testid="health-score-value">{score}</p>
          <p className="text-xs text-slate-500 -mt-1">out of 100</p>
        </div>
      </div>
    </div>
  );
}

export const riskTone = (r) => (r === "Healthy" ? "text-emerald-300 bg-emerald-500/15" : r === "Moderate" ? "text-amber-300 bg-amber-500/15" : "text-rose-300 bg-rose-500/15");
