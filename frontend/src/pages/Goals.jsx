import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Trophy, Target, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi, http, errMsg, fmtINR } from "@/lib/api";
import { PageTitle, Skeleton, ErrorBox } from "@/components/Bits";

function GoalCard({ g, onEdit, onDelete }) {
  return (
    <div className="k-card p-6 fade-up" data-testid={`goal-card-${g.goal_id}`}>
      <div className="flex items-start gap-3">
        <div className={`h-11 w-11 rounded-xl grid place-items-center ${g.achieved ? "bg-amber-400/20 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{g.achieved ? <Trophy className="h-5 w-5" /> : <Target className="h-5 w-5" />}</div>
        <div className="flex-1 min-w-0"><p className="font-semibold truncate">{g.name}</p><p className="text-xs text-slate-500">Target {fmtINR(g.target_value)} by {new Date(g.target_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p></div>
        <Button size="icon" variant="ghost" onClick={() => onEdit(g)} data-testid={`edit-goal-${g.goal_id}`}><Pencil className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" onClick={() => onDelete(g)} data-testid={`delete-goal-${g.goal_id}`} className="hover:text-rose-400"><Trash2 className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-end justify-between mt-6">
        <p className="font-mono-num text-2xl" data-testid={`goal-progress-${g.goal_id}`}>{g.progress_pct.toFixed(1)}%</p>
        <p className="text-sm text-slate-400 font-mono-num">{fmtINR(g.current_value)} / {fmtINR(g.target_value)}</p>
      </div>
      <div className="h-3 bg-white/5 rounded-full mt-2 overflow-hidden"><div className={`h-full rounded-full ${g.achieved ? "bg-gradient-to-r from-amber-400 to-amber-200" : "bg-gradient-to-r from-emerald-600 to-emerald-400"}`} style={{ width: `${g.progress_pct}%`, transition: "width 1s ease" }} /></div>
      <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
        <div className="rounded-xl bg-white/[0.03] p-3"><p className="text-[11px] text-slate-500 uppercase">Actual · remaining</p><p className="font-mono-num mt-1" data-testid={`goal-remaining-${g.goal_id}`}>{g.achieved ? "Goal reached!" : fmtINR(g.remaining)}</p></div>
        <div className="rounded-xl bg-violet-500/5 border border-dashed border-violet-500/25 p-3"><p className="text-[11px] text-violet-300 uppercase">Hypothetical</p>
          <p className="font-mono-num mt-1 text-slate-300">{g.days_left != null && g.days_left <= 0 ? "Target date passed" : g.hypothetical_monthly ? `${fmtINR(g.hypothetical_monthly)}/mo` : "—"}</p>
          {g.hypothetical_monthly && <p className="text-[10px] text-slate-500 mt-0.5">if prices stayed flat, added monthly for {g.days_left} days</p>}</div>
      </div>
    </div>
  );
}

const blank = { name: "", target_value: "", target_date: "" };

export default function Goals() {
  const { data, error, isLoading, mutate } = useApi("/goals");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");

  const start = (g) => { setEdit(g); setF(g ? { name: g.name, target_value: String(g.target_value), target_date: g.target_date } : blank); setErr(""); setOpen(true); };
  const save = async () => {
    const v = parseFloat(f.target_value);
    if (!f.name.trim()) return setErr("Give your goal a name.");
    if (!(v > 0)) return setErr("Target value must be greater than 0.");
    if (!f.target_date) return setErr("Pick a target date.");
    try {
      const body = { name: f.name.trim(), target_value: v, target_date: f.target_date };
      edit ? await http.put(`/goals/${edit.goal_id}`, body) : await http.post("/goals", body);
      toast.success(edit ? "Goal updated" : "Goal created");
      setOpen(false); mutate();
    } catch (e) { setErr(errMsg(e)); }
  };
  const del = async (g) => { if (!window.confirm(`Delete goal "${g.name}"?`)) return; try { await http.delete(`/goals/${g.goal_id}`); toast.success("Goal deleted"); mutate(); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div>
      <PageTitle title="Investment Goals" sub="Progress uses your actual current portfolio value. Projections are clearly marked as hypothetical.">
        <Button onClick={() => start(null)} className="rounded-full" data-testid="add-goal-btn"><Plus className="h-4 w-4 mr-1" />New goal</Button>
      </PageTitle>
      {error ? <ErrorBox error={error} retry={mutate} /> : isLoading ? <Skeleton className="h-60" /> : data.length === 0 ? (
        <div className="k-card p-12 text-center" data-testid="goals-empty"><Target className="h-10 w-10 mx-auto text-emerald-400" /><p className="font-display text-lg mt-4">Set your first goal</p><p className="text-sm text-slate-400 mt-2">E.g. "₹10 lakh by Dec 2027" — we'll track how close you are.</p></div>
      ) : <div className="grid md:grid-cols-2 gap-5">{data.map((g) => <GoalCard key={g.goal_id} g={g} onEdit={start} onDelete={del} />)}</div>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0C1322] border-white/10" data-testid="goal-dialog">
          <DialogHeader><DialogTitle className="font-display">{edit ? "Edit goal" : "New investment goal"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Goal name</Label><Input data-testid="goal-name-input" className="mt-1.5 h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dream bike fund" /></div>
            <div><Label>Target portfolio value (₹)</Label><Input data-testid="goal-target-input" type="number" min="0" className="mt-1.5 h-11 font-mono-num" value={f.target_value} onChange={(e) => setF({ ...f, target_value: e.target.value })} placeholder="1000000" /></div>
            <div><Label>Target date</Label><Input data-testid="goal-date-input" type="date" className="mt-1.5 h-11" value={f.target_date} onChange={(e) => setF({ ...f, target_date: e.target.value })} /></div>
            {err && <p className="text-sm text-rose-400" data-testid="goal-error">{err}</p>}
            <Button onClick={save} className="w-full h-11 rounded-full" data-testid="goal-save-btn">{edit ? "Save" : "Create goal"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
