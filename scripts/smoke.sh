#!/bin/bash
A=http://localhost:8001/api
T=$(curl -s -c /tmp/c3.txt -X POST $A/auth/login -H "Content-Type: application/json" -d '{"email":"admin@kubercrypto.com","password":"Kuber@123"}' >/dev/null; grep access_token /tmp/c3.txt | awk '{print $7}')
H="Authorization: Bearer $T"
j() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }
curl -s $A/explore/overview -H "$H" | j "print(d['global'],d['source'],d['trending_source'],[g['symbol'] for g in d['gainers']])"
curl -s "$A/explore/search?q=sol" -H "$H" | head -c 300; echo
curl -s "$A/coins/solana/detail?symbol=sol" -H "$H" | j "print({k:d.get(k) for k in ['name','price','ath','atl','source','website','whitepaper','genesis_date','change']})"
curl -s "$A/coins/solana/history?days=max&symbol=sol" -H "$H" | j "print(len(d['points']),d['source'],d.get('change_pct'))"
curl -s "$A/coins/solana/news?name=Solana&symbol=sol" -H "$H" | head -c 300; echo
curl -s "$A/explore/news" -H "$H" | head -c 300; echo
curl -s "$A/chart/candles?symbol=sol&interval=1h" -H "$H" | j "print(len(d['candles']),d['snapshot'])"
