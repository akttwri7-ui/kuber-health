import re
import html
import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
import httpx

from market import _get, _usd_inr, CG

PAP = "https://api.coinpaprika.com/v1"
STABLE_SYMS = ("usdt", "usdc", "dai", "fdusd", "usde", "tusd", "busd", "pyusd", "usds")
db = None
_idx = {"t": 0, "by_id": {}, "by_sn": {}, "by_sym": {}}


async def coin_index():
    """CoinGecko id index (persisted in Mongo) so every source maps back to CoinGecko ids."""
    import time
    if _idx["by_id"] and time.time() - _idx["t"] < 86400:
        return _idx
    doc = await db.coin_index.find_one({"key": "cg"}, {"_id": 0})
    rows = doc["rows"] if doc and time.time() - doc.get("t", 0) < 7 * 86400 else None
    if not rows:
        data, _ = await _get(f"{CG}/coins/list", {}, 86400, "cg-list")
        if isinstance(data, list) and data:
            rows = [[c["id"], c["symbol"].lower(), c["name"]] for c in data]
            await db.coin_index.update_one({"key": "cg"}, {"$set": {"rows": rows, "t": time.time()}}, upsert=True)
        elif doc:
            rows = doc["rows"]
    if rows:
        _idx.update(t=time.time(), by_id={r[0]: r for r in rows},
                    by_sn={(r[1], r[2].lower()): r[0] for r in rows}, by_sym={})
        for r in rows:
            _idx["by_sym"].setdefault(r[1], []).append(r[0])
    return _idx


def to_cg_id(symbol, name, fallback):
    sym = (symbol or "").lower()
    cid = _idx["by_sn"].get((sym, (name or "").lower()))
    if cid:
        return cid
    ids = _idx["by_sym"].get(sym, [])
    return ids[0] if len(ids) == 1 else fallback


async def pap_tickers():
    data, st = await _get(f"{PAP}/tickers", {"quotes": "INR"}, 600, "pap-tickers")
    return (data if isinstance(data, list) else None), st
BN = "https://data-api.binance.vision/api/v3/klines"


def _cg_row(m):
    return {"id": m["id"], "symbol": m["symbol"], "name": m["name"], "image": m.get("image"),
            "price": m.get("current_price"), "change_24h": m.get("price_change_percentage_24h"),
            "market_cap": m.get("market_cap"), "volume": m.get("total_volume"), "rank": m.get("market_cap_rank")}


def _pap_row(t):
    q = t["quotes"]["INR"]
    return {"id": to_cg_id(t["symbol"], t["name"], t["id"].split("-", 1)[1] if "-" in t["id"] else t["id"]), "symbol": t["symbol"].lower(), "name": t["name"],
            "image": f"https://static.coinpaprika.com/coin/{t['id']}/logo.png", "price": q.get("price"),
            "change_24h": q.get("percent_change_24h"), "market_cap": q.get("market_cap"), "volume": q.get("volume_24h"), "rank": t.get("rank")}


async def top_markets():
    """Top ~250 coins in INR. CoinGecko first, CoinPaprika fallback."""
    data, st = await _get(f"{CG}/coins/markets", {"vs_currency": "inr", "order": "market_cap_desc", "per_page": 250, "page": 1}, 300, "top250")
    if data:
        return [_cg_row(m) for m in data], ("live" if st == "live" else "cached"), "CoinGecko"
    await coin_index()
    data, st = await pap_tickers()
    if data:
        rows = sorted((t for t in data if t.get("rank")), key=lambda t: t["rank"])[:250]
        return [_pap_row(t) for t in rows], ("live" if st == "live" else "cached"), "CoinPaprika"
    return [], "unavailable", None


