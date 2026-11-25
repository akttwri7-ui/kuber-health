from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import json
import uuid
import logging
from datetime import datetime, timezone, timedelta, date
from typing import Optional, Dict, List

import bcrypt
import jwt
import httpx
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator, EmailStr

from market import search_coins
from analytics import build_summary, build_history, volatility_and_drawdown, compute_health, compute_alerts, goal_progress
from market import _usd_inr as get_fx
import explore
import sip
import market
import ta
from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_ALG = "HS256"

app = FastAPI()
api = APIRouter(prefix="/api")


def now():
    return datetime.now(timezone.utc)


def new_id(p):
    return f"{p}_{uuid.uuid4().hex[:12]}"


# ---------------- Auth ----------------
def hash_password(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p, h):
    return bcrypt.checkpw(p.encode(), h.encode())


def make_token(user_id, kind, delta):
    return jwt.encode({"sub": user_id, "type": kind, "exp": now() + delta}, os.environ["JWT_SECRET"], algorithm=JWT_ALG)


def set_jwt_cookies(resp: Response, user_id: str):
    resp.set_cookie("access_token", make_token(user_id, "access", timedelta(minutes=15)), httponly=True, secure=True, samesite="none", max_age=900, path="/")
    resp.set_cookie("refresh_token", make_token(user_id, "refresh", timedelta(days=7)), httponly=True, secure=True, samesite="none", max_age=604800, path="/")


def public_user(u):
    return {k: u.get(k) for k in ("user_id", "email", "name", "picture", "role", "auth_provider")}


async def get_current_user(request: Request):
    bearer = request.headers.get("Authorization", "")
    bearer = bearer[7:] if bearer.startswith("Bearer ") else None
    st = request.cookies.get("session_token") or bearer
    if st:
        s = await db.user_sessions.find_one({"session_token": st}, {"_id": 0})
        if s:
            exp = s["expires_at"]
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > now():
                u = await db.users.find_one({"user_id": s["user_id"]}, {"_id": 0, "password_hash": 0})
                if u:
                    return u
    at = request.cookies.get("access_token") or bearer
    if not at:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(at, os.environ["JWT_SECRET"], algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid token type")
    u = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(401, "User not found")
    return u


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=60)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@api.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    u = {"user_id": new_id("user"), "email": email, "name": body.name.strip(), "role": "user", "auth_provider": "password",
         "password_hash": hash_password(body.password), "created_at": now().isoformat()}
    await db.users.insert_one(u)
    set_jwt_cookies(response, u["user_id"])
    return public_user(u)


