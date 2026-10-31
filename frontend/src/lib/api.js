import axios from "axios";
import useSWR from "swr";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const http = axios.create({ baseURL: API, withCredentials: true });

let refreshing = null;
http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config;
    if (err.response?.status === 401 && !cfg._retry && !cfg.url.includes("/auth/")) {
      cfg._retry = true;
      try {
        refreshing = refreshing || http.post("/auth/refresh");
        await refreshing;
        refreshing = null;
        return http(cfg);
      } catch (e) {
        refreshing = null;
      }
    }
    return Promise.reject(err);
  }
);

export const fetcher = (url) => http.get(url).then((r) => r.data);
export const useApi = (url, opts) => useSWR(url, fetcher, { revalidateOnFocus: false, ...opts });

export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message || "Something went wrong. Please try again.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x?.msg ? x.msg.replace(/^Value error, /, "") : JSON.stringify(x))).join(" ");
  return d.msg || String(d);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export const fmtINR = (v, precise) => (v == null || isNaN(v) ? "—" : (precise || Math.abs(v) < 100 ? inr2 : inr).format(v));
export const fmtPct = (v, sign = true) => (v == null || isNaN(v) ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}%`);
export const fmtSigned = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "-"}${fmtINR(Math.abs(v))}`);
export const fmtQty = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 8 }));
export const tone = (v) => (v == null ? "text-slate-400" : v >= 0 ? "text-emerald-400" : "text-rose-400");
export const COLORS = ["#10B981", "#8B5CF6", "#3B82F6", "#F59E0B", "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16", "#EF4444"];
