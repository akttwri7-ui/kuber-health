import { useNavigate } from "react-router-dom";
import { TrendingUp, TrendingDown, Flame, Globe2, BarChart3, Crown, Activity } from "lucide-react";
import { useApi, fmtINR, fmtPct, tone } from "@/lib/api";
import { Skeleton, ErrorBox, PriceStatus } from "@/components/Bits";
import CoinSearch from "@/components/CoinSearch";
import NewsList from "@/components/NewsList";

const crore = (v) => (v == null ? "—" : v >= 1e12 ? `₹${(v / 1e12).toFixed(2)} L Cr` : `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`);
export const coinPath = (c) => `/coin/${c.id}?symbol=${c.symbol}`;

function G({ icon: I, label, value, sub, subTone, testid }) {
  return (
    <div className="k-card p-5 fade-up" data-testid={testid}>
      <p className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><I className="h-3.5 w-3.5" />{label}</p>
      <p className="font-mono-num text-xl sm:text-2xl mt-2">{value}</p>
      {sub && <p className={`text-xs mt-1 font-mono-num ${subTone || "text-slate-500"}`}>{sub}</p>}
    </div>
  );
}

function CoinRow({ c, onClick, testid }) {
  return (
    <button onClick={onClick} data-testid={testid} className="w-full flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-white/[0.04] transition-colors text-left">
      {c.image ? <img src={c.image} alt="" className="h-7 w-7 rounded-full" /> : <div className="h-7 w-7 rounded-full bg-white/10" />}
      <div className="flex-1 min-w-0"><p className="text-sm truncate">{c.name}</p><p className="text-[11px] text-slate-500 uppercase">{c.symbol}</p></div>
      <div className="text-right"><p className="text-sm font-mono-num">{fmtINR(c.price, c.price < 100)}</p><p className={`text-[11px] font-mono-num ${tone(c.change_24h)}`}>{fmtPct(c.change_24h)}</p></div>
    </button>
  );
}

function ListCard({ title, icon: I, color, rows, go, testid, note }) {
  return (
    <div className="k-card p-4 sm:p-5 fade-up" data-testid={testid}>
      <p className={`flex items-center gap-2 font-semibold text-sm mb-2 ${color}`}><I className="h-4 w-4" />{title}</p>
      {rows.length === 0 ? <p className="text-sm text-slate-500 py-4">Unavailable right now.</p> : rows.map((c) => <CoinRow key={c.id} c={c} onClick={() => go(c)} testid={`${testid}-${c.id}`} />)}
      {note && <p className="text-[10px] text-slate-600 mt-2">{note}</p>}
    </div>
  );
}

export default function Explore() {
  const nav = useNavigate();
  const { data, error, isLoading, mutate } = useApi("/explore/overview", { refreshInterval: 120000 });
  const { data: news, isLoading: nl } = useApi("/explore/news");
  const go = (c) => nav(coinPath(c));
  const g = data?.global;
  return (
    <div className="space-y-6">
      <div className="relative k-card p-6 sm:p-10 overflow-visible fade-up" data-testid="explore-hero">
        <div className="absolute inset-0 overflow-hidden rounded-[1.1rem] pointer-events-none"><div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" /><div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" /></div>
        <p className="text-emerald-400 text-xs font-semibold tracking-widest uppercase relative">Crypto Explore</p>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl mt-3 max-w-3xl relative">Research any coin. In rupees. In seconds.</h1>
        <div className="mt-7 max-w-2xl relative z-10"><CoinSearch big onSelect={go} testid="explore-search" /></div>
        <div className="mt-4 relative">{data && <PriceStatus status={data.status === "cached" ? "stale" : data.status === "unavailable" ? "unavailable" : "live"} />}{data?.source && <span className="text-[11px] text-slate-500 ml-2">Market data: {data.source}</span>}</div>
      </div>

      {error ? <ErrorBox error={error} retry={mutate} /> : isLoading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <G icon={Globe2} label="Total market cap" value={crore(g?.market_cap)} sub={g ? `${fmtPct(g.change_24h)} 24h` : "Unavailable"} subTone={tone(g?.change_24h)} testid="global-mcap" />
            <G icon={BarChart3} label="24h volume" value={crore(g?.volume)} sub={g ? `${g.coins?.toLocaleString("en-IN")} coins tracked` : null} testid="global-volume" />
            <G icon={Crown} label="BTC dominance" value={g?.btc_dominance != null ? `${g.btc_dominance.toFixed(1)}%` : "—"} sub="share of total market cap" testid="global-dominance" />
            <G icon={Activity} label="Market mood" value={g?.change_24h == null ? "—" : g.change_24h > 1 ? "Risk-on" : g.change_24h < -1 ? "Risk-off" : "Calm"}
              sub={g?.change_24h != null ? `Overall market ${g.change_24h >= 0 ? "up" : "down"} ${Math.abs(g.change_24h).toFixed(2)}%` : null} subTone={tone(g?.change_24h)} testid="global-mood" />
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            <ListCard title="Trending" icon={Flame} color="text-amber-300" rows={data.trending} go={go} testid="trending-list" note={data.trending_source} />
            <ListCard title="Top gainers (24h)" icon={TrendingUp} color="text-emerald-300" rows={data.gainers} go={go} testid="gainers-list" note="Among the top 150 coins by market cap" />
            <ListCard title="Top losers (24h)" icon={TrendingDown} color="text-rose-300" rows={data.losers} go={go} testid="losers-list" note="Among the top 150 coins by market cap" />
          </div>
          <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5">
            <div className="k-card p-2 sm:p-4 fade-up overflow-x-auto" data-testid="top-coins-table">
              <p className="font-semibold px-3 py-2">Top coins by market cap</p>
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-[11px] uppercase text-slate-500"><th className="text-left px-3 py-2">#</th><th className="text-left">Coin</th><th className="text-right px-3">Price</th><th className="text-right px-3">24h</th><th className="text-right px-3">Market cap</th></tr></thead>
                <tbody>{data.top.map((c) => (
                  <tr key={c.id} onClick={() => go(c)} className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer transition-colors" data-testid={`top-coin-${c.id}`}>
                    <td className="px-3 py-3 text-slate-500 font-mono-num">{c.rank}</td>
                    <td><div className="flex items-center gap-2">{c.image && <img src={c.image} alt="" className="h-6 w-6 rounded-full" />}<span>{c.name}</span><span className="text-slate-500 uppercase text-xs">{c.symbol}</span></div></td>
                    <td className="px-3 text-right font-mono-num">{fmtINR(c.price, c.price < 100)}</td>
                    <td className={`px-3 text-right font-mono-num ${tone(c.change_24h)}`}>{fmtPct(c.change_24h)}</td>
                    <td className="px-3 text-right font-mono-num text-slate-400">{crore(c.market_cap)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <NewsList items={news?.slice(0, 9)} loading={nl} testid="general-news" title="Crypto news" />
          </div>
        </>
      )}
    </div>
  );
}
