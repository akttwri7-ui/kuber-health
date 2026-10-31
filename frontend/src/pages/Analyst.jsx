import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApi, http, API } from "@/lib/api";
import { PageTitle } from "@/components/Bits";

const SUGGESTED = [
  "Why is my portfolio down?",
  "Which coin has the highest allocation?",
  "Am I overexposed to any cryptocurrency?",
  "How diversified is my portfolio?",
  "What changed in my portfolio this week?",
  "Explain my portfolio health score",
  "What are my biggest portfolio risks?",
];

function Md({ text }) {
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="text-white">{p.slice(2, -2)}</strong> : p));
  return (
    <div className="space-y-2">
      {text.split("\n").filter((l) => l.trim()).map((l, i) => {
        const t = l.replace(/^#+\s*/, "");
        if (/^\s*[-*•]\s/.test(l)) return <div key={i} className="flex gap-2"><span className="text-violet-400">•</span><span>{bold(t.replace(/^\s*[-*•]\s/, ""))}</span></div>;
        return <p key={i}>{bold(t)}</p>;
      })}
    </div>
  );
}

function Bubble({ m }) {
  const me = m.role === "user";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"} fade-up`} data-testid={me ? "chat-user-msg" : "chat-ai-msg"}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${me ? "bg-emerald-500/15 text-emerald-50 rounded-br-md" : "bg-violet-500/10 border border-violet-500/20 text-slate-200 rounded-bl-md"}`}>
        {m.content ? <Md text={m.content} /> : <span className="dots text-violet-300 text-lg"><span>•</span><span>•</span><span>•</span></span>}
      </div>
    </div>
  );
}

export default function Analyst() {
  const { data: hist, mutate } = useApi("/chat/history");
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const end = useRef(null);
  const asked = useRef(false);

  useEffect(() => { if (hist && !busy) setMsgs(hist); }, [hist]); // eslint-disable-line
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  const ask = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    const append = (d) => setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + d }; return c; });
    try {
      let res = await fetch(`${API}/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q }) });
      if (res.status === 401) {
        await http.post("/auth/refresh");
        res = await fetch(`${API}/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q }) });
      }
      if (!res.ok) throw new Error("failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const p of parts) {
          const line = p.replace(/^data: /, "");
          if (line === "[DONE]") continue;
          try { const j = JSON.parse(line); if (j.delta) append(j.delta); if (j.error) append(j.error); } catch {}
        }
      }
    } catch {
      append("Sorry, I couldn't reach the analyst right now. Please try again.");
    }
    setBusy(false);
    mutate();
  };

  useEffect(() => {
    const q = params.get("q");
    if (q && hist && !asked.current) { asked.current = true; setParams({}); ask(q); }
  }, [hist]); // eslint-disable-line

  const clear = async () => { await http.delete("/chat/history"); setMsgs([]); mutate(); };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] lg:h-[calc(100vh-130px)]">
      <PageTitle ai title="AI Portfolio Analyst" sub="Kuber AI reads your actual holdings, prices, health score and alerts. It never invents numbers and never executes trades.">
        {msgs.length > 0 && <Button variant="ghost" size="sm" onClick={clear} data-testid="clear-chat-btn" className="text-slate-400"><Trash2 className="h-4 w-4 mr-1" />Clear</Button>}
      </PageTitle>
      <div className="k-card-ai flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4" data-testid="chat-messages">
          {msgs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 grid place-items-center shadow-[0_0_50px_rgba(139,92,246,0.45)] coin-float"><Sparkles className="h-6 w-6" /></div>
              <p className="font-display text-xl mt-5">Hi, I'm Kuber AI</p>
              <p className="text-sm text-slate-400 mt-2 max-w-md">Pick a question below or ask your own. I'll explain things simply, using only your real portfolio data.</p>
            </div>
          )}
          {msgs.map((m, i) => <Bubble key={m.msg_id || i} m={m} />)}
          <div ref={end} />
        </div>
        <div className="border-t border-white/5 p-3 sm:p-4">
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" data-testid="suggested-questions">
            {SUGGESTED.map((s, i) => (
              <button key={s} disabled={busy} onClick={() => ask(s)} data-testid={`suggested-q-${i}`}
                className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/5 px-3.5 py-1.5 text-xs text-violet-200 hover:bg-violet-500/15 disabled:opacity-40 transition-colors">{s}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2">
            <input data-testid="chat-input" value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000} placeholder="Ask about your portfolio…"
              className="flex-1 h-12 rounded-full bg-[#0A0F1C] border border-white/10 px-5 text-sm outline-none focus:border-violet-500/50 transition-colors" />
            <Button type="submit" disabled={busy || !input.trim()} data-testid="chat-send-btn" className="h-12 w-12 rounded-full bg-violet-500 hover:bg-violet-400 p-0"><Send className="h-4 w-4" /></Button>
          </form>
          <p className="text-[10px] text-slate-500 text-center mt-2">Educational insights only — not financial advice. No guaranteed returns.</p>
        </div>
      </div>
    </div>
  );
}
