import time
import uuid
from datetime import datetime, timezone

from market import _usd_inr
import explore

DAY = 86400000
INTERVAL_SEC = {"1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800}
HIGHER_TF = {"1h": "1d", "4h": "1d", "1d": "1w", "1w": "1w"}
_decisions = {}


async def price_series(cid, symbol, months):
    """Daily (or weekly for long windows) INR closes [[ms, price]]; Binance USDT×USD/INR first, CoinGecko INR fallback."""
    iv, lim = ("1d", 1000) if months <= 32 else ("1w", 1000)
    k, st = await explore.binance_klines(symbol, iv, lim)
    fx = await _usd_inr()
    if k and fx:
        return [[r[0], float(r[4]) * fx] for r in k], f"Binance {symbol.upper()}/USDT {iv} closes × current USD/INR", st
    h = await explore.coin_history(cid, symbol, "365")
    if h["points"]:
        return h["points"], h["source"], h["status"]
    return [], None, "unavailable"


def _price_on(pts, t):
    for ts, p in pts:
        if ts >= t:
            return ts, p
    return pts[-1]


def simulate(pts, amount, months, freq):
    end = pts[-1][0]
    start = end - months * 30.44 * DAY
    if pts[0][0] > start + 15 * DAY:
        return None
    step = 7 * DAY if freq == "weekly" else 30.44 * DAY
    per = amount * 12 / 52 if freq == "weekly" else amount
    units = invested = 0.0
    series, t = [], start
    while t <= end:
        ts, p = _price_on(pts, t)
        units += per / p
        invested += per
        series.append({"t": ts, "invested": round(invested, 2), "value": round(units * p, 2), "price": p})
        t += step
    final = units * pts[-1][1]
    years = months / 12
    gain = final - invested
    return {"invested": invested, "value": final, "gain": gain, "abs_return_pct": gain / invested * 100 if invested else 0,
            "cagr_pct": ((final / invested) ** (1 / years) - 1) * 100 if years >= 1 and invested and final > 0 else None,
            "units": units, "avg_cost": invested / units if units else None, "instalments": len(series),
            "lump_sum_value": invested * pts[-1][1] / _price_on(pts, start)[1],
            "series": series + [{"t": pts[-1][0], "invested": round(invested, 2), "value": round(final, 2), "price": pts[-1][1]}]}


async def calculate(cid, symbol, amount, months, freq):
    pts, src, st = await price_series(cid, symbol, max(months, 36))
    if len(pts) < 30:
        return {"available": False, "reason": "Historical price data is unavailable for this coin."}
    main = simulate(pts, amount, months, freq)
    if not main:
        first = datetime.fromtimestamp(pts[0][0] / 1000, timezone.utc).strftime("%b %Y")
        return {"available": False, "reason": f"Not enough history for a {months}-month SIP (data starts {first})."}
    grid = []
    for mult in (0.5, 1, 2):
        row = {"amount": amount * mult, "results": []}
        for m in (6, 12, 24, 36):
            r = simulate(pts, amount * mult, m, freq)
            row["results"].append({"months": m, **({"invested": r["invested"], "value": r["value"], "abs_return_pct": r["abs_return_pct"]} if r else {"invested": None})})
        grid.append(row)
    return {"available": True, **main, "comparison": grid, "source": src, "status": st,
            "data_from": pts[0][0], "data_to": pts[-1][0],
            "disclaimer": "Historical back-test using past prices. Past returns do not guarantee future returns."}


def _score(ltf, htf, interval, htf_iv):
    """Combine indicators from the chart timeframe and the higher timeframe into one score with reasons."""
    reasons, pts = [], []

    def add(v, why):
        pts.append(v)
        reasons.append({"impact": "positive" if v > 0 else "negative" if v < 0 else "neutral", "text": why})

    tmap = {"Bullish": 1, "Bearish": -1, "Sideways": 0}
    add(1.5 * tmap[htf["rule_based_trend"]], f"Higher timeframe ({htf_iv}) trend is {htf['rule_based_trend'].lower()} (price vs EMA20/SMA50 and SMA50 slope).")
    add(1.0 * tmap[ltf["rule_based_trend"]], f"Chart timeframe ({interval}) trend is {ltf['rule_based_trend'].lower()}.")
    rsi = ltf["rsi14"]
    if rsi is not None:
        v = 1 if rsi < 30 else 0.5 if rsi < 45 else 0 if rsi <= 65 else -0.5 if rsi <= 75 else -1
        add(v, f"RSI(14) is {rsi:.1f} — " + ("oversold, historically a better accumulation zone." if rsi < 30 else "cooling, not overheated." if rsi < 45 else "neutral." if rsi <= 65 else "elevated, entries are pricier." if rsi <= 75 else "overbought, high pullback risk."))
    h, hp = ltf["macd_hist"], ltf["macd_hist_prev"]
    if h is not None and hp is not None:
        v = 0.5 if h > 0 and h >= hp else 0.25 if h > 0 else -0.5 if h < 0 and h <= hp else -0.25
        add(v, f"MACD histogram is {h:+.2f} and {'rising' if h >= hp else 'falling'} — " + ("bullish momentum building." if h > 0 and h >= hp else "bullish but fading." if h > 0 else "bearish momentum deepening." if h <= hp else "bearish, though easing."))
    if htf["rsi14"] is not None and htf["macd_hist"] is not None:
        add(0.5 if htf["macd_hist"] > 0 else -0.5, f"Higher-timeframe MACD momentum is {'positive' if htf['macd_hist'] > 0 else 'negative'}.")
    b = ltf.get("breakout") or ""
    vol_up = (ltf.get("volume_last5_vs_prior20_pct") or 0) > 15
    if b.startswith("breakout"):
        add(0.75 if vol_up else 0.25, f"Price made a {b}" + (" with rising volume (confirmation)." if vol_up else " but volume is not confirming."))
    elif b.startswith("breakdown"):
        add(-1, f"Price made a {b} — bearish structure.")
    d = ltf.get("divergence") or ""
    if d.startswith("bullish"):
        add(0.5, f"RSI divergence: {d}.")
    elif d.startswith("bearish"):
        add(-0.5, f"RSI divergence: {d}.")
    last = ltf["last_close"]
    if ltf["resistance"]:
        dist = (ltf["resistance"][0]["price"] / last - 1) * 100
        if dist < 2:
            add(-0.5, f"Nearest resistance is only {dist:.1f}% above price — limited room before a likely test.")
    if ltf["support"]:
        dist = (1 - ltf["support"][0]["price"] / last) * 100
        if dist < 3:
            add(0.25, f"Price is {dist:.1f}% above nearest support — downside to that level is limited.")
    return sum(pts), pts, reasons


async def strategy(body, holding_ctx, concentration_limit):
    interval = body["interval"]
    htf_iv = HIGHER_TF[interval]
    candles, _, ltf, st, _ = await body["load_chart"](body["symbol"], interval)
    htf_c, _, htf, hst, _ = await body["load_chart"](body["symbol"], htf_iv)
    base = {"symbol": body["symbol"].upper(), "name": body["name"], "interval": interval, "higher_timeframe": htf_iv,
            "price": ltf["last_close"], "data_time": datetime.fromtimestamp(candles[-1]["time"], timezone.utc).isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(), "budget": body.get("budget"), "risk": body["risk"],
            "horizon_years": body["horizon_years"], "holding": holding_ctx}
    age = time.time() - candles[-1]["time"]
    if len(candles) < 60 or len(htf_c) < 30 or st != "live" or age > 2 * INTERVAL_SEC[interval]:
        return {**base, "status": "INSUFFICIENT DATA", "insufficient": True,
                "reason": "Market data is missing, stale or too short to produce a reliable recommendation. No allocation is suggested."}

    score, parts, reasons = _score(ltf, htf, interval, htf_iv)
    atr = htf.get("atr14_pct") or ltf.get("atr14_pct") or 0
    vol_level = "high" if atr > (6 if htf_iv == "1d" else 12) else "moderate" if atr > (3 if htf_iv == "1d" else 6) else "low"
    if vol_level == "high":
        score -= 0.5
        reasons.append({"impact": "negative", "text": f"Volatility is high (ATR ≈ {atr:.1f}% of price on {htf_iv}) — phased entries reduce timing risk."})
    else:
        reasons.append({"impact": "neutral", "text": f"Volatility is {vol_level} (ATR ≈ {atr:.1f}% of price on {htf_iv})."})

    if score <= -2.5:
        status = "NO NEW POSITION"
    elif score <= -1:
        status = "WAIT FOR BETTER ENTRY"
    elif score < 1.5:
        status = "ACCUMULATE THROUGH SIP"
    elif score < 3 or vol_level == "high":
        status = "HYBRID STRATEGY"
    else:
        status = "LUMP SUM ENTRY"

    risk = body["risk"]
    horizon = body["horizon_years"]
    order = ["NO NEW POSITION", "WAIT FOR BETTER ENTRY", "ACCUMULATE THROUGH SIP", "HYBRID STRATEGY", "LUMP SUM ENTRY"]
    if risk == "conservative" and status in ("LUMP SUM ENTRY", "HYBRID STRATEGY"):
        status = order[order.index(status) - 1]
        reasons.append({"impact": "neutral", "text": "Conservative risk profile steps the strategy down one level."})
    if horizon < 1 and status in ("LUMP SUM ENTRY", "HYBRID STRATEGY"):
        status = "ACCUMULATE THROUGH SIP"
        reasons.append({"impact": "negative", "text": "Investment horizon under 1 year is short for a volatile asset — gradual entry only."})

    cur_alloc = (holding_ctx or {}).get("allocation_pct") or 0
    if cur_alloc >= concentration_limit and status not in ("NO NEW POSITION", "WAIT FOR BETTER ENTRY"):
        status = "NO NEW POSITION"
        reasons.append({"impact": "negative", "text": f"{body['symbol'].upper()} is already {cur_alloc:.1f}% of your portfolio (limit {concentration_limit:g}%). Adding more increases concentration risk."})

    if not (holding_ctx or {}).get("holdings_count"):
        reasons.append({"impact": "neutral", "text": "You have no saved holdings yet, so this coin would be 100% of your tracked crypto portfolio."})
    mult = {"conservative": 0.7, "moderate": 1.0, "aggressive": 1.25}[risk]
    if horizon < 1:
        mult *= 0.7
    if cur_alloc > 25:
        mult *= 0.7
    base_alloc = {"NO NEW POSITION": (0, 0), "WAIT FOR BETTER ENTRY": (0, 0), "ACCUMULATE THROUGH SIP": (0, 0.6),
                  "HYBRID STRATEGY": (0.25, 0.45), "LUMP SUM ENTRY": (0.55, 0.15)}[status]
    lump_pct = min(0.7, base_alloc[0] * mult)
    sip_pct = min(0.8 - lump_pct, base_alloc[1] * mult)
    reserve_pct = 1 - lump_pct - sip_pct
    sip_months = 12 if status == "ACCUMULATE THROUGH SIP" else 6
    alloc = {"lump_pct": round(lump_pct * 100, 1), "sip_pct": round(sip_pct * 100, 1), "reserve_pct": round(reserve_pct * 100, 1),
             "sip_months": sip_months if sip_pct else 0, "frequency": "weekly" if vol_level == "high" and sip_pct else "monthly"}
    budget = body.get("budget")
    amounts = None
    if budget:
        lump = round(budget * lump_pct, -2)
        sip_total = round(budget * sip_pct, -2)
        per = sip_total / sip_months if sip_pct else 0
        if alloc["frequency"] == "weekly":
            per = sip_total / round(sip_months * 52 / 12)
        reserve = budget - lump - sip_total
        amounts = {"lump_sum": lump, "sip_total": sip_total, "sip_per_instalment": round(per, 2), "reserve": reserve,
                   "instalments": (round(sip_months * 52 / 12) if alloc["frequency"] == "weekly" else sip_months) if sip_pct else 0}
        price = ltf["last_close"]
        if holding_ctx and holding_ctx.get("portfolio_value") is not None:
            pv = holding_ctx["portfolio_value"]
            cv = holding_ctx.get("value") or 0
            new_pv = pv + lump
            amounts["allocation_after_lump_pct"] = (cv + lump) / new_pv * 100 if new_pv else None
            amounts["allocation_after_full_pct"] = (cv + lump + sip_total) / (pv + lump + sip_total) * 100 if pv + lump + sip_total else None
        amounts["units_now"] = lump / price if price else None

    agree = sum(1 for p in parts if (p > 0) == (score > 0) and p != 0)
    nonzero = sum(1 for p in parts if p != 0) or 1
    conf = round(min(90, max(35, 40 + 50 * agree / nonzero * min(1, abs(score) / 3 + 0.4))))
    condition = (f"{htf['rule_based_trend']} on {htf_iv}, {ltf['rule_based_trend'].lower()} on {interval}; "
                 f"{vol_level} volatility; {ltf.get('breakout') or 'range unknown'}")
    triggers = []
    if status in ("NO NEW POSITION", "WAIT FOR BETTER ENTRY"):
        if ltf["resistance"]:
            triggers.append(f"A daily close back above ₹{ltf['resistance'][0]['price']:,.2f} (nearest resistance) with rising volume.")
        triggers.append(f"Higher-timeframe ({htf_iv}) trend turning sideways or bullish.")
        triggers.append("MACD histogram turning positive and RSI recovering above 45.")
    strategies = {
        "LUMP SUM ENTRY": {"fit": "high" if status == "LUMP SUM ENTRY" else "low" if score < 1 else "medium",
                           "summary": "Deploy a larger share now. Suits strong, confirmed uptrends with moderate volatility."},
        "ACCUMULATE THROUGH SIP": {"fit": "high" if status == "ACCUMULATE THROUGH SIP" else "medium" if score > -2.5 else "low",
                                   "summary": "Spread purchases over time to average out volatile prices and reduce timing risk."},
        "HYBRID STRATEGY": {"fit": "high" if status == "HYBRID STRATEGY" else "medium" if score >= 0 else "low",
                            "summary": "Part now, part via SIP, part reserved — balances opportunity with entry-timing risk."},
        "WAIT / NO NEW POSITION": {"fit": "high" if status in ("NO NEW POSITION", "WAIT FOR BETTER ENTRY") else "low",
                                   "summary": "Keep capital aside when structure is bearish, risk is elevated, or you're already concentrated."},
    }
    did = uuid.uuid4().hex[:12]
    out = {**base, "id": did, "status": status, "insufficient": False, "score": round(score, 2), "confidence": conf,
           "market_condition": condition, "volatility": vol_level, "atr_pct": atr, "allocation": alloc, "amounts": amounts,
           "reasons": reasons, "reconsider_if": triggers, "strategies": strategies,
           "levels": {"support": ltf["support"], "resistance": ltf["resistance"]},
           "indicators": {k: ltf.get(k) for k in ("rsi14", "macd_hist", "sma20", "sma50", "ema20", "atr14_pct", "breakout", "divergence",
                                                    "volume_last5_vs_prior20_pct", "latest_pattern", "rule_based_trend")},
           "htf_indicators": {k: htf.get(k) for k in ("rsi14", "macd_hist", "sma50", "ema20", "atr14_pct", "rule_based_trend")},
           "budget_missing": not budget}
    _decisions[did] = out
    if len(_decisions) > 500:
        _decisions.pop(next(iter(_decisions)))
    return out


def get_decision(did):
    return _decisions.get(did)
