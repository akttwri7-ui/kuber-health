# Kuber Crypto iteration 2: Explore, Coin detail/history/news, Chart Analyst candles (no AI calls here)
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    r = ses.post(f"{API}/auth/register", json={"email": f"test_{uuid.uuid4().hex[:8]}@example.com", "password": "Passw0rd!", "name": "TEST Explore"})
    assert r.status_code == 200, r.text
    return ses


# Auth guard on new endpoints
@pytest.mark.parametrize("method,path", [
    ("get", "/explore/overview"), ("get", "/explore/search?q=btc"), ("get", "/explore/news"),
    ("get", "/coins/bitcoin/detail?symbol=btc"), ("get", "/coins/bitcoin/history?days=7&symbol=btc"),
    ("get", "/coins/bitcoin/news?name=Bitcoin"), ("get", "/chart/candles?symbol=btc&interval=1h"),
])
def test_requires_auth(method, path):
    r = getattr(requests, method)(f"{API}{path}")
    assert r.status_code == 401, f"{path} -> {r.status_code}"


def test_post_endpoints_require_auth():
    assert requests.post(f"{API}/coins/bitcoin/research", json={"symbol": "btc"}).status_code == 401
    assert requests.post(f"{API}/chart/analyze", json={"symbol": "btc", "name": "Bitcoin", "interval": "1h"}).status_code == 401


# Explore overview
def test_overview(s):
    r = s.get(f"{API}/explore/overview", timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    print("overview source:", d["source"], d["status"], "global:", d["global"] and d["global"]["source"], d["trending_source"])
    assert d["global"] and d["global"]["market_cap"] > 0 and d["global"]["btc_dominance"] > 0
    assert len(d["top"]) >= 10 and d["top"][0]["price"] > 0
    assert len(d["gainers"]) == 6 and len(d["losers"]) == 6
    assert d["gainers"][0]["change_24h"] >= d["losers"][0]["change_24h"]
    assert len(d["trending"]) > 0


@pytest.mark.parametrize("q,expected", [("eth", "ethereum"), ("BTC", "bitcoin"), ("solana", "solana")])
def test_search(s, q, expected):
    r = s.get(f"{API}/explore/search", params={"q": q}, timeout=60)
    assert r.status_code == 200
    res = r.json()
    ids = [c["id"] for c in res]
    assert expected in ids, ids
    hit = next(c for c in res if c["id"] == expected)
    print(q, hit)
    assert hit["thumb"]
    assert hit["price"] is not None, f"No INR price for {expected} in search"


def test_search_empty_returns_top(s):
    r = s.get(f"{API}/explore/search", params={"q": ""}, timeout=60)
    assert r.status_code == 200 and len(r.json()) >= 5


def test_general_news(s):
    r = s.get(f"{API}/explore/news", timeout=60)
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0
    assert all(i["title"] and i["url"].startswith("http") and i["source"] for i in items)
    print("news sources:", {i["source"] for i in items})


# Coin detail
@pytest.mark.parametrize("cid,sym", [("bitcoin", "btc"), ("ethereum", "eth"), ("solana", "sol")])
def test_coin_detail(s, cid, sym):
    r = s.get(f"{API}/coins/{cid}/detail", params={"symbol": sym}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    print(cid, d["source"], d["price"], d["rank"], d["website"], d["whitepaper"])
    assert d["price"] > 0 and d["market_cap"] > 0 and d["rank"]
    assert set(d["change"].keys()) == {"24h", "7d", "30d", "1y"}
    assert d["description"]
    assert "_id" not in d


def test_coin_detail_unknown_404(s):
    r = s.get(f"{API}/coins/notacoin-xyz/detail", params={"symbol": "zzz"}, timeout=60)
    assert r.status_code == 404


@pytest.mark.parametrize("days", ["1", "7", "30", "90", "365", "max"])
def test_history_periods(s, days):
    r = s.get(f"{API}/coins/bitcoin/history", params={"days": days, "symbol": "btc"}, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert len(d["points"]) >= 2, f"days={days} empty: {d}"
    assert d["high"] >= d["low"] > 0
    print(days, len(d["points"]), d["source"])


def test_history_invalid(s):
    assert s.get(f"{API}/coins/bitcoin/history", params={"days": "5"}).status_code == 400


def test_coin_news(s):
    r = s.get(f"{API}/coins/bitcoin/news", params={"name": "Bitcoin", "symbol": "btc"}, timeout=60)
    assert r.status_code == 200
    items = r.json()
    assert len(items) > 0 and items[0]["source"] and items[0]["published_at"]


# Holding banner via detail
def test_detail_holding(s):
    r = s.post(f"{API}/holdings", json={"coin_id": "ethereum", "symbol": "eth", "name": "Ethereum", "quantity": 0.5, "avg_price": 200000, "purchase_date": "2025-01-10"})
    assert r.status_code in (200, 201), r.text
    d = s.get(f"{API}/coins/ethereum/detail", params={"symbol": "eth"}, timeout=60).json()
    assert d["holding"] and d["holding"]["quantity"] == 0.5
    assert s.get(f"{API}/coins/bitcoin/detail", params={"symbol": "btc"}, timeout=60).json()["holding"] is None


# Chart candles
@pytest.mark.parametrize("iv", ["5m", "15m", "1h", "4h", "1d", "1w"])
def test_candles(s, iv):
    r = s.get(f"{API}/chart/candles", params={"symbol": "btc", "interval": iv}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    c = d["candles"]
    assert len(c) > 50
    assert all(k in c[0] for k in ("time", "open", "high", "low", "close", "volume"))
    for k in ("sma20", "sma50", "ema20", "rsi", "macd", "macd_signal", "macd_hist", "bb_upper", "bb_mid", "bb_lower"):
        assert len(d["series"][k]) == len(c)
    snap = d["snapshot"]
    assert 0 <= snap["rsi14"] <= 100
    assert snap["rule_based_trend"] in ("Bullish", "Bearish", "Sideways")
    assert d["usd_inr"] > 50
    times = [x["time"] for x in c]
    assert times == sorted(times) and len(set(times)) == len(times)


def test_candles_bad_interval(s):
    assert s.get(f"{API}/chart/candles", params={"symbol": "btc", "interval": "2h"}).status_code == 400


def test_candles_unsupported_coin(s):
    r = s.get(f"{API}/chart/candles", params={"symbol": "usdt", "interval": "1h"}, timeout=60)
    assert r.status_code == 404
    assert "USDT" in r.json()["detail"]


def test_analyze_validation(s):
    r = s.post(f"{API}/chart/analyze", json={"symbol": "", "name": "x", "interval": "1h"})
    assert r.status_code == 422
