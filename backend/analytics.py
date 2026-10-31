import math
from datetime import datetime, timezone
from market import get_markets, get_history

STABLES = {"tether", "usd-coin", "dai", "first-digital-usd", "true-usd", "ethena-usde"}
MEMES = {"dogecoin", "shiba-inu", "pepe", "bonk", "dogwifcoin", "floki"}


def _ts(date_str):
    try:
        return datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc).timestamp() * 1000
    except Exception:
        return 0


async def build_summary(holdings):
    markets, status = await get_markets({h["coin_id"]: h["symbol"] for h in holdings})
    rows, total_value, total_invested, prev_value = [], 0.0, 0.0, 0.0
    for h in holdings:
        m = markets.get(h["coin_id"])
        price = m["price"] if m else None
        invested = h["quantity"] * h["avg_price"]
        value = h["quantity"] * price if price is not None else None
        ch24 = (m or {}).get("change_24h") or 0
        row = {
            **h,
            "image": (m or {}).get("image") or h.get("image"),
            "current_price": price,
            "change_24h": ch24,
            "change_7d": (m or {}).get("change_7d"),
            "invested": invested,
            "value": value,
            "pnl": (value - invested) if value is not None else None,
            "pnl_pct": ((value - invested) / invested * 100) if value is not None and invested > 0 else None,
            "price_available": price is not None,
        }
        rows.append(row)
        total_invested += invested
        if value is not None:
            total_value += value
            prev_value += value / (1 + ch24 / 100) if ch24 > -100 else value
    for r in rows:
        r["allocation"] = (r["value"] / total_value * 100) if r["value"] and total_value > 0 else 0
    rows.sort(key=lambda r: r["value"] or 0, reverse=True)
    pnl = total_value - total_invested
    change_24h = total_value - prev_value
    # Weekly summary from 7d price changes
    week_prev = 0.0
    movers = []
    for r in rows:
        if r["value"] and r["change_7d"] is not None:
            week_prev += r["value"] / (1 + r["change_7d"] / 100)
            movers.append((r["change_7d"], r["symbol"].upper()))
        elif r["value"]:
            week_prev += r["value"]
    movers.sort()
    weekly = {
        "change": total_value - week_prev if rows else 0,
        "change_pct": ((total_value - week_prev) / week_prev * 100) if week_prev > 0 else 0,
        "best": {"symbol": movers[-1][1], "change": movers[-1][0]} if movers else None,
        "worst": {"symbol": movers[0][1], "change": movers[0][0]} if movers else None,
    }
    return {
        "holdings": rows,
        "total_value": total_value,
        "total_invested": total_invested,
        "pnl": pnl,
        "pnl_pct": (pnl / total_invested * 100) if total_invested > 0 else 0,
        "change_24h": change_24h,
        "change_24h_pct": (change_24h / prev_value * 100) if prev_value > 0 else 0,
        "weekly": weekly,
        "price_status": status,
        "missing_prices": [r["symbol"].upper() for r in rows if not r["price_available"]],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def coin_histories(holdings, days, summary):
    out = {}
    for r in summary["holdings"]:
        if r["coin_id"] not in out:
            out[r["coin_id"]] = await get_history(r["coin_id"], r["symbol"], days, r["current_price"])
    return out


def _price_at(series, t):
    best = None
    for ts, p in series:
        if ts <= t + 43200000:
            best = p
        else:
            break
    return best if best is not None else series[0][1]


async def build_history(holdings, days, summary):
    hist = await coin_histories(holdings, days, summary)
    available = {k: v for k, v in hist.items() if v}
    missing = sorted(k for k, v in hist.items() if not v)
    if not available:
        return {"points": [], "missing": missing, "days": days}
    base = max(available.values(), key=len)
    points = []
    for ts, _ in base:
        value = invested = 0.0
        for h in holdings:
            s = available.get(h["coin_id"])
            if not s or _ts(h.get("purchase_date", "")) > ts + 86400000:
                continue
            value += h["quantity"] * _price_at(s, ts)
            invested += h["quantity"] * h["avg_price"]
        points.append({"t": ts, "value": round(value, 2), "invested": round(invested, 2)})
    if points and not missing:
        points[-1]["value"] = round(summary["total_value"], 2)
    return {"points": points, "missing": missing, "days": days}


def _returns(series):
    prices = [p for _, p in series]
    return [math.log(prices[i] / prices[i - 1]) for i in range(1, len(prices)) if prices[i - 1] > 0 and prices[i] > 0]


def _std(xs):
    if len(xs) < 2:
        return 0
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


async def volatility_and_drawdown(holdings, summary):
    hist = await coin_histories(holdings, 30, summary)
    weights = {r["coin_id"]: r["allocation"] / 100 for r in summary["holdings"] if r["value"]}
    asset_vol, rets = {}, {}
    for cid, s in hist.items():
        if s and len(s) >= 8:
            r = _returns(s)
            rets[cid] = r
            asset_vol[cid] = _std(r) * math.sqrt(365) * 100
    covered = sum(weights.get(c, 0) for c in rets)
    port_vol, drawdown, peak = None, None, None
    if rets and covered >= 0.6:
        n = min(len(r) for r in rets.values())
        port = [sum(weights.get(c, 0) * rets[c][-n + i] for c in rets) / covered for i in range(n)]
        port_vol = _std(port) * math.sqrt(365) * 100
    # Drawdown of current holdings vs their 30-day peak value (pure market move)
    series_vals = []
    if rets:
        base = max((s for s in hist.values() if s), key=len)
        for ts, _ in base:
            series_vals.append(sum(h["quantity"] * _price_at(hist[h["coin_id"]], ts) for h in holdings if hist.get(h["coin_id"])))
        if series_vals:
            series_vals[-1] = sum(r["value"] or 0 for r in summary["holdings"] if hist.get(r["coin_id"]))
            peak = max(series_vals)
            drawdown = (peak - series_vals[-1]) / peak * 100 if peak > 0 else 0
    return {
        "portfolio_vol": port_vol,
        "asset_vol": asset_vol,
        "coverage": covered * 100,
        "drawdown_30d": drawdown,
        "peak_30d": peak,
        "missing": sorted(c for c, s in hist.items() if not s or len(s) < 8),
    }


def _clamp(x):
    return max(0.0, min(25.0, x))


def compute_health(summary, vol, targets):
    rows = [r for r in summary["holdings"] if r["value"]]
    if not rows:
        return None
    w = [r["allocation"] / 100 for r in rows]
    hhi = sum(x * x for x in w)
    n_eff = 1 / hhi if hhi > 0 else 0
    top = rows[0]
    sym = lambda r: r["symbol"].upper()

    div = _clamp(25 * (n_eff - 1) / 4)
    div_exp = (f"You hold {len(rows)} asset(s), which behave like {n_eff:.1f} equally-sized positions "
               f"(effective diversification). 5+ effective positions earns full marks.")

    tw = top["allocation"]
    conc = _clamp(25 * (80 - tw) / (80 - 25)) if tw > 25 else 25
    heavy = [r for r in rows if r["allocation"] > 40]
    conc_exp = (f"{sym(top)} is your largest position at {tw:.1f}% of the portfolio. "
                f"A top holding of 25% or less scores full marks; 80%+ scores zero."
                + (" Over 40%: " + ", ".join(f"{sym(r)} ({r['allocation']:.0f}%)" for r in heavy) + "." if heavy else ""))

    pv = vol["portfolio_vol"]
    if pv is None:
        vola = 12.5
        vol_exp = ("Not enough 30-day price history was available to measure volatility reliably, "
                   "so a neutral 12.5/25 is applied. This is an estimate, not a measurement.")
    else:
        vola = _clamp(25 * (120 - pv) / (120 - 40)) if pv > 40 else 25
        vol_exp = (f"Estimated annualised volatility over the last 30 days is {pv:.0f}%. "
                   f"40% or lower scores full marks; 120%+ scores zero.")
    high_vol = sorted(((c, v) for c, v in vol["asset_vol"].items()), key=lambda x: -x[1])
    sym_by_id = {r["coin_id"]: sym(r) for r in rows}

    custom = bool(targets)
    if custom:
        tgt = {k: float(v) for k, v in targets.items()}
    else:
        tgt = {r["coin_id"]: 100 / len(rows) for r in rows}
    keys = set(tgt) | {r["coin_id"] for r in rows}
    actual = {r["coin_id"]: r["allocation"] for r in rows}
    devs = sorted(((k, actual.get(k, 0) - tgt.get(k, 0)) for k in keys), key=lambda x: -abs(x[1]))
    tad = sum(abs(d) for _, d in devs) / 2
    alloc = _clamp(25 * (1 - tad / 50))
    big_dev = [(k, d) for k, d in devs if abs(d) >= 10]
    alloc_exp = ((f"Compared with your target allocation, " if custom else
                  "You haven't set target allocations, so we compare against an equal-weight portfolio. ")
                 + f"{tad:.1f}% of your money would need to move to match the target (0% = full marks, 50%+ = zero).")

    total = round(div + conc + vola + alloc)
    risk = "Healthy" if total >= 70 else "Moderate" if total >= 45 else "High Risk"

    obs = [f"{sym(top)} dominates with {tw:.1f}% of your portfolio value."]
    if pv is not None and high_vol:
        c, v = high_vol[0]
        obs.append(f"{sym_by_id.get(c, c.upper())} is your most volatile asset (~{v:.0f}% annualised); portfolio volatility is ~{pv:.0f}%.")
    else:
        obs.append("Volatility could not be fully measured due to limited price history.")
    obs.append(f"Unrealised P&L is {'+' if summary['pnl'] >= 0 else '-'}₹{abs(summary['pnl']):,.0f} "
               f"({summary['pnl_pct']:+.1f}%) on ₹{summary['total_invested']:,.0f} invested.")

    sugg = []
    if tw > 40:
        sugg.append(f"Consider capping {sym(top)} near 40% or less so one coin can't swing your whole portfolio.")
    if n_eff < 3:
        sugg.append("Spreading money across a few more established assets would raise your diversification score.")
    if pv is not None and pv > 80:
        sugg.append("Your mix is highly volatile — a smaller position in the most volatile coins could smooth swings.")
    if big_dev:
        k, d = big_dev[0]
        sugg.append(f"{sym_by_id.get(k, k.upper())} is {abs(d):.0f}% {'above' if d > 0 else 'below'} target — rebalancing gradually would close the gap.")
    if not custom:
        sugg.append("Set your own target allocation in Settings for a personalised allocation score.")
    sugg += ["Review your portfolio weekly and set drawdown alerts in Risk Monitor.",
             "Only invest money you can afford to hold through big price swings."]
    seen, final_sugg = set(), []
    for s in sugg:
        if s not in seen:
            seen.add(s)
            final_sugg.append(s)

    ids = {r["coin_id"] for r in rows}
    if ids & MEMES and sum(actual.get(i, 0) for i in ids & MEMES) > 25:
        persona = ("Meme Adventurer", "You enjoy the wild side of crypto — high thrills, high swings.")
    elif tw >= 70:
        persona = (f"{top['name']} Maximalist", f"You're all-in on {top['name']}. Conviction is strong; balance is thin.")
    elif ids & STABLES and sum(actual.get(i, 0) for i in ids & STABLES) > 30:
        persona = ("Cautious Captain", "A solid stablecoin cushion keeps you steady in storms.")
    elif n_eff >= 4:
        persona = ("Balanced Explorer", "You spread your bets wisely across the crypto map.")
    else:
        persona = ("Focused Builder", "A tight portfolio with a few strong convictions.")

    return {
        "score": total,
        "risk": risk,
        "categories": [
            {"key": "diversification", "name": "Diversification", "score": round(div, 1), "max": 25, "explanation": div_exp},
            {"key": "concentration", "name": "Asset Concentration", "score": round(conc, 1), "max": 25, "explanation": conc_exp},
            {"key": "volatility", "name": "Volatility", "score": round(vola, 1), "max": 25, "explanation": vol_exp,
             "insufficient_data": pv is None},
            {"key": "allocation", "name": "Allocation", "score": round(alloc, 1), "max": 25, "explanation": alloc_exp,
             "using_default_targets": not custom},
        ],
        "observations": obs[:3],
        "suggestions": final_sugg[:3],
        "effective_assets": n_eff,
        "deviations": [{"coin_id": k, "symbol": sym_by_id.get(k, k.upper()), "actual": actual.get(k, 0),
                        "target": tgt.get(k, 0), "diff": d} for k, d in devs],
        "asset_volatility": [{"coin_id": c, "symbol": sym_by_id.get(c, c.upper()), "vol": v} for c, v in high_vol],
        "portfolio_volatility": pv,
        "persona": {"title": persona[0], "tagline": persona[1]},
        "disclaimer": "This score summarises current portfolio structure. It is not a prediction of future returns or a guarantee of safety.",
    }


def compute_alerts(summary, vol, settings):
    alerts = []
    thresholds = sorted(settings.get("drawdown_thresholds", [5, 10, 15]))
    limit = settings.get("concentration_limit", 40)
    dd = vol.get("drawdown_30d")
    if dd is not None:
        hit = [t for t in thresholds if dd >= t]
        if hit:
            alerts.append({"key": f"dd-{hit[-1]}", "type": "drawdown", "severity": "high" if hit[-1] >= 10 else "medium",
                           "title": f"Drawdown passed {hit[-1]}%",
                           "message": f"Your current holdings are {dd:.1f}% below their 30-day peak value."})
    ch = summary["change_24h_pct"]
    if thresholds and abs(ch) >= thresholds[0]:
        alerts.append({"key": f"move-{'up' if ch > 0 else 'down'}", "type": "move", "severity": "medium" if ch < 0 else "info",
                       "title": f"Big 24h move: {ch:+.1f}%",
                       "message": f"Portfolio value changed by ₹{summary['change_24h']:,.0f} in the last 24 hours."})
    for r in summary["holdings"]:
        if r["allocation"] > limit:
            alerts.append({"key": f"conc-{r['coin_id']}", "type": "concentration",
                           "severity": "high" if r["allocation"] > 60 else "medium",
                           "title": f"{r['symbol'].upper()} is {r['allocation']:.0f}% of your portfolio",
                           "message": f"That's above your {limit}% concentration limit. Heavy exposure means one coin drives your results."})
    return alerts


def goal_progress(goal, current_value):
    target = goal["target_value"]
    pct = min(100.0, current_value / target * 100) if target > 0 else 0
    remaining = max(0.0, target - current_value)
    try:
        td = datetime.fromisoformat(goal["target_date"]).replace(tzinfo=timezone.utc)
        days_left = (td - datetime.now(timezone.utc)).days
    except Exception:
        days_left = None
    months = max(1, math.ceil(days_left / 30.44)) if days_left and days_left > 0 else None
    return {**goal, "current_value": current_value, "progress_pct": pct, "remaining": remaining,
            "days_left": days_left, "achieved": remaining == 0,
            "hypothetical_monthly": (remaining / months) if months and remaining > 0 else None}
