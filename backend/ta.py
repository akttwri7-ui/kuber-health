import math

INTERVALS = {"5m": 400, "15m": 400, "1h": 400, "4h": 400, "1d": 400, "1w": 300}


def sma(xs, n):
    out = [None] * len(xs)
    s = 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def ema(xs, n, start=0):
    out = [None] * len(xs)
    k = 2 / (n + 1)
    vals = [x for x in xs[start:start + n]]
    if len(vals) < n:
        return out
    prev = sum(vals) / n
    out[start + n - 1] = prev
    for i in range(start + n, len(xs)):
        prev = xs[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi(closes, n=14):
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = [max(0, closes[i] - closes[i - 1]) for i in range(1, n + 1)]
    losses = [max(0, closes[i - 1] - closes[i]) for i in range(1, n + 1)]
    ag, al = sum(gains) / n, sum(losses) / n
    out[n] = 100 - 100 / (1 + ag / al) if al else 100
    for i in range(n + 1, len(closes)):
        ch = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(0, ch)) / n
        al = (al * (n - 1) + max(0, -ch)) / n
        out[i] = 100 - 100 / (1 + ag / al) if al else 100
    return out


def macd(closes):
    e12, e26 = ema(closes, 12), ema(closes, 26)
    line = [a - b if a is not None and b is not None else None for a, b in zip(e12, e26)]
    first = next((i for i, v in enumerate(line) if v is not None), None)
    sig = [None] * len(closes)
    if first is not None:
        filled = [v if v is not None else 0 for v in line]
        sig = ema(filled, 9, first)
    hist = [a - b if a is not None and b is not None else None for a, b in zip(line, sig)]
    return line, sig, hist


def bollinger(closes, n=20, k=2):
    mid = sma(closes, n)
    up, lo = [None] * len(closes), [None] * len(closes)
    for i in range(n - 1, len(closes)):
        w = closes[i - n + 1:i + 1]
        m = mid[i]
        sd = math.sqrt(sum((x - m) ** 2 for x in w) / n)
        up[i], lo[i] = m + k * sd, m - k * sd
    return up, mid, lo


def levels(candles, window=5, count=3):
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    price = candles[-1]["close"]
    piv_h = [highs[i] for i in range(window, len(highs) - window) if highs[i] == max(highs[i - window:i + window + 1])]
    piv_l = [lows[i] for i in range(window, len(lows) - window) if lows[i] == min(lows[i - window:i + window + 1])]

    def cluster(vals):
        vals = sorted(vals)
        groups = []
        for v in vals:
            if groups and abs(v - groups[-1][-1]) / v < 0.012:
                groups[-1].append(v)
            else:
                groups.append([v])
        return [(sum(g) / len(g), len(g)) for g in groups]

    sup = sorted([c for c in cluster(piv_l + piv_h) if c[0] < price], key=lambda c: -c[0])[:count]
    res = sorted([c for c in cluster(piv_h + piv_l) if c[0] > price], key=lambda c: c[0])[:count]
    return [{"price": p, "touches": t} for p, t in sup], [{"price": p, "touches": t} for p, t in res]


def pattern(c):
    if len(c) < 3:
        return "Not enough candles"
    a, b = c[-2], c[-1]
    body = abs(b["close"] - b["open"])
    rng = b["high"] - b["low"] or 1e-12
    upper = b["high"] - max(b["open"], b["close"])
    lower = min(b["open"], b["close"]) - b["low"]
    bull = b["close"] > b["open"]
    if body / rng < 0.1:
        return "Doji (indecision)"
    if lower > 2 * body and upper < body:
        return "Hammer-like (long lower wick)"
    if upper > 2 * body and lower < body:
        return "Shooting-star-like (long upper wick)"
    if bull and a["close"] < a["open"] and b["close"] > a["open"] and b["open"] < a["close"]:
        return "Bullish engulfing"
    if not bull and a["close"] > a["open"] and b["close"] < a["open"] and b["open"] > a["close"]:
        return "Bearish engulfing"
    if body / rng > 0.7:
        return "Strong bullish candle (marubozu-like)" if bull else "Strong bearish candle (marubozu-like)"
    return "Bullish candle" if bull else "Bearish candle"


def compute(candles):
    closes = [c["close"] for c in candles]
    vols = [c["volume"] for c in candles]
    s20, s50, e20 = sma(closes, 20), sma(closes, 50), ema(closes, 20)
    r = rsi(closes)
    ml, ms, mh = macd(closes)
    bu, bm, bl = bollinger(closes)
    vsma = sma(vols, 20)
    series = {"sma20": s20, "sma50": s50, "ema20": e20, "rsi": r, "macd": ml, "macd_signal": ms, "macd_hist": mh,
              "bb_upper": bu, "bb_mid": bm, "bb_lower": bl}
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0]
    recent = rets[-30:]
    m = sum(recent) / len(recent) if recent else 0
    vol = math.sqrt(sum((x - m) ** 2 for x in recent) / max(1, len(recent) - 1)) * 100 if len(recent) > 1 else None
    sup, res = levels(candles) if len(candles) > 15 else ([], [])
    last = closes[-1]
    v_recent = sum(vols[-5:]) / 5 if len(vols) >= 5 else None
    v_prior = sum(vols[-25:-5]) / 20 if len(vols) >= 25 else None
    trend = "Sideways"
    if s50[-1] and e20[-1]:
        slope = (s50[-1] - s50[-10]) / s50[-10] * 100 if s50[-10] else 0
        if last > e20[-1] > s50[-1] and slope > 0.3:
            trend = "Bullish"
        elif last < e20[-1] < s50[-1] and slope < -0.3:
            trend = "Bearish"
    n = min(len(closes) - 1, 20)
    snap = {
        "last_close": last, "change_last_20_candles_pct": (last / closes[-1 - n] - 1) * 100 if n > 0 else None,
        "rsi14": r[-1], "macd": ml[-1], "macd_signal": ms[-1], "macd_hist": mh[-1], "macd_hist_prev": mh[-2] if len(mh) > 1 else None,
        "sma20": s20[-1], "sma50": s50[-1], "ema20": e20[-1], "bb_upper": bu[-1], "bb_lower": bl[-1],
        "bb_width_pct": ((bu[-1] - bl[-1]) / bm[-1] * 100) if bu[-1] and bm[-1] else None,
        "volume_last5_vs_prior20_pct": ((v_recent / v_prior - 1) * 100) if v_recent and v_prior else None,
        "last_volume_vs_avg20": (vols[-1] / vsma[-1]) if vsma[-1] else None,
        "candle_volatility_pct": vol, "period_high": max(c["high"] for c in candles), "period_low": min(c["low"] for c in candles),
        "rule_based_trend": trend, "latest_pattern": pattern(candles), "support": sup, "resistance": res,
        "candles": len(candles),
    }
    return series, snap
