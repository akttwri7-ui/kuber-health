#!/bin/bash
# Acceptance checks for manual-only holdings
A=http://localhost:8001/api
E1="u1_$RANDOM@test.com"; E2="u2_$RANDOM@test.com"
reg() { curl -s -c /tmp/$1.txt -X POST $A/auth/register -H "Content-Type: application/json" -d "{\"email\":\"$2\",\"password\":\"secret123\",\"name\":\"T\"}" >/dev/null; grep access_token /tmp/$1.txt | awk '{print $7}'; }
T1=$(reg a $E1); T2=$(reg b $E2)
H1="Authorization: Bearer $T1"; H2="Authorization: Bearer $T2"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
echo "1 new user:"; curl -s $A/portfolio/summary -H "$H1" | j "print(len(d['holdings']),d['total_value'],d['total_invested'],d['pnl'])"
curl -s $A/portfolio/health -H "$H1" | j "print('health',d['health'])"
curl -s $A/risk -H "$H1" | j "print('alerts',d['alerts'])"
curl -s "$A/portfolio/history?days=30" -H "$H1" | j "print('history pts',len(d['points']))"
curl -s -N -X POST $A/chat -H "$H1" -H "Content-Type: application/json" -d '{"message":"How am I doing?"}' | head -c 200; echo
curl -s -o /dev/null -w "demo endpoint %{http_code}\n" -X POST $A/holdings/demo -H "$H1"
add() { curl -s -X POST $A/holdings -H "$H1" -H "Content-Type: application/json" -d "{\"coin_id\":\"$1\",\"symbol\":\"$2\",\"name\":\"$3\",\"quantity\":$4,\"avg_price\":$5,\"purchase_date\":\"2026-01-10\"}" | j "print(d['holding_id'])"; }
B=$(add bitcoin btc Bitcoin 0.1 6000000)
curl -s $A/portfolio/summary -H "$H1" | j "print('after btc',[(h['symbol'],h['quantity'],h['invested'],round(h['value']),round(h['pnl']),round(h['pnl_pct'],2)) for h in d['holdings']], round(d['total_value']), d['total_invested'])"
EID=$(add ethereum eth Ethereum 1 250000)
curl -s $A/portfolio/summary -H "$H1" | j "print('after eth',[h['symbol'] for h in d['holdings']], round(d['total_value']), d['total_invested'], round(d['pnl']), round(sum(h['allocation'] for h in d['holdings']),2))"
curl -s -X PUT $A/holdings/$B -H "$H1" -H "Content-Type: application/json" -d '{"coin_id":"bitcoin","symbol":"btc","name":"Bitcoin","quantity":0.2,"avg_price":6000000,"purchase_date":"2026-01-10"}' >/dev/null
curl -s $A/portfolio/summary -H "$H1" | j "print('after edit',[(h['symbol'],h['quantity'],h['invested']) for h in d['holdings']], d['total_invested'])"
echo "user2:"; curl -s $A/portfolio/summary -H "$H2" | j "print(len(d['holdings']),d['total_value'])"
curl -s -o /dev/null -w "user2 delete user1 holding %{http_code}\n" -X DELETE $A/holdings/$B -H "$H2"
curl -s -X DELETE $A/holdings/$EID -H "$H1" >/dev/null
curl -s $A/portfolio/summary -H "$H1" | j "print('after delete eth',[h['symbol'] for h in d['holdings']], d['total_invested'])"
curl -s -X DELETE $A/holdings/$B -H "$H1" >/dev/null
curl -s $A/portfolio/summary -H "$H1" | j "print('after delete all',len(d['holdings']),d['total_value'])"
curl -s $A/portfolio/health -H "$H1" | j "print('health',d['health'])"