@api.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    ident = f"login:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= 5:
        locked = att.get("last")
        if locked and locked.replace(tzinfo=timezone.utc) > now() - timedelta(minutes=15):
            raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
        await db.login_attempts.delete_one({"identifier": ident})
    u = await db.users.find_one({"email": email})
    if not u or not u.get("password_hash") or not verify_password(body.password, u["password_hash"]):
        await db.login_attempts.update_one({"identifier": ident}, {"$inc": {"count": 1}, "$set": {"last": now()}}, upsert=True)
        raise HTTPException(401, "Invalid email or password")
    await db.login_attempts.delete_one({"identifier": ident})
    set_jwt_cookies(response, u["user_id"])
    return public_user(u)


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(401, "No refresh token")
    try:
        p = jwt.decode(rt, os.environ["JWT_SECRET"], algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")
    if p.get("type") != "refresh":
        raise HTTPException(401, "Invalid token type")
    response.set_cookie("access_token", make_token(p["sub"], "access", timedelta(minutes=15)), httponly=True, secure=True, samesite="none", max_age=900, path="/")
    return {"ok": True}


class SessionIn(BaseModel):
    session_id: str


@api.post("/auth/google/session")
async def google_session(body: SessionIn, response: Response):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data", headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed")
    d = r.json()
    email = d["email"].lower()
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if u:
        await db.users.update_one({"email": email}, {"$set": {"picture": d.get("picture"), "name": u.get("name") or d.get("name")}})
        u["picture"] = d.get("picture")
    else:
        u = {"user_id": new_id("user"), "email": email, "name": d.get("name") or email, "picture": d.get("picture"),
             "role": "user", "auth_provider": "google", "created_at": now().isoformat()}
        await db.users.insert_one(dict(u))
    await db.user_sessions.insert_one({"user_id": u["user_id"], "session_token": d["session_token"],
                                       "expires_at": now() + timedelta(days=7), "created_at": now()})
    response.set_cookie("session_token", d["session_token"], httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    return public_user(u)


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return public_user(user)


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    st = request.cookies.get("session_token")
    if st:
        await db.user_sessions.delete_one({"session_token": st})
    for k in ("session_token", "access_token", "refresh_token"):
        response.delete_cookie(k, path="/", secure=True, samesite="none")
    return {"ok": True}


# ---------------- Holdings ----------------
class HoldingIn(BaseModel):
    coin_id: str = Field(min_length=1, max_length=100)
    symbol: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=100)
    image: Optional[str] = None
    quantity: float = Field(gt=0, lt=1e15)
    avg_price: float = Field(gt=0, lt=1e13)
    purchase_date: str
    notes: Optional[str] = Field(default=None, max_length=300)

    @field_validator("purchase_date")
    @classmethod
    def valid_date(cls, v):
        try:
            d = date.fromisoformat(v[:10])
        except ValueError:
            raise ValueError("Purchase date must be YYYY-MM-DD")
        if d > date.today() + timedelta(days=1):
            raise ValueError("Purchase date cannot be in the future")
        return d.isoformat()


async def user_holdings(uid):
    return await db.holdings.find({"user_id": uid}, {"_id": 0}).to_list(500)


async def log_tx(uid, kind, h, qty, price):
    await db.transactions.insert_one({"tx_id": new_id("tx"), "user_id": uid, "type": kind, "coin_id": h["coin_id"],
                                      "symbol": h["symbol"], "quantity": qty, "price": price,
                                      "date": h.get("purchase_date"), "created_at": now().isoformat()})


@api.get("/holdings")
async def list_holdings(user=Depends(get_current_user)):
    return await user_holdings(user["user_id"])


