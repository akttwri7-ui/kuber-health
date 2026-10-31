# Kuber Crypto backend regression tests: auth, isolation, holdings, settings, health, risk, goals, chat
import os
import uuid
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@kubercrypto.com", "password": "Kuber@123"}


def new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def register(s):
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!", "name": "TEST User"})
    assert r.status_code == 200, r.text
    return email, r


@pytest.fixture(scope="module")
def user_a():
    s = new_session()
    email, _ = register(s)
    s.email = email
    return s


@pytest.fixture(scope="module")
def user_b():
    s = new_session()
    email, _ = register(s)
    return s


# ---- Auth ----
class TestAuth:
    def test_register_sets_httponly_cookies(self):
        s = new_session()
        email, r = register(s)
        sc = r.headers.get("set-cookie", "")
        assert "access_token" in sc and "refresh_token" in sc
        assert "HttpOnly" in sc
        assert r.json()["email"] == email
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200 and me.json()["email"] == email

    def test_duplicate_register(self, user_a):
        r = new_session().post(f"{API}/auth/register", json={"email": user_a.email, "password": "Passw0rd!", "name": "x"})
        assert r.status_code == 400

    def test_admin_login_and_logout(self):
        s = new_session()
        r = s.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "admin"
        assert s.get(f"{API}/auth/me").status_code == 200
        assert s.post(f"{API}/auth/logout").status_code == 200
        s.cookies.clear()
        assert s.get(f"{API}/auth/me").status_code == 401

    def test_invalid_login(self):
        r = new_session().post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_bruteforce_lockout(self):
        s = new_session()
        email, _ = register(new_session())
        codes = [s.post(f"{API}/auth/login", json={"email": email, "password": "bad"}).status_code for _ in range(6)]
        assert codes[:5] == [401] * 5
        assert codes[5] == 429

    def test_refresh(self, user_a):
        r = user_a.post(f"{API}/auth/refresh")
        assert r.status_code == 200

    def test_unauth(self):
        assert requests.get(f"{API}/holdings").status_code == 401


