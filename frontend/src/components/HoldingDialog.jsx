import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { http, errMsg, fmtINR } from "@/lib/api";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";

const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function CoinPicker({ value, onPick }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try { setRes((await http.get(`/coins/search?q=${encodeURIComponent(q)}`)).data); } catch { setRes([]); }
      setBusy(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
  if (value) return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3" data-testid="selected-coin">
      {value.image ? <img src={value.image} alt="" className="h-8 w-8 rounded-full" /> : <div className="h-8 w-8 rounded-full bg-white/10" />}
      <div className="flex-1"><p className="font-semibold">{value.name}</p><p className="text-xs text-slate-400 uppercase">{value.symbol}</p></div>
      <Button size="sm" variant="ghost" onClick={() => onPick(null)} data-testid="change-coin-btn">Change</Button>
    </div>
  );
  return (
    <div>
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <Input data-testid="coin-search-input" autoFocus placeholder="Search name or symbol, e.g. BTC, Solana" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 h-11" />
        {busy && <Loader2 className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-500" />}
      </div>
      <div className="mt-2 max-h-52 overflow-auto space-y-1" data-testid="coin-search-results">
        {res.map((c) => (
          <button key={c.id} data-testid={`coin-option-${c.id}`} onClick={() => onPick({ coin_id: c.id, symbol: c.symbol, name: c.name, image: c.thumb })}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5 text-left transition-colors">
            {c.thumb ? <img src={c.thumb} alt="" className="h-6 w-6 rounded-full" /> : <div className="h-6 w-6 rounded-full bg-white/10" />}
            <span className="text-sm flex-1">{c.name}</span><span className="text-xs text-slate-500 uppercase">{c.symbol}</span>
          </button>
        ))}
        {!busy && res.length === 0 && <p className="text-sm text-slate-500 px-3 py-2">No coins found.</p>}
      </div>
    </div>
  );
}

export default function HoldingDialog({ open, onOpenChange, holding, onSaved, preset }) {
  const editing = !!holding;
  const [coin, setCoin] = useState(null);
  const [f, setF] = useState({ quantity: "", avg_price: "", purchase_date: today(), notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    if (holding) {
      setCoin({ coin_id: holding.coin_id, symbol: holding.symbol, name: holding.name, image: holding.image });
      setF({ quantity: String(holding.quantity), avg_price: String(holding.avg_price), purchase_date: holding.purchase_date, notes: holding.notes || "" });
    } else {
      setCoin(preset || null);
      setF({ quantity: "", avg_price: "", purchase_date: today(), notes: "" });
    }
  }, [open, holding]); // eslint-disable-line

  const q = parseFloat(f.quantity), p = parseFloat(f.avg_price);
  const save = async () => {
    setErr("");
    if (!coin) return setErr("Pick a cryptocurrency first.");
    if (!(q > 0)) return setErr("Quantity must be greater than 0.");
    if (!(p > 0)) return setErr("Average purchase price must be greater than 0.");
    if (!f.purchase_date || f.purchase_date > today()) return setErr("Purchase date can't be empty or in the future.");
    setBusy(true);
    try {
      const body = { ...coin, quantity: q, avg_price: p, purchase_date: f.purchase_date, notes: f.notes || null };
      const { data } = editing ? await http.put(`/holdings/${holding.holding_id}`, body) : await http.post("/holdings", body);
      toast.success(editing ? "Holding updated" : data.merged ? `Added to your existing ${coin.symbol.toUpperCase()} — average cost recalculated` : `${coin.name} added to your portfolio`);
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0C1322] border-white/10 sm:max-w-lg" data-testid="holding-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Edit holding" : "Add a holding"}</DialogTitle>
          <DialogDescription>{editing ? "Update quantity, average cost or date." : "Adding a coin you already own merges it using the average-cost method."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {editing ? <CoinPicker value={coin} onPick={() => {}} /> : <CoinPicker value={coin} onPick={setCoin} />}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Quantity owned</Label><Input data-testid="holding-quantity-input" type="number" step="any" min="0" className="mt-1.5 h-11 font-mono-num" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} placeholder="0.5" /></div>
            <div><Label>Avg. buy price (₹)</Label><Input data-testid="holding-price-input" type="number" step="any" min="0" className="mt-1.5 h-11 font-mono-num" value={f.avg_price} onChange={(e) => setF({ ...f, avg_price: e.target.value })} placeholder="per coin" /></div>
          </div>
          <div><Label>Purchase date</Label><Input data-testid="holding-date-input" type="date" max={today()} className="mt-1.5 h-11" value={f.purchase_date} onChange={(e) => setF({ ...f, purchase_date: e.target.value })} /></div>
          {q > 0 && p > 0 && <p className="text-sm text-slate-400" data-testid="holding-invested-preview">Invested amount: <span className="font-mono-num text-slate-100">{fmtINR(q * p, true)}</span></p>}
          {err && <p className="text-sm text-rose-400" data-testid="holding-error">{err}</p>}
          <Button data-testid="holding-save-btn" onClick={save} disabled={busy} className="w-full h-11 rounded-full font-semibold">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? "Save changes" : "Add to portfolio"}
          </Button>
          <p className="text-[11px] text-slate-500 text-center">Wallet transfers aren't purchases — only record coins you bought, at the price you paid.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