async def overview():
    rows, st, src = await top_markets()
    g, gst = await _get(f"{CG}/global", {}, 600, "cg-global")
    glob = None
    if g and g.get("data"):
        d = g["data"]
        glob = {"market_cap": d["total_market_cap"].get("inr"), "volume": d["total_volume"].get("inr"),
                "btc_dominance": d["market_cap_percentage"].get("btc"), "change_24h": d.get("market_cap_change_percentage_24h_usd"),
                "coins": d.get("active_cryptocurrencies"), "source": "CoinGecko", "status": "live" if gst == "live" else "cached"}
    else:
        p, pst = await _get(f"{PAP}/global", {}, 600, "pap-global")
        fx = await _usd_inr()
        if p and fx:
            glob = {"market_cap": p["market_cap_usd"] * fx, "volume": p["volume_24h_usd"] * fx,
                    "btc_dominance": p.get("bitcoin_dominance_percentage"), "change_24h": p.get("market_cap_change_24h"),
                    "coins": p.get("cryptocurrencies_number"), "source": "CoinPaprika", "status": "live" if pst == "live" else "cached"}
    t, _ = await _get(f"{CG}/search/trending", {}, 900, "cg-trending")
    by_id = {r["id"]: r for r in rows}
    if t and t.get("coins"):
        trending = [{"id": c["item"]["id"], "symbol": c["item"]["symbol"].lower(), "name": c["item"]["name"],
                     "image": c["item"].get("large") or c["item"].get("thumb"),
                     "price": by_id.get(c["item"]["id"], {}).get("price"),
                     "change_24h": by_id.get(c["item"]["id"], {}).get("change_24h"), "rank": c["item"].get("market_cap_rank")}
                    for c in t["coins"][:8]]
        trending_src = "CoinGecko trending searches"
    else:
        trending = sorted((r for r in rows[:100] if r["symbol"] not in STABLE_SYMS), key=lambda r: -(r["volume"] or 0))[:8]
        trending_src = "Highest 24h volume (trending feed unavailable)"
    liquid = [r for r in rows[:150] if r["change_24h"] is not None]
    liquid.sort(key=lambda r: r["change_24h"])
    return {"global": glob, "trending": trending, "trending_source": trending_src,
            "gainers": liquid[::-1][:6], "losers": liquid[:6], "top": rows[:20], "status": st, "source": src,
            "updated_at": datetime.now(timezone.utc).isoformat()}


async def search(q):
    rows, _, _ = await top_markets()
    by_id = {r["id"]: r for r in rows}
    res = []
    if q:
        data, _ = await _get(f"{CG}/search", {"query": q.lower()}, 3600, f"s:{q.lower()}")
        if data and data.get("coins") is not None:
            res = [{"id": c["id"], "symbol": c["symbol"].lower(), "name": c["name"], "thumb": c.get("large") or c.get("thumb")} for c in data["coins"][:12]]
        else:
            ql = q.lower().strip()
            idx = await coin_index()
            rank = {r["id"]: r["rank"] or 9999 for r in rows}
            hits = [r for r in idx["by_id"].values() if r[1] == ql or r[2].lower().startswith(ql) or r[0] == ql]
            hits.sort(key=lambda r: (rank.get(r[0], 99999), r[1] != ql))
            res = [{"id": r[0], "symbol": r[1], "name": r[2], "thumb": None} for r in hits[:12]]
    if not q:
        res = [{"id": r["id"], "symbol": r["symbol"], "name": r["name"], "thumb": r["image"]} for r in rows[:10]] or res
    return [{**c, "thumb": c.get("thumb") or by_id.get(c["id"], {}).get("image"),
             "price": by_id.get(c["id"], {}).get("price"), "change_24h": by_id.get(c["id"], {}).get("change_24h")} for c in res]


def _clean(s, n=600):
    s = html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()
    return s[:n] + ("…" if len(s) > n else "")


