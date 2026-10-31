import time
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)
CG = "https://api.coingecko.com/api/v3"
_cache = {}
_locks = {}
_fail = {}

# Labeled demo prices (INR) used only when the live API is unreachable and nothing is cached
DEMO_PRICES = {
    "bitcoin": ("btc", "Bitcoin", 7300000, 1.2, 3.5),
    "ethereum": ("eth", "Ethereum", 280000, -0.8, 2.1),
    "solana": ("sol", "Solana", 14000, 2.5, 6.0),
    "binancecoin": ("bnb", "BNB", 55000, 0.4, 1.0),
    "ripple": ("xrp", "XRP", 190, -1.5, -3.0),
    "cardano": ("ada", "Cardano", 60, -2.0, -4.5),
    "dogecoin": ("doge", "Dogecoin", 15, 4.0, 9.0),
    "tether": ("usdt", "Tether", 85, 0.0, 0.0),
    "polkadot": ("dot", "Polkadot", 600, -1.0, -2.0),
    "matic-network": ("matic", "Polygon", 45, 1.0, 2.0),
}

POPULAR = [
    {"id": k, "symbol": v[0], "name": v[1], "thumb": None} for k, v in DEMO_PRICES.items()
]


db = None


async def _persisted(key):
    if db is None:
        return None
    doc = await db.api_cache.find_one({"key": key}, {"_id": 0})
    return (doc["t"], doc["data"]) if doc else None


async def _get(url, params, ttl, key):
    """Cached GET. Successful long-lived responses are also persisted so stale data survives restarts and rate limits."""
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1], "live"
    if not hit and ttl >= 300:
        hit = await _persisted(key)
        if hit:
            _cache[key] = hit
            if time.time() - hit[0] < ttl:
                return hit[1], "live"
    host = url.split("/")[2]
    if time.time() - _fail.get(host, 0) < 60:
        return (hit[1], "stale") if hit else (None, "unavailable")
    async with _locks.setdefault(host, asyncio.Lock()):
        cur = _cache.get(key)
        if cur and time.time() - cur[0] < ttl:
            return cur[1], "live"
        try:
            async with httpx.AsyncClient(timeout=12) as c:
                r = await c.get(url, params=params, headers={"accept": "application/json"})
            if r.status_code == 200:
                data = r.json()
                _cache[key] = (time.time(), data)
                if ttl >= 300 and db is not None:
                    try:
                        await db.api_cache.update_one({"key": key}, {"$set": {"t": time.time(), "data": data}}, upsert=True)
                    except Exception as e:
                        logger.warning("cache persist failed %s: %s", key, e)
                return data, "live"
            logger.warning("Price API %s -> %s", url, r.status_code)
            if r.status_code in (402, 403, 429) or r.status_code >= 500:
                _fail[host] = time.time() + (600 if r.status_code == 402 else 0)
            elif not hit:
                _cache[key] = (time.time(), None)
        except Exception as e:
            logger.warning("Price API error %s: %s", url, e)
            _fail[host] = time.time()
    if hit and hit[1] is not None:
        return hit[1], "stale"
    return None, "unavailable"


async def _usd_inr():
    data, _ = await _get("https://open.er-api.com/v6/latest/USD", {}, 3600, "fx")
    return (data or {}).get("rates", {}).get("INR")


async def _klines(sym):
    data, _ = await _get("https://data-api.binance.vision/api/v3/klines",
                         {"symbol": f"{sym}USDT", "interval": "1d", "limit": 366}, 600, f"b:{sym}")
    return data if isinstance(data, list) and len(data) > 1 else None


async def _binance_markets(pairs):
    fx = await _usd_inr()
    if not fx:
        return {}
    out = {}
    for cid, sym in pairs.items():
        sym = (sym or "").upper()
        if sym == "USDT":
            out[cid] = {"price": fx, "change_24h": 0, "change_7d": 0, "image": None, "symbol": "usdt", "name": "Tether"}
            continue
        k = await _klines(sym)
        if not k:
            continue
        last, prev, wk = float(k[-1][4]), float(k[-2][4]), float(k[-8][4]) if len(k) > 8 else None
        out[cid] = {"price": last * fx, "change_24h": (last / prev - 1) * 100,
                    "change_7d": (last / wk - 1) * 100 if wk else None, "image": None, "symbol": sym.lower(), "name": None}
    return out


async def get_markets(pairs):
    """pairs: {coin_id: symbol}. Returns ({coin_id: market}, status) where status is live|stale|demo."""
    ids = sorted(pairs)
    if not ids:
        return {}, "live"
    data, status = await _get(
        f"{CG}/coins/markets",
        {"vs_currency": "inr", "ids": ",".join(ids), "price_change_percentage": "24h,7d", "per_page": 250},
        90, f"m:{','.join(ids)}",
    )
    if data is not None and status == "live":
        out = {}
        for m in data:
            out[m["id"]] = {
                "price": m.get("current_price") or 0,
                "change_24h": m.get("price_change_percentage_24h_in_currency") or m.get("price_change_percentage_24h") or 0,
                "change_7d": m.get("price_change_percentage_7d_in_currency"),
                "image": m.get("image"),
                "symbol": m.get("symbol"),
                "name": m.get("name"),
            }
        return out, status
    fb = await _binance_markets(pairs)
    if fb:
        return fb, "live"
    if data is not None:
        return {m["id"]: {"price": m.get("current_price") or 0, "change_24h": m.get("price_change_percentage_24h") or 0,
                          "change_7d": m.get("price_change_percentage_7d_in_currency"), "image": m.get("image"),
                          "symbol": m.get("symbol"), "name": m.get("name")} for m in data}, "stale"
    out = {}
    for i in ids:
        if i in DEMO_PRICES:
            s, n, p, c24, c7 = DEMO_PRICES[i]
            out[i] = {"price": p, "change_24h": c24, "change_7d": c7, "image": None, "symbol": s, "name": n}
    return out, "demo"


async def get_history(coin_id, symbol, days, inr_price):
    """Daily INR prices [[ms, price], ...] or None. Binance USDT candles scaled to the live INR price; CoinGecko fallback."""
    sym = (symbol or "").upper()
    if sym and sym not in ("USDT",) and inr_price:
        data = await _klines(sym)
        if data:
            factor = inr_price / float(data[-1][4])
            return [[k[0], float(k[4]) * factor] for k in data][-(days + 1):]
    data, _ = await _get(
        f"{CG}/coins/{coin_id}/market_chart",
        {"vs_currency": "inr", "days": 365, "interval": "daily"},
        1800, f"h:{coin_id}",
    )
    if not data or not data.get("prices"):
        return None
    return data["prices"][-(days + 1):]


async def search_coins(q):
    q = (q or "").strip().lower()
    if not q:
        return POPULAR
    data, _ = await _get(f"{CG}/search", {"query": q}, 3600, f"s:{q}")
    if data and data.get("coins") is not None:
        return [
            {"id": c["id"], "symbol": c["symbol"].lower(), "name": c["name"], "thumb": c.get("large") or c.get("thumb")}
            for c in data["coins"][:12]
        ]
    return [c for c in POPULAR if q in c["id"] or q in c["symbol"] or q in c["name"].lower()]
