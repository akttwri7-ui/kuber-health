import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi, http, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageTitle, Skeleton } from "@/components/Bits";
import { useRefreshAll } from "@/pages/Dashboard";
import { ShieldCheck } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { data: s } = useApi("/settings");
  const { data: sum } = useApi("/portfolio/summary");
  const refresh = useRefreshAll();
  const [targets, setTargets] = useState({});
  const [thr, setThr] = useState("5, 10, 15");
  const [limit, setLimit] = useState("40");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s) return;
    setTargets(Object.fromEntries(Object.entries(s.targets).map(([k, v]) => [k, String(v)])));
    setThr(s.drawdown_thresholds.join(", "));
    setLimit(String(s.concentration_limit));
  }, [s]);

  const total = Object.values(targets).reduce((a, v) => a + (parseFloat(v) || 0), 0);
  const equal = () => {
    const n = sum.holdings.length;
    const base = Math.floor((100 / n) * 100) / 100;
    setTargets(Object.fromEntries(sum.holdings.map((h, i) => [h.coin_id, String(i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base)])));
  };

  const save = async () => {
    setBusy(true);
    try {
      const t = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, parseFloat(v) || 0]).filter(([, v]) => v > 0));
      await http.put("/settings", { targets: t, drawdown_thresholds: thr.split(",").map((x) => parseFloat(x.trim())).filter((x) => !isNaN(x)), concentration_limit: parseFloat(limit) });
      toast.success("Settings saved — health score updated");
      refresh();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  if (!s || !sum) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-5 max-w-3xl">
      <PageTitle title="Settings" sub="Tune the targets and thresholds that drive your health score and alerts." />
      <div className="k-card p-6 fade-up" data-testid="targets-card">
        <div className="flex items-center justify-between gap-3">
          <div><p className="font-semibold">Target allocation</p><p className="text-xs text-slate-500 mt-1">Must total 100%. Leave all empty to compare against equal weight.</p></div>
          {sum.holdings.length > 0 && <Button size="sm" variant="outline" className="bg-transparent" onClick={equal} data-testid="equal-weight-btn">Equal weight</Button>}
        </div>
        {sum.holdings.length === 0 ? <p className="text-sm text-slate-500 mt-4">Add holdings first to set targets.</p> : (
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {sum.holdings.map((h) => (
              <div key={h.coin_id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                <span className="flex-1 text-sm"><span className="font-semibold uppercase">{h.symbol}</span> <span className="text-slate-500 text-xs">now {h.allocation.toFixed(1)}%</span></span>
                <Input data-testid={`target-input-${h.coin_id}`} type="number" min="0" max="100" className="w-24 h-9 font-mono-num text-right" value={targets[h.coin_id] || ""} onChange={(e) => setTargets({ ...targets, [h.coin_id]: e.target.value })} placeholder="0" />
                <span className="text-slate-500 text-sm">%</span>
              </div>
            ))}
          </div>
        )}
        {total > 0 && <p className={`text-sm mt-3 font-mono-num ${Math.abs(total - 100) <= 0.5 ? "text-emerald-400" : "text-amber-400"}`} data-testid="targets-total">Total: {total.toFixed(2)}%</p>}
      </div>
      <div className="k-card p-6 fade-up grid sm:grid-cols-2 gap-5" data-testid="alerts-settings-card">
        <div><Label>Drawdown alert thresholds (%)</Label><Input data-testid="thresholds-input" className="mt-1.5 h-11 font-mono-num" value={thr} onChange={(e) => setThr(e.target.value)} placeholder="5, 10, 15" /><p className="text-xs text-slate-500 mt-1.5">Comma separated. Smallest also triggers 24h move alerts.</p></div>
        <div><Label>Concentration limit (%)</Label><Input data-testid="concentration-input" type="number" min="10" max="100" className="mt-1.5 h-11 font-mono-num" value={limit} onChange={(e) => setLimit(e.target.value)} /><p className="text-xs text-slate-500 mt-1.5">Warn when one coin exceeds this share.</p></div>
      </div>
      <Button onClick={save} disabled={busy} className="rounded-full px-8 h-11" data-testid="save-settings-btn">Save settings</Button>
      <div className="k-card p-6 fade-up flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
        <div className="text-sm"><p className="font-semibold">{user?.name} · {user?.email}</p><p className="text-slate-400 mt-1">Kuber never asks for private keys, seed phrases or exchange logins. Your data is private to your account.</p></div>
      </div>
    </div>
  );
}
