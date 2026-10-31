import { useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { http, fmtINR, fmtPct, tone } from "@/lib/api";

export default function CoinSearch({ onSelect, big, placeholder = "Search any crypto — Bitcoin, ETH, SOL…", testid = "coin-search" }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setBusy(true);
      try { setRes((await http.get(`/explore/search?q=${encodeURIComponent(q.trim())}`)).data); } catch { setRes([]); }
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    const h = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (c) => { setOpen(false); setQ(""); onSelect(c); };

  return (
    <div ref={box} className="relative w-full">
      <Search className={`absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 ${big ? "h-5 w-5" : "h-4 w-4"}`} />
      <input data-testid={`${testid}-input`} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => e.key === "Enter" && res[0] && pick(res[0])} placeholder={placeholder}
        className={`w-full rounded-full bg-[#0A1020] border border-white/10 outline-none focus:border-emerald-500/50 transition-colors ${big ? "h-14 pl-12 pr-12 text-base" : "h-11 pl-11 pr-10 text-sm"}`} />
      {busy && <Loader2 className="h-4 w-4 absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl bg-[#0C1322] border border-white/10 shadow-2xl max-h-96 overflow-auto p-1.5" data-testid={`${testid}-results`}>
          {!q && <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-slate-500">Top coins</p>}
          {res.map((c) => (
            <button key={c.id} onClick={() => pick(c)} data-testid={`${testid}-option-${c.id}`}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5 text-left transition-colors">
              {c.thumb ? <img src={c.thumb} alt="" className="h-7 w-7 rounded-full" /> : <div className="h-7 w-7 rounded-full bg-white/10" />}
              <div className="flex-1 min-w-0"><p className="text-sm truncate">{c.name}</p><p className="text-[11px] text-slate-500 uppercase">{c.symbol}</p></div>
              {c.price != null && <div className="text-right"><p className="text-sm font-mono-num">{fmtINR(c.price, c.price < 100)}</p><p className={`text-[11px] font-mono-num ${tone(c.change_24h)}`}>{fmtPct(c.change_24h)}</p></div>}
            </button>
          ))}
          {!busy && res.length === 0 && <p className="text-sm text-slate-500 px-3 py-3">No matching coins found.</p>}
        </div>
      )}
    </div>
  );
}