async def coin_detail(cid, symbol=None):
    d, st = await _get(f"{CG}/coins/{cid}", {"localization": "false", "tickers": "false", "community_data": "false",
                                             "developer_data": "false", "sparkline": "false"}, 900, f"cg-coin:{cid}")
    if d and d.get("market_data"):
        m = d["market_data"]
        inr = lambda k: (m.get(k) or {}).get("inr")
        links = d.get("links") or {}
        hp = [u for u in (links.get("homepage") or []) if u]
        socials = []
        if links.get("twitter_screen_name"):
            socials.append({"name": "X / Twitter", "url": f"https://x.com/{links['twitter_screen_name']}"})
        if links.get("subreddit_url"):
            socials.append({"name": "Reddit", "url": links["subreddit_url"]})
        for u in (links.get("chat_url") or [])[:2]:
            if u:
                socials.append({"name": "Community chat", "url": u})
        repos = (links.get("repos_url") or {}).get("github") or []
        if repos:
            socials.append({"name": "GitHub", "url": repos[0]})
        return {
            "id": d["id"], "symbol": d["symbol"], "name": d["name"], "image": (d.get("image") or {}).get("large"),
            "rank": d.get("market_cap_rank"), "price": inr("current_price"), "market_cap": inr("market_cap"),
            "fdv": inr("fully_diluted_valuation"), "volume": inr("total_volume"),
            "high_24h": inr("high_24h"), "low_24h": inr("low_24h"),
            "circulating_supply": m.get("circulating_supply"), "total_supply": m.get("total_supply"), "max_supply": m.get("max_supply"),
            "ath": inr("ath"), "ath_date": (m.get("ath_date") or {}).get("inr"), "ath_change": (m.get("ath_change_percentage") or {}).get("inr"),
            "atl": inr("atl"), "atl_date": (m.get("atl_date") or {}).get("inr"),
            "change": {"24h": (m.get("price_change_percentage_24h_in_currency") or {}).get("inr"),
                       "7d": (m.get("price_change_percentage_7d_in_currency") or {}).get("inr"),
                       "30d": (m.get("price_change_percentage_30d_in_currency") or {}).get("inr"),
                       "1y": (m.get("price_change_percentage_1y_in_currency") or {}).get("inr")},
            "description": _clean((d.get("description") or {}).get("en"), 2500),
            "categories": [c for c in (d.get("categories") or []) if c][:6],
            "hashing_algorithm": d.get("hashing_algorithm"),
            "platforms": [k for k in (d.get("platforms") or {}) if k][:5],
            "genesis_date": d.get("genesis_date"),
            "website": hp[0] if hp else None, "whitepaper": links.get("whitepaper") or None,
            "explorers": [u for u in (links.get("blockchain_site") or []) if u][:3], "socials": socials,
            "source": "CoinGecko", "status": "live" if st == "live" else "cached",
        }
    if not symbol:
        return None
    idx = await coin_index()
    name = (idx["by_id"].get(cid) or [None, None, ""])[2].lower()
    tickers, tst = await pap_tickers()
    sym = symbol.upper()
    cands = [x for x in (tickers or []) if x["symbol"] == sym]
    t = next((x for x in cands if x["name"].lower() == name), None) or (min(cands, key=lambda x: x.get("rank") or 99999) if cands else None)
    if not t or not t.get("quotes"):
        return await _binance_detail(cid, symbol, idx)
    pid = t["id"]
    c, _ = await _get(f"{PAP}/coins/{pid}", {}, 21600, f"pap-coin:{pid}")
    q = t["quotes"]["INR"]
    c = c or {}
    lk = c.get("links") or {}
    socials = [{"name": k.replace("_", " ").title(), "url": v[0]} for k, v in lk.items() if k in ("reddit", "source_code", "facebook", "youtube") and v]
    socials += [{"name": x.get("type", "link").title(), "url": x["url"]} for x in (c.get("links_extended") or []) if x.get("type") == "twitter"][:1]
    return {
        "id": cid, "symbol": symbol.lower(), "name": t["name"], "image": c.get("logo"), "rank": t.get("rank"),
        "price": q.get("price"), "market_cap": q.get("market_cap"), "fdv": None, "volume": q.get("volume_24h"),
        "high_24h": None, "low_24h": None,
        "circulating_supply": t.get("circulating_supply"), "total_supply": t.get("total_supply"), "max_supply": t.get("max_supply") or None,
        "ath": q.get("ath_price"), "ath_date": q.get("ath_date"), "ath_change": q.get("percent_from_price_ath"), "atl": None, "atl_date": None,
        "change": {"24h": q.get("percent_change_24h"), "7d": q.get("percent_change_7d"), "30d": q.get("percent_change_30d"), "1y": q.get("percent_change_1y")},
        "description": re.sub(r"\s*Source:\s*CoinPaprika\.com\s*$", "", _clean(c.get("description"), 2500)), "categories": [x["name"] for x in (c.get("tags") or [])][:6],
        "hashing_algorithm": c.get("hash_algorithm") if c.get("hash_algorithm") not in (None, "None", "") else None, "platforms": [c["proof_type"]] if c.get("proof_type") else [],
        "genesis_date": (c.get("started_at") or "")[:10] or None,
        "website": (lk.get("website") or [None])[0], "whitepaper": (c.get("whitepaper") or {}).get("link"),
        "explorers": (lk.get("explorer") or [])[:3], "socials": socials,
        "source": "CoinPaprika (CoinGecko unavailable)", "status": "live" if tst == "live" else "cached",
    }


