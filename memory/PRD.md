# Kuber Crypto – PRD

## Original problem statement
Upgrade Kuber Crypto into an AI-powered crypto portfolio tracker & Portfolio Health analyst (INR). Dashboard, manual holdings CRUD (average-cost), live prices, Portfolio Health Score (4×25), AI Portfolio Analyst grounded in real data, risk monitoring (drawdown thresholds, concentration), investment goals, weekly summary, premium dark fintech UI, responsive. Budget-conscious MVP.

## User choices
- Auth: Emergent Google Sign-In + email/password (JWT)
- AI: Claude Opus 5.5 (Emergent LLM key)
- Prices: free sources (CoinGecko → Binance public klines × USD/INR fallback → labeled DEMO)
- "Wonderful & entertaining" → investor persona, animated score ring, floating coin empty state

## Architecture
- Backend FastAPI: server.py (auth, CRUD, settings, risk, goals, SSE chat), analytics.py (summary/P&L, history, volatility, drawdown, health, alerts, goals), market.py (price providers + in-memory cache + 429 backoff)
- Mongo collections: users, user_sessions, login_attempts, holdings, transactions, settings, notifications, goals, chat_messages
- Frontend React + SWR + recharts + shadcn; pages Dashboard, Portfolio, Health, Analyst, Risk, Goals, Settings, Login

## Implemented (2026-06)
- All P0, P1, P2 features above; sample portfolio loader; notification bell; tested (iteration_1: backend 25/26 → fixed lockout, frontend 100%)
- Post-test fixes: lockout keyed by email, CORS no credential wildcard, notification number formatting/refresh, price API backoff, local-date validation, mobile tweaks

## Iteration 2 (2026-06) – Crypto Intelligence upgrade
- Home / Crypto Explore (/home, default): search autocomplete (logos + INR prices), global stats, trending, gainers/losers, top-20, RSS news (Cointelegraph, Decrypt)
- Coin detail (/coin/:id): stats, ATH/ATL, 24H–All history chart, about/links, Google News RSS, AI research (Claude, cached daily), add-to-portfolio, holding banner
- AI Chart Analyst (/chart): lightweight-charts v5 candles (Binance USDT×USD/INR), 5m–1w, SMA/EMA/BB/RSI/MACD/volume (backend ta.py), Analyze Chart + quick/custom questions (SSE)
- My Portfolio now includes former dashboard overview; /dashboard → /portfolio
- Data resilience: CoinGecko → CoinPaprika → Binance fallbacks, Mongo-persisted API cache (api_cache), CG id index (coin_index)
- Tested iteration_2: backend 61/61; fixed after: id mapping, 402 backoff, mobile chart overflow, stream race, oscillator axis format, S/R clustering

## Backlog
- P1: Sell/partial-sell transactions with realized P&L; transaction history UI
- P2: Weekly email digest, CSV import, price alerts per coin, shadcn calendar date pickers
