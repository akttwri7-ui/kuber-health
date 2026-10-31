# Auth Testing Playbook

## JWT email/password
curl -c cookies.txt -X POST $URL/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@kubercrypto.com","password":"Kuber@123"}'
curl -b cookies.txt $URL/api/auth/me

## Google (Emergent) session test
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({user_id: userId, email: 'test.user.' + Date.now() + '@example.com', name: 'Test User', role:'user', auth_provider:'google', created_at: new Date()});
db.user_sessions.insertOne({user_id: userId, session_token: sessionToken, expires_at: new Date(Date.now() + 7*24*60*60*1000), created_at: new Date()});
print('Session token: ' + sessionToken);
"
curl $URL/api/auth/me -H "Authorization: Bearer <token>"
Browser: add cookie session_token (httpOnly, secure, sameSite None) then open /dashboard.