# ---- Holdings ----
class TestHoldings:
    def test_empty_then_add_and_merge(self, user_a):
        s = user_a.get(f"{API}/portfolio/summary").json()
        assert s["holdings"] == [] and s["total_value"] == 0
        d = (date.today() - timedelta(days=10)).isoformat()
        r = user_a.post(f"{API}/holdings", json={"coin_id": "bitcoin", "symbol": "BTC", "name": "Bitcoin", "quantity": 0.1, "avg_price": 5000000, "purchase_date": d})
        assert r.status_code == 200, r.text
        assert r.json()["symbol"] == "btc"
        r2 = user_a.post(f"{API}/holdings", json={"coin_id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "quantity": 0.3, "avg_price": 7000000, "purchase_date": date.today().isoformat()})
        assert r2.status_code == 200 and r2.json()["merged"] is True
        hs = user_a.get(f"{API}/holdings").json()
        assert len(hs) == 1
        assert abs(hs[0]["quantity"] - 0.4) < 1e-9
        assert abs(hs[0]["avg_price"] - 6500000) < 1e-3
        assert hs[0]["purchase_date"] == d

    def test_summary_math(self, user_a):
        user_a.post(f"{API}/holdings", json={"coin_id": "ethereum", "symbol": "eth", "name": "Ethereum", "quantity": 1, "avg_price": 200000, "purchase_date": date.today().isoformat()})
        s = user_a.get(f"{API}/portfolio/summary").json()
        assert s["price_status"] in ("live", "stale", "demo")
        tv = 0
        for h in s["holdings"]:
            assert h["current_price"] and h["current_price"] > 0
            assert abs(h["invested"] - h["quantity"] * h["avg_price"]) < 1e-6
            assert abs(h["value"] - h["quantity"] * h["current_price"]) < 1e-3
            assert abs(h["pnl"] - (h["value"] - h["invested"])) < 1e-3
            tv += h["value"]
        assert abs(s["total_value"] - tv) < 1e-3
        assert abs(sum(h["allocation"] for h in s["holdings"]) - 100) < 0.01
        assert abs(s["pnl"] - (s["total_value"] - s["total_invested"])) < 1e-3

    @pytest.mark.parametrize("q,p,d", [(0, 100, None), (-1, 100, None), (1, 0, None), (1, -5, None), (1, 100, "future"), (1, 100, "bad")])
    def test_validation(self, user_a, q, p, d):
        dt = (date.today() + timedelta(days=3)).isoformat() if d == "future" else "2024-13-40" if d == "bad" else date.today().isoformat()
        r = user_a.post(f"{API}/holdings", json={"coin_id": "solana", "symbol": "sol", "name": "Solana", "quantity": q, "avg_price": p, "purchase_date": dt})
        assert r.status_code == 422
        if d == "future":
            assert "future" in r.text

    def test_edit_delete(self, user_a):
        hs = {h["coin_id"]: h for h in user_a.get(f"{API}/holdings").json()}
        eth = hs["ethereum"]
        body = {"coin_id": "ethereum", "symbol": "eth", "name": "Ethereum", "quantity": 2.5, "avg_price": 210000, "purchase_date": eth["purchase_date"], "notes": "TEST"}
        r = user_a.put(f"{API}/holdings/{eth['holding_id']}", json=body)
        assert r.status_code == 200
        h = [x for x in user_a.get(f"{API}/holdings").json() if x["coin_id"] == "ethereum"][0]
        assert h["quantity"] == 2.5 and h["avg_price"] == 210000 and h["notes"] == "TEST"
        assert user_a.delete(f"{API}/holdings/{eth['holding_id']}").status_code == 200
        assert user_a.delete(f"{API}/holdings/{eth['holding_id']}").status_code == 404

    def test_isolation(self, user_a, user_b):
        a_hold = user_a.get(f"{API}/holdings").json()[0]
        assert user_b.get(f"{API}/holdings").json() == []
        body = {"coin_id": "bitcoin", "symbol": "btc", "name": "Bitcoin", "quantity": 9, "avg_price": 1, "purchase_date": date.today().isoformat()}
        assert user_b.put(f"{API}/holdings/{a_hold['holding_id']}", json=body).status_code == 404
        assert user_b.delete(f"{API}/holdings/{a_hold['holding_id']}").status_code == 404
        g = user_a.post(f"{API}/goals", json={"name": "TEST iso", "target_value": 100, "target_date": "2030-01-01"}).json()
        assert user_b.put(f"{API}/goals/{g['goal_id']}", json={"name": "x", "target_value": 1, "target_date": "2030-01-01"}).status_code == 404
        assert user_b.delete(f"{API}/goals/{g['goal_id']}").status_code == 404
        assert user_b.get(f"{API}/goals").json() == []
        user_a.delete(f"{API}/goals/{g['goal_id']}")

    def test_demo(self, user_b):
        assert user_b.post(f"{API}/holdings/demo").status_code == 200
        assert len(user_b.get(f"{API}/holdings").json()) == 4
        assert user_b.post(f"{API}/holdings/demo").status_code == 400

    def test_coin_search(self, user_a):
        r = user_a.get(f"{API}/coins/search", params={"q": "sol"})
        assert r.status_code == 200 and any(c["id"] == "solana" for c in r.json())

    def test_history_periods(self, user_b):
        for d in (7, 30, 90, 365):
            r = user_b.get(f"{API}/portfolio/history", params={"days": d})
            assert r.status_code == 200
            assert len(r.json()["points"]) > 0, f"no points for {d}"
        assert user_b.get(f"{API}/portfolio/history", params={"days": 5}).status_code == 400


# ---- Health / Settings / Risk ----
class TestHealthSettingsRisk:
    def test_health(self, user_b):
        h = user_b.get(f"{API}/portfolio/health").json()["health"]
        assert 0 <= h["score"] <= 100
        assert abs(h["score"] - sum(c["score"] for c in h["categories"])) <= 1.0
        exp = "Healthy" if h["score"] >= 70 else "Moderate" if h["score"] >= 45 else "High Risk"
        assert h["risk"] == exp
        assert len(h["observations"]) == 3 and len(h["suggestions"]) == 3
        assert all(c["explanation"] for c in h["categories"])

    def test_settings_invalid_and_valid(self, user_b):
        r = user_b.put(f"{API}/settings", json={"targets": {"bitcoin": 50, "ethereum": 30}, "drawdown_thresholds": [5, 10], "concentration_limit": 40})
        assert r.status_code == 422 and "100" in r.text
        before = [c for c in user_b.get(f"{API}/portfolio/health").json()["health"]["categories"] if c["key"] == "allocation"][0]
        s = user_b.get(f"{API}/portfolio/summary").json()
        actual = {h["coin_id"]: round(h["allocation"], 2) for h in s["holdings"]}
        diff = 100 - sum(actual.values())
        first = next(iter(actual))
        actual[first] = round(actual[first] + diff, 2)
        r = user_b.put(f"{API}/settings", json={"targets": actual, "drawdown_thresholds": [5, 10, 15], "concentration_limit": 40})
        assert r.status_code == 200, r.text
        after = [c for c in user_b.get(f"{API}/portfolio/health").json()["health"]["categories"] if c["key"] == "allocation"][0]
        assert after["using_default_targets"] is False
        assert after["score"] >= 24.5  # targets match actual
        assert before["using_default_targets"] is True

    def test_concentration_alert_and_notifications(self, user_b):
        user_b.put(f"{API}/settings", json={"targets": {}, "drawdown_thresholds": [5, 10, 15], "concentration_limit": 10})
        r = user_b.get(f"{API}/risk").json()
        conc = [a for a in r["alerts"] if a["type"] == "concentration"]
        top = max(a["allocation"] for a in r["allocations"])
        assert top > 10 and len(conc) >= 1
        n = user_b.get(f"{API}/notifications").json()
        assert any(x["key"].startswith("conc-") for x in n)
        assert user_b.post(f"{API}/notifications/read").status_code == 200
        assert all(x["read"] for x in user_b.get(f"{API}/notifications").json())


# ---- Goals ----
class TestGoals:
    def test_goals_crud(self, user_b):
        tv = user_b.get(f"{API}/portfolio/summary").json()["total_value"]
        g = user_b.post(f"{API}/goals", json={"name": "TEST goal", "target_value": tv * 2, "target_date": "2030-06-01"}).json()
        gl = [x for x in user_b.get(f"{API}/goals").json() if x["goal_id"] == g["goal_id"]][0]
        assert abs(gl["progress_pct"] - 50) < 2
        assert gl["remaining"] > 0 and gl["hypothetical_monthly"] > 0
        assert user_b.put(f"{API}/goals/{g['goal_id']}", json={"name": "TEST small", "target_value": 1, "target_date": "2030-06-01"}).status_code == 200
        gl = [x for x in user_b.get(f"{API}/goals").json() if x["goal_id"] == g["goal_id"]][0]
        assert gl["progress_pct"] == 100 and gl["remaining"] == 0 and gl["achieved"] is True
        assert user_b.delete(f"{API}/goals/{g['goal_id']}").status_code == 200
        assert user_b.delete(f"{API}/goals/{g['goal_id']}").status_code == 404

    def test_goal_validation(self, user_b):
        assert user_b.post(f"{API}/goals", json={"name": "x", "target_value": 0, "target_date": "2030-01-01"}).status_code == 422
        assert user_b.post(f"{API}/goals", json={"name": "x", "target_value": 10, "target_date": "nope"}).status_code == 422


# ---- AI chat (single call to limit cost) ----
class TestChat:
    def test_chat_stream(self, user_b):
        user_b.delete(f"{API}/chat/history")
        r = user_b.post(f"{API}/chat", json={"message": "Which coin has the highest allocation?"}, stream=True, timeout=120)
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
        body = "".join(chunk.decode() for chunk in r.iter_content(None))
        assert "[DONE]" in body
        assert '"error"' not in body, body[:500]
        assert "delta" in body
        hist = user_b.get(f"{API}/chat/history").json()
        assert len(hist) == 2 and hist[1]["role"] == "assistant"
        txt = hist[1]["content"].lower()
        assert any(k in txt for k in ("btc", "bitcoin", "eth", "ethereum", "sol", "doge"))
