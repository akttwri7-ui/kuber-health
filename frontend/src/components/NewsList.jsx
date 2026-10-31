import { ExternalLink, Newspaper } from "lucide-react";
import { Skeleton } from "@/components/Bits";

const ago = (iso) => {
  if (!iso) return "Date unknown";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  const d = new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return m < 60 ? `${Math.max(1, Math.round(m))}m ago · ${d}` : m < 1440 ? `${Math.round(m / 60)}h ago · ${d}` : d;
};

export default function NewsList({ items, loading, testid = "news-list", title = "Latest news" }) {
  return (
    <div className="k-card p-5 sm:p-6 fade-up" data-testid={testid}>
      <div className="flex items-center gap-2 mb-4"><Newspaper className="h-4 w-4 text-blue-300" /><h3 className="font-semibold">{title}</h3></div>
      {loading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> :
        !items?.length ? <p className="text-sm text-slate-500">No recent news could be retrieved right now.</p> : (
          <div className="divide-y divide-white/5">
            {items.map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" data-testid={`${testid}-item-${i}`}
                className="block py-3.5 group">
                <p className="text-sm font-medium text-slate-200 group-hover:text-emerald-300 transition-colors">{n.title} <ExternalLink className="inline h-3 w-3 opacity-50" /></p>
                {n.summary && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{n.summary}</p>}
                <p className="text-[11px] text-slate-500 mt-1.5"><span className="text-slate-400">{n.source}</span> · {ago(n.published_at)}</p>
              </a>
            ))}
          </div>
        )}
      <p className="text-[10px] text-slate-600 mt-3">Headlines link to the original publishers via RSS feeds. Kuber does not write or edit these articles.</p>
    </div>
  );
}
