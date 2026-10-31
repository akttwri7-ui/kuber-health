import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useApi, http, errMsg, fmtINR, fmtPct, fmtSigned, fmtQty, tone } from "@/lib/api";
import { PageTitle, Skeleton, EmptyPortfolio, ErrorBox, CoinIcon } from "@/components/Bits";
import HoldingDialog from "@/components/HoldingDialog";
import { useRefreshAll } from "@/pages/Dashboard";

function Row({ h, onEdit, onDelete }) {
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors" data-testid={`holding-row-${h.coin_id}`}>
      <td className="py-4 pl-5 pr-3"><div className="flex items-center gap-3"><CoinIcon h={h} /><div><p className="font-semibold text-sm">{h.name}</p><p className="text-xs text-slate-500 uppercase">{h.symbol} · since {h.purchase_date}</p></div></div></td>
      <td className="px-3 font-mono-num text-sm text-right">{fmtQty(h.quantity)}</td>
      <td className="px-3 font-mono-num text-sm text-right">{fmtINR(h.avg_price, true)}</td>
      <td className="px-3 font-mono-num text-sm text-right">{fmtINR(h.current_price, true)}<p className={`text-xs ${tone(h.change_24h)}`}>{fmtPct(h.change_24h)}</p></td>
      <td className="px-3 font-mono-num text-sm text-right">{fmtINR(h.invested)}</td>
      <td className="px-3 font-mono-num text-sm text-right" data-testid={`holding-value-${h.coin_id}`}>{fmtINR(h.value)}</td>
      <td className={`px-3 font-mono-num text-sm text-right ${tone(h.pnl)}`} data-testid={`holding-pnl-${h.coin_id}`}>{fmtSigned(h.pnl)}<p className="text-xs">{fmtPct(h.pnl_pct)}</p></td>
      <td className="px-3 text-right"><span className="font-mono-num text-sm">{h.allocation.toFixed(1)}%</span><div className="h-1 bg-white/5 rounded-full mt-1.5 w-16 ml-auto"><div className="h-1 bg-emerald-500 rounded-full" style={{ width: `${h.allocation}%` }} /></div></td>
      <td className="pr-5 pl-3 text-right whitespace-nowrap">
        <Button size="icon" variant="ghost" onClick={() => onEdit(h)} data-testid={`edit-holding-${h.coin_id}`}><Pencil className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" onClick={() => onDelete(h)} className="hover:text-rose-400" data-testid={`delete-holding-${h.coin_id}`}><Trash2 className="h-4 w-4" /></Button>
      </td>
    </tr>
  );
}