@api.post("/holdings")
async def add_holding(body: HoldingIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    data = body.model_dump()
    data["symbol"] = data["symbol"].lower()
    existing = await db.holdings.find_one({"user_id": uid, "coin_id": body.coin_id}, {"_id": 0})
    if existing:
        # Average-cost method: merge buy into existing position
        q = existing["quantity"] + body.quantity
        avg = (existing["quantity"] * existing["avg_price"] + body.quantity * body.avg_price) / q
        upd = {"quantity": q, "avg_price": avg, "purchase_date": min(existing["purchase_date"], data["purchase_date"]), "updated_at": now().isoformat()}
        await db.holdings.update_one({"holding_id": existing["holding_id"]}, {"$set": upd})
        await log_tx(uid, "buy", data, body.quantity, body.avg_price)
        return {**existing, **upd, "merged": True}
    h = {**data, "holding_id": new_id("hold"), "user_id": uid, "created_at": now().isoformat()}
    await db.holdings.insert_one(dict(h))
    await log_tx(uid, "buy", h, body.quantity, body.avg_price)
    return h


@api.put("/holdings/{hid}")
async def edit_holding(hid: str, body: HoldingIn, user=Depends(get_current_user)):
    existing = await db.holdings.find_one({"holding_id": hid, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Holding not found")
    upd = {"quantity": body.quantity, "avg_price": body.avg_price, "purchase_date": body.purchase_date,
           "notes": body.notes, "updated_at": now().isoformat()}
    await db.holdings.update_one({"holding_id": hid}, {"$set": upd})
    await log_tx(user["user_id"], "adjust", {**existing, **upd}, body.quantity, body.avg_price)
    return {**existing, **upd}


@api.delete("/holdings/{hid}")
async def delete_holding(hid: str, user=Depends(get_current_user)):
    existing = await db.holdings.find_one({"holding_id": hid, "user_id": user["user_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Holding not found")
    await db.holdings.delete_one({"holding_id": hid})
    await log_tx(user["user_id"], "remove", existing, existing["quantity"], existing["avg_price"])
    return {"ok": True}


@api.get("/transactions")
async def list_tx(user=Depends(get_current_user)):
    return await db.transactions.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.get("/coins/search")
async def coins_search(q: str = "", user=Depends(get_current_user)):
    return await search_coins(q)


# ---------------- Settings ----------------
DEFAULT_SETTINGS = {"targets": {}, "drawdown_thresholds": [5, 10, 15], "concentration_limit": 40}


class SettingsIn(BaseModel):
    targets: Dict[str, float] = {}
    drawdown_thresholds: List[float] = [5, 10, 15]
    concentration_limit: float = Field(default=40, ge=10, le=100)

    @field_validator("targets")
    @classmethod
    def v_targets(cls, v):
        if any(x < 0 or x > 100 for x in v.values()):
            raise ValueError("Each target must be between 0 and 100")
        v = {k: x for k, x in v.items() if x > 0}
        if v and abs(sum(v.values()) - 100) > 0.5:
            raise ValueError("Target allocations must add up to 100%")
        return v

    @field_validator("drawdown_thresholds")
    @classmethod
    def v_thr(cls, v):
        if not v or len(v) > 6 or any(x <= 0 or x >= 100 for x in v):
            raise ValueError("Provide 1-6 thresholds between 0 and 100")
        return sorted(set(v))


async def get_settings(uid):
    s = await db.settings.find_one({"user_id": uid}, {"_id": 0, "user_id": 0})
    return {**DEFAULT_SETTINGS, **(s or {})}


@api.get("/settings")
async def read_settings(user=Depends(get_current_user)):
    return await get_settings(user["user_id"])


@api.put("/settings")
async def save_settings(body: SettingsIn, user=Depends(get_current_user)):
    await db.settings.update_one({"user_id": user["user_id"]}, {"$set": body.model_dump()}, upsert=True)
    return await get_settings(user["user_id"])


# ---------------- Portfolio analytics ----------------
@api.get("/portfolio/summary")
async def portfolio_summary(user=Depends(get_current_user)):
    return await build_summary(await user_holdings(user["user_id"]))


@api.get("/portfolio/history")
async def portfolio_history(days: int = 30, user=Depends(get_current_user)):
    if days not in (7, 30, 90, 365):
        raise HTTPException(400, "days must be 7, 30, 90 or 365")
    hs = await user_holdings(user["user_id"])
    if not hs:
        return {"points": [], "missing": [], "days": days}
    return await build_history(hs, days, await build_summary(hs))


async def full_analysis(uid):
    hs = await user_holdings(uid)
    summary = await build_summary(hs)
    settings = await get_settings(uid)
    vol = await volatility_and_drawdown(hs, summary) if hs else {"portfolio_vol": None, "asset_vol": {}, "drawdown_30d": None, "missing": []}
    health = compute_health(summary, vol, settings["targets"])
    alerts = compute_alerts(summary, vol, settings) if hs else []
    return summary, vol, health, alerts, settings


@api.get("/portfolio/health")
async def portfolio_health(user=Depends(get_current_user)):
    summary, vol, health, _, _ = await full_analysis(user["user_id"])
    return {"health": health, "price_status": summary["price_status"], "volatility_missing": vol.get("missing", [])}


@api.get("/risk")
async def risk(user=Depends(get_current_user)):
    uid = user["user_id"]
    summary, vol, _, alerts, settings = await full_analysis(uid)
    day = date.today().isoformat()
    for a in alerts:
        await db.notifications.update_one(
            {"user_id": uid, "key": a["key"], "day": day},
            {"$set": {"title": a["title"], "message": a["message"], "severity": a["severity"]},
             "$setOnInsert": {"notif_id": new_id("ntf"), "user_id": uid, "key": a["key"], "day": day, "read": False, "created_at": now().isoformat()}},
            upsert=True)
    return {"alerts": alerts, "drawdown_30d": vol.get("drawdown_30d"), "peak_30d": vol.get("peak_30d"),
            "change_24h_pct": summary["change_24h_pct"], "change_24h": summary["change_24h"],
            "total_value": summary["total_value"], "settings": settings,
            "allocations": [{"symbol": r["symbol"].upper(), "allocation": r["allocation"]} for r in summary["holdings"]]}


@api.get("/notifications")
async def notifications(user=Depends(get_current_user)):
    return await db.notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(30)


@api.post("/notifications/read")
async def read_notifications(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["user_id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ---------------- Goals ----------------
class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    target_value: float = Field(gt=0, lt=1e13)
    target_date: str

    @field_validator("target_date")
    @classmethod
    def v_date(cls, v):
        try:
            return date.fromisoformat(v[:10]).isoformat()
        except ValueError:
            raise ValueError("Target date must be YYYY-MM-DD")


@api.get("/goals")
async def list_goals(user=Depends(get_current_user)):
    goals = await db.goals.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(50)
    summary = await build_summary(await user_holdings(user["user_id"])) if goals else {"total_value": 0}
    return [goal_progress(g, summary["total_value"]) for g in goals]


@api.post("/goals")
async def create_goal(body: GoalIn, user=Depends(get_current_user)):
    g = {**body.model_dump(), "goal_id": new_id("goal"), "user_id": user["user_id"], "created_at": now().isoformat()}
    await db.goals.insert_one(dict(g))
    return g


@api.put("/goals/{gid}")
async def update_goal(gid: str, body: GoalIn, user=Depends(get_current_user)):
    r = await db.goals.update_one({"goal_id": gid, "user_id": user["user_id"]}, {"$set": body.model_dump()})
    if not r.matched_count:
        raise HTTPException(404, "Goal not found")
    return {"ok": True}


@api.delete("/goals/{gid}")
async def delete_goal(gid: str, user=Depends(get_current_user)):
    r = await db.goals.delete_one({"goal_id": gid, "user_id": user["user_id"]})
    if not r.deleted_count:
        raise HTTPException(404, "Goal not found")
    return {"ok": True}


# ---------------- AI Analyst ----------------
SYSTEM_PROMPT = """You are Kuber AI, a friendly crypto portfolio health analyst inside the Kuber Crypto app.
You explain things simply for beginner investors in India. Currency is INR (₹).

STRICT RULES:
- Use ONLY the portfolio data in PORTFOLIO_CONTEXT below. Never invent holdings, prices or figures.
- If something isn't in the data (e.g. trade history beyond what's shown, news, reasons behind market moves), say clearly that you don't have that information.
- Never promise or predict profits. Never tell the user to buy/sell as a certainty; frame ideas as things to consider.
- You cannot execute trades. Never ask for private keys or seed phrases.
- Keep answers short: 2-5 short paragraphs or a tight bullet list. Use **bold** for key numbers.
- Price status "demo" means prices are sample data, "stale" means cached — mention it if relevant.

PORTFOLIO_CONTEXT (JSON):
{context}
"""


def ai_context(summary, health, alerts, goals, vol):
    return json.dumps({
        "price_status": summary["price_status"],
        "totals": {k: round(summary[k], 2) for k in ("total_value", "total_invested", "pnl", "pnl_pct", "change_24h", "change_24h_pct")},
        "weekly": summary["weekly"],
        "holdings": [{"name": r["name"], "symbol": r["symbol"].upper(), "quantity": r["quantity"], "avg_buy_price": r["avg_price"],
                      "purchase_date": r["purchase_date"], "current_price": r["current_price"], "value": r["value"],
                      "invested": r["invested"], "pnl": r["pnl"], "pnl_pct": r["pnl_pct"], "allocation_pct": round(r["allocation"], 2),
                      "change_24h_pct": r["change_24h"], "change_7d_pct": r["change_7d"]} for r in summary["holdings"]],
        "health_score": None if not health else {k: health[k] for k in ("score", "risk", "categories", "observations", "suggestions", "portfolio_volatility", "asset_volatility", "deviations")},
        "drawdown_from_30d_peak_pct": vol.get("drawdown_30d"),
        "active_alerts": alerts,
        "goals": [{"name": g["name"], "target": g["target_value"], "target_date": g["target_date"], "progress_pct": g["progress_pct"], "remaining": g["remaining"]} for g in goals],
    }, default=str)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


@api.get("/chat/history")
async def chat_history(user=Depends(get_current_user)):
    return await db.chat_messages.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", 1).to_list(100)


@api.delete("/chat/history")
async def clear_chat(user=Depends(get_current_user)):
    await db.chat_messages.delete_many({"user_id": user["user_id"]})
    return {"ok": True}


@api.post("/chat")
async def chat(body: ChatIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    summary, vol, health, alerts, _ = await full_analysis(uid)
    if not summary["holdings"]:
        return cached_stream("You haven't added any holdings yet, so I can't give a personalised portfolio analysis. "
                             "Add your investments in **My Portfolio** (coin, quantity, average buy price and date) and I'll analyse your real numbers.")
    goals_raw = await db.goals.find({"user_id": uid}, {"_id": 0}).to_list(20)
    goals = [goal_progress(g, summary["total_value"]) for g in goals_raw]
    prev = await db.chat_messages.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(6)
    convo = "\n".join(f"{m['role'].upper()}: {m['content'][:800]}" for m in reversed(prev))
    prompt = (f"Recent conversation:\n{convo}\n\n" if convo else "") + f"USER QUESTION: {body.message}"
    await db.chat_messages.insert_one({"msg_id": new_id("msg"), "user_id": uid, "role": "user", "content": body.message, "created_at": now().isoformat()})

    llm = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"{uid}-{uuid.uuid4().hex[:6]}",
                  system_message=SYSTEM_PROMPT.format(context=ai_context(summary, health, alerts, goals, vol))
                  ).with_model("anthropic", "claude-opus-5-5")

    async def gen():
        full = ""
        try:
            async for ev in llm.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
        except Exception as e:
            logger.exception("AI error: %s", e)
            msg = "Sorry, the AI analyst is unavailable right now. Please try again shortly."
            full = full or msg
            yield f"data: {json.dumps({'error': msg})}\n\n"
        await db.chat_messages.insert_one({"msg_id": new_id("msg"), "user_id": uid, "role": "assistant", "content": full, "created_at": now().isoformat()})
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------- Explore & Chart Analyst ----------------
def llm_stream(system, prompt, on_done=None):
    llm = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=new_id("s"), system_message=system).with_model("anthropic", "claude-opus-5-5")

    async def gen():
        full = ""
        try:
            async for ev in llm.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    yield f"data: {json.dumps({'delta': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            if on_done and full:
                await on_done(full)
        except Exception as e:
            logger.exception("AI error: %s", e)
            yield f"data: {json.dumps({'error': 'The AI analyst is unavailable right now. Please try again shortly.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def cached_stream(text):
    async def gen():
        yield f"data: {json.dumps({'delta': text})}\n\n"
        yield "data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api.get("/explore/overview")
async def explore_overview(user=Depends(get_current_user)):
    return await explore.overview()


@api.get("/explore/search")
async def explore_search(q: str = "", user=Depends(get_current_user)):
    return await explore.search(q[:50])


@api.get("/explore/news")
async def explore_news(user=Depends(get_current_user)):
    return await explore.general_news()


@api.get("/coins/{cid}/detail")
async def coin_detail(cid: str, symbol: Optional[str] = None, user=Depends(get_current_user)):
    d = await explore.coin_detail(cid, symbol)
    if not d:
        raise HTTPException(404, "Market data for this coin is unavailable right now")
    h = await db.holdings.find_one({"user_id": user["user_id"], "coin_id": cid}, {"_id": 0})
    d["holding"] = h and {"quantity": h["quantity"], "avg_price": h["avg_price"], "value": h["quantity"] * (d["price"] or 0),
                          "pnl": h["quantity"] * ((d["price"] or 0) - h["avg_price"]), "holding_id": h["holding_id"]}
    return d


@api.get("/coins/{cid}/history")
async def coin_history(cid: str, days: str = "30", symbol: Optional[str] = None, user=Depends(get_current_user)):
    if days not in ("1", "7", "30", "90", "365", "max"):
        raise HTTPException(400, "Invalid period")
    return await explore.coin_history(cid, symbol, days)


@api.get("/coins/{cid}/news")
async def coin_news(cid: str, name: str, symbol: str = "", user=Depends(get_current_user)):
    return await explore.coin_news(name[:60], symbol[:15])


RESEARCH_PROMPT = """You are Kuber AI, a crypto research assistant for beginner investors in India (currency INR ₹).
Write a research summary using ONLY the DATA JSON below (market data from {source} and recent news headlines).
Use these markdown sections exactly: ## What it does, ## Main use cases, ## Recent developments, ## Historical performance, ## Major risks, ## Tokenomics considerations.
Rules: Under "Recent developments" only reference the provided headlines and name their source; if none, say no recent headlines were retrieved.
Never invent numbers, dates, partnerships or events. If data is missing, say it is unavailable. No price predictions or buy/sell advice.
Keep it under 350 words, plain language, use **bold** for key figures.

DATA:
{data}"""


class ResearchIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=15)
    refresh: bool = False


@api.post("/coins/{cid}/research")
async def coin_research(cid: str, body: ResearchIn, user=Depends(get_current_user)):
    day = date.today().isoformat()
    if not body.refresh:
        c = await db.coin_research.find_one({"coin_id": cid, "day": day}, {"_id": 0})
        if c:
            return cached_stream(c["content"])
    d = await explore.coin_detail(cid, body.symbol)
    if not d:
        raise HTTPException(404, "Coin data unavailable, so a research summary can't be generated")
    news = await explore.coin_news(d["name"], d["symbol"])
    data = {k: d.get(k) for k in ("name", "symbol", "rank", "price", "market_cap", "fdv", "volume", "circulating_supply", "total_supply",
                                  "max_supply", "ath", "ath_date", "ath_change", "atl", "atl_date", "change", "categories",
                                  "hashing_algorithm", "platforms", "genesis_date")}
    data["description"] = (d.get("description") or "")[:1500]
    data["news_headlines"] = [{"title": n["title"], "source": n["source"], "date": n["published_at"]} for n in news[:8]]

    async def save(text):
        await db.coin_research.update_one({"coin_id": cid, "day": day}, {"$set": {"content": text, "created_at": now().isoformat()}}, upsert=True)

    return llm_stream(RESEARCH_PROMPT.format(source=d["source"], data=json.dumps(data, default=str)), f"Write the research summary for {d['name']}.", save)


async def load_chart(symbol, interval):
    if interval not in ta.INTERVALS:
        raise HTTPException(400, "Unsupported interval")
    k, st = await explore.binance_klines(symbol, interval, ta.INTERVALS[interval])
    fx = await get_fx()
    if not k or not fx:
        raise HTTPException(404, f"Candlestick data isn't available for {symbol.upper()} (no USDT market on our data provider)")
    candles = [{"time": r[0] // 1000, "open": float(r[1]) * fx, "high": float(r[2]) * fx, "low": float(r[3]) * fx,
                "close": float(r[4]) * fx, "volume": float(r[5])} for r in k]
    series, snap = ta.compute(candles)
    return candles, series, snap, st, fx


@api.get("/chart/candles")
async def chart_candles(symbol: str, interval: str = "1h", user=Depends(get_current_user)):
    candles, series, snap, st, fx = await load_chart(symbol[:15], interval)
    return {"candles": candles, "series": series, "snapshot": snap, "status": "live" if st == "live" else "cached",
            "source": "Binance spot (SYMBOL/USDT), converted to INR at the current USD/INR rate", "usd_inr": fx,
            "fetched_at": now().isoformat()}


CHART_PROMPT = """You are Kuber AI Chart Analyst. Explain technical analysis simply for beginner crypto investors in India (prices in INR ₹).
You are analysing {name} ({symbol}) on the {interval} timeframe. Use ONLY the computed data below — candles were fetched at {fetched}.
Never invent indicator values, levels or patterns; quote the numbers given. If a value is null, say it's unavailable (insufficient data).
No price predictions, no guarantees, no buy/sell instructions — describe conditions and risks only.
{format}

COMPUTED_SNAPSHOT (indicators: RSI14, MACD 12/26/9, SMA20/50, EMA20, Bollinger 20/2; support/resistance from clustered swing pivots):
{snap}

LAST_30_CANDLES [time_utc, open, high, low, close, volume]:
{candles}"""

FULL_FORMAT = """Use these markdown sections: ## Market structure, ## Current trend (start with exactly one word: Bullish, Bearish or Sideways), ## Support levels, ## Resistance levels, ## Indicators (RSI, MACD, moving averages, Bollinger), ## Volume, ## Risk factors, ## Summary. Keep it under 380 words; use **bold** for key numbers."""


class ChartAskIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=15)
    name: str = Field(min_length=1, max_length=80)
    interval: str
    question: Optional[str] = Field(default=None, max_length=600)
    context: List[Dict[str, str]] = []


@api.post("/chart/analyze")
async def chart_analyze(body: ChartAskIn, user=Depends(get_current_user)):
    candles, series, snap, _, _ = await load_chart(body.symbol, body.interval)
    if len(candles) < 30:
        return cached_stream("Not enough candles were returned for this timeframe, so a reliable analysis is unavailable.")
    rows = [[datetime.fromtimestamp(c["time"], timezone.utc).strftime("%Y-%m-%d %H:%M"), round(c["open"], 4), round(c["high"], 4),
             round(c["low"], 4), round(c["close"], 4), round(c["volume"], 2)] for c in candles[-30:]]
    rnd = lambda v: round(v, 4) if isinstance(v, float) else v
    snap_r = {k: ([{kk: rnd(vv) for kk, vv in x.items()} for x in v] if isinstance(v, list) else rnd(v)) for k, v in snap.items()}
    fmt = FULL_FORMAT if not body.question else "Answer the user's question directly in 2-4 short paragraphs or bullets, referring to this coin and timeframe."
    system = CHART_PROMPT.format(name=body.name, symbol=body.symbol.upper(), interval=body.interval, fetched=now().strftime("%Y-%m-%d %H:%M UTC"),
                                 format=fmt, snap=json.dumps(snap_r), candles=json.dumps(rows))
    convo = "\n".join(f"{m.get('role', 'user').upper()}: {m.get('content', '')[:1200]}" for m in body.context[-4:])
    prompt = (f"Earlier in this chart session:\n{convo}\n\n" if convo else "") + (f"QUESTION: {body.question}" if body.question else "Analyse the chart now.")
    return llm_stream(system, prompt)


# ---------------- SIP Planner ----------------
class SipCalcIn(BaseModel):
    coin_id: str = Field(min_length=1, max_length=100)
    symbol: str = Field(min_length=1, max_length=15)
    amount: float = Field(gt=0, lt=1e9)
    months: int = Field(ge=3, le=120)
    frequency: str = Field(default="monthly", pattern="^(monthly|weekly)$")


@api.post("/sip/calculate")
async def sip_calculate(body: SipCalcIn, user=Depends(get_current_user)):
    return await sip.calculate(body.coin_id, body.symbol, body.amount, body.months, body.frequency)


class SipStrategyIn(BaseModel):
    coin_id: str = Field(min_length=1, max_length=100)
    symbol: str = Field(min_length=1, max_length=15)
    name: str = Field(min_length=1, max_length=80)
    interval: str = Field(pattern="^(1h|4h|1d|1w)$")
    budget: Optional[float] = Field(default=None, gt=0, lt=1e11)
    risk: str = Field(pattern="^(conservative|moderate|aggressive)$")
    horizon_years: float = Field(gt=0, le=30)


@api.post("/sip/strategy")
async def sip_strategy(body: SipStrategyIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    hs = await user_holdings(uid)
    summary = await build_summary(hs)
    settings = await get_settings(uid)
    row = next((r for r in summary["holdings"] if r["coin_id"] == body.coin_id), None)
    ctx = {"portfolio_value": summary["total_value"], "holdings_count": len(summary["holdings"]),
           "quantity": row and row["quantity"], "value": row and row["value"], "allocation_pct": row and row["allocation"],
           "pnl": row and row["pnl"], "pnl_pct": row and row["pnl_pct"], "avg_price": row and row["avg_price"]}
    return await sip.strategy({**body.model_dump(), "load_chart": load_chart}, ctx, settings["concentration_limit"])


SIP_PROMPT = """You are Kuber AI, explaining an investment-planning recommendation to a beginner crypto investor in India (INR ₹).
The DECISION below was computed by Kuber's rule-based engine from live chart indicators, the user's risk profile, budget, horizon and portfolio.
Explain it — do NOT change the strategy, percentages or rupee amounts, and never invent numbers or levels not in the data.
Distinguish the chart timeframe ({interval}, with {htf} confirmation) from the user's investment horizon ({horizon} years).
If the decision is WAIT or NO NEW POSITION, say clearly that investing zero new money right now is a valid choice.
No guarantees or price predictions. Use markdown sections: ## Market assessment, ## Why this strategy, ## Key technical signals, ## Portfolio fit, ## Risks, ## What would change this view. Under 350 words, **bold** key numbers.

DECISION:
{data}"""


@api.post("/sip/explain/{did}")
async def sip_explain(did: str, user=Depends(get_current_user)):
    d = sip.get_decision(did)
    if not d:
        raise HTTPException(404, "Recommendation expired — please run the analysis again")
    return llm_stream(SIP_PROMPT.format(interval=d["interval"], htf=d["higher_timeframe"], horizon=d["horizon_years"], data=json.dumps(d, default=str)),
                      "Explain this recommendation.")


@api.get("/")
async def root():
    return {"message": "Kuber Crypto API"}


app.include_router(api)

origins = os.environ.get("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[] if origins == "*" else origins.split(","),
    allow_origin_regex=r"https://([a-z0-9-]+\.)*(emergentagent\.com|emergent\.host)" if origins == "*" else None,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    explore.db = db
    market.db = db
    await db.api_cache.create_index("key", unique=True)
    import asyncio
    asyncio.create_task(explore.coin_index())
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.holdings.create_index([("user_id", 1), ("coin_id", 1)])
    await db.login_attempts.create_index("identifier")
    await db.user_sessions.create_index("session_token")
    email = os.environ["ADMIN_EMAIL"].lower()
    if not await db.users.find_one({"email": email}):
        await db.users.insert_one({"user_id": new_id("user"), "email": email, "name": "Admin", "role": "admin", "auth_provider": "password",
                                   "password_hash": hash_password(os.environ["ADMIN_PASSWORD"]), "created_at": now().isoformat()})


@app.on_event("shutdown")
async def shutdown():
    client.close()
