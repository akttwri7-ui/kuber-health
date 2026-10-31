const bold = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="text-white">{p.slice(2, -2)}</strong> : p));

export default function Md({ text }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-300">
      {text.split("\n").filter((l) => l.trim()).map((l, i) => {
        if (/^#{1,4}\s/.test(l)) return <p key={i} className="font-display text-[13px] text-violet-200 pt-3 first:pt-0">{l.replace(/^#+\s*/, "")}</p>;
        if (/^\s*[-*•]\s/.test(l)) return <div key={i} className="flex gap-2"><span className="text-violet-400">•</span><span>{bold(l.replace(/^\s*[-*•]\s/, ""))}</span></div>;
        return <p key={i}>{bold(l)}</p>;
      })}
    </div>
  );
}