async def _binance_detail(cid, symbol, idx):
    k, st = await binance_klines(symbol, "1d", 366)
    fx = await _usd_inr()
    if not k or not fx or len(k) < 2:
        return None
    closes = [float(r[4]) * fx for r in k]
    ch = lambda n: (closes[-1] / closes[-1 - n] - 1) * 100 if len(closes) > n else None
    row = idx["by_id"].get(cid) or [cid, symbol.lower(), symbol.upper()]
    return {"id": cid, "symbol": symbol.lower(), "name": row[2], "image": None, "rank": None, "price": closes[-1],
            "market_cap": None, "fdv": None, "volume": float(k[-1][7]) * fx, "high_24h": float(k[-1][2]) * fx, "low_24h": float(k[-1][3]) * fx,
            "circulating_supply": None, "total_supply": None, "max_supply": None, "ath": None, "ath_date": None, "ath_change": None,
            "atl": None, "atl_date": None, "change": {"24h": ch(1), "7d": ch(7), "30d": ch(30), "1y": ch(365)},
            "description": "", "categories": [], "hashing_algorithm": None, "platforms": [], "genesis_date": None,
            "website": None, "whitepaper": None, "explorers": [], "socials": [],
            "source": "Binance only — coin metadata providers are temporarily rate-limited", "status": "live" if st == "live" else "cached"}


PERIOD_BN = {"1": ("1h", 25), "7": ("4h", 43), "30": ("1d", 31), "90": ("1d", 91), "365": ("1d", 366), "max": ("1w", 1000)}


async def binance_klines(symbol, interval, limit):
    sym = symbol.upper()
    ttl = 60 if interval in ("5m", "15m", "1h") else 300
    data, st = await _get(BN, {"symbol": f"{sym}USDT", "interval": interval, "limit": limit}, ttl, f"bk:{sym}:{interval}:{limit}")
    return (data if isinstance(data, list) and data else None), st


async def coin_history(cid, symbol, days):
    data, st = await _get(f"{CG}/coins/{cid}/market_chart", {"vs_currency": "inr", "days": days}, 600, f"cg-mc:{cid}:{days}")
    if data and data.get("prices"):
        pts = [[t, p] for t, p in data["prices"]]
        src = "CoinGecko"
    else:
        pts, src = None, None
        if symbol and days in PERIOD_BN:
            iv, lim = PERIOD_BN[days]
            k, st = await binance_klines(symbol, iv, lim)
            fx = await _usd_inr()
            if k and fx:
                pts = [[r[0], float(r[4]) * fx] for r in k]
                src = "Binance (USDT × USD/INR)"
    if not pts:
        return {"points": [], "source": None, "status": "unavailable"}
    prices = [p for _, p in pts]
    return {"points": pts, "source": src, "status": "live" if st == "live" else "cached",
            "high": max(prices), "low": min(prices), "change_pct": (prices[-1] / prices[0] - 1) * 100 if prices[0] else None,
            "first_date": pts[0][0]}


def _parse_rss(xml_text, default_source):
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src_el = it.find("source")
        source = src_el.text.strip() if src_el is not None and src_el.text else default_source
        if src_el is not None and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).isoformat()
        except Exception:
            pub = None
        summary = _clean(it.findtext("description"), 260) if default_source != "Google News" else ""
        if title and link:
            out.append({"title": html.unescape(title), "url": link, "source": source, "published_at": pub, "summary": summary})
    return out


async def _rss(url, source, key):
    from market import _cache
    import time
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < 900:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0 KuberCrypto"})
        items = _parse_rss(r.text, source) if r.status_code == 200 else []
    except Exception:
        items = []
    if items:
        _cache[key] = (time.time(), items)
        return items
    return hit[1] if hit else []


def _sort(items):
    return sorted(items, key=lambda x: x["published_at"] or "", reverse=True)


async def general_news():
    a, b = await asyncio.gather(_rss("https://cointelegraph.com/rss", "Cointelegraph", "rss-ct"),
                                _rss("https://decrypt.co/feed", "Decrypt", "rss-dc"))
    return _sort(a[:15] + b[:15])[:20]


async def coin_news(name, symbol):
    q = f'"{name}" crypto'.replace(" ", "+")
    items = await _rss(f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en", "Google News", f"rss-g:{name}")
    return _sort(items)[:12]