function MobileCard({ h, onEdit, onDelete }) {
  return (
    <div className="k-card p-4" data-testid={`holding-card-${h.coin_id}`}>
      <div className="flex items-center gap-3"><CoinIcon h={h} /><div className="flex-1"><p className="font-semibold">{h.name}</p><p className="text-xs text-slate-500">{fmtQty(h.quantity)} {h.symbol.toUpperCase()} · {h.allocation.toFixed(1)}%</p></div>
        <Button size="icon" variant="ghost" onClick={() => onEdit(h)} data-testid={`mobile-edit-holding-${h.coin_id}`}><Pencil className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" onClick={() => onDelete(h)} data-testid={`mobile-delete-holding-${h.coin_id}`}><Trash2 className="h-4 w-4" /></Button></div>
      <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
        <div><p className="text-slate-500">Value</p><p className="font-mono-num text-sm">{fmtINR(h.value)}</p></div>
        <div><p className="text-slate-500">Invested</p><p className="font-mono-num text-sm">{fmtINR(h.invested)}</p></div>
        <div><p className="text-slate-500">P&L</p><p className={`font-mono-num text-sm ${tone(h.pnl)}`}>{fmtPct(h.pnl_pct)}</p></div>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const { data: s, error, isLoading, mutate } = useApi("/portfolio/summary");
  const refresh = useRefreshAll();
  const [dlg, setDlg] = useState({ open: false, holding: null });
  const [del, setDel] = useState(null);
  const edit = (h) => setDlg({ open: true, holding: h });
  const doDelete = async () => {
    try { await http.delete(`/holdings/${del.holding_id}`); toast.success(`${del.name} removed`); refresh(); } catch (e) { toast.error(errMsg(e)); }
    setDel(null);
  };
  const demo = async () => {
    try { await http.post("/holdings/demo"); toast.success("Sample portfolio loaded"); refresh(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageTitle title="My Portfolio" sub="Manually track what you own. Values, P&L and allocation are calculated on the server with live prices.">
        <Button data-testid="add-holding-btn" onClick={() => setDlg({ open: true, holding: null })} className="rounded-full"><Plus className="h-4 w-4 mr-1" />Add holding</Button>
      </PageTitle>
      {error ? <ErrorBox error={error} retry={mutate} /> : isLoading ? <Skeleton className="h-80" /> : !s.holdings.length ? (
        <EmptyPortfolio onAdd={() => setDlg({ open: true, holding: null })} onDemo={demo} />
      ) : (
        <>
          <div className="hidden md:block k-card overflow-x-auto fade-up">
            <table className="w-full min-w-[900px]" data-testid="holdings-table">
              <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500">
                <th className="text-left py-3 pl-5">Asset</th><th className="text-right px-3">Qty</th><th className="text-right px-3">Avg cost</th><th className="text-right px-3">Price</th>
                <th className="text-right px-3">Invested</th><th className="text-right px-3">Value</th><th className="text-right px-3">Unrealised P&L</th><th className="text-right px-3">Alloc.</th><th className="pr-5" />
              </tr></thead>
              <tbody>{s.holdings.map((h) => <Row key={h.holding_id} h={h} onEdit={edit} onDelete={setDel} />)}</tbody>
              <tfoot><tr className="border-t border-white/10 font-semibold">
                <td className="py-4 pl-5 text-sm">Total</td><td colSpan={3} /><td className="px-3 text-right font-mono-num text-sm" data-testid="total-invested">{fmtINR(s.total_invested)}</td>
                <td className="px-3 text-right font-mono-num text-sm" data-testid="total-value">{fmtINR(s.total_value)}</td>
                <td className={`px-3 text-right font-mono-num text-sm ${tone(s.pnl)}`} data-testid="total-pnl">{fmtSigned(s.pnl)}<p className="text-xs">{fmtPct(s.pnl_pct)}</p></td><td className="px-3 text-right font-mono-num text-sm">100%</td><td />
              </tr></tfoot>
            </table>
          </div>
          <div className="md:hidden space-y-3">{s.holdings.map((h) => <MobileCard key={h.holding_id} h={h} onEdit={edit} onDelete={setDel} />)}</div>
          <div className="flex gap-3 items-start mt-5 text-xs text-slate-500 max-w-3xl">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>Average-cost method: invested = quantity × average buy price. Adding more of a coin you already hold recalculates the average as (old qty × old avg + new qty × new price) ÷ total qty. Unrealised P&L = current value − invested. Wallet-to-wallet transfers are not purchases and shouldn't be recorded.</p>
          </div>
        </>
      )}
      <HoldingDialog open={dlg.open} holding={dlg.holding} onOpenChange={(o) => setDlg((d) => ({ ...d, open: o }))} onSaved={refresh} />
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent className="bg-[#0C1322] border-white/10">
          <AlertDialogHeader><AlertDialogTitle>Remove {del?.name}?</AlertDialogTitle><AlertDialogDescription>This deletes the holding from your tracker. It doesn't affect any real wallet.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel data-testid="cancel-delete-btn">Cancel</AlertDialogCancel><AlertDialogAction data-testid="confirm-delete-btn" onClick={doDelete} className="bg-rose-500 hover:bg-rose-600">Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
