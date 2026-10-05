#!/usr/bin/env bash
# Recria o banco local, cria usuários de teste e roda os testes SQL.
set -e
cd "$(dirname "$0")"
pgrep dockerd >/dev/null || { (nohup dockerd >/tmp/dockerd.log 2>&1 &); sleep 8; npx supabase start >/dev/null 2>&1 || true; }
npx supabase db reset >/dev/null 2>&1
SR=$(npx supabase status -o json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
for e in dono@teste.local intruso@teste.local; do
  curl -s -o /dev/null -X POST http://127.0.0.1:54321/auth/v1/admin/users -H "apikey: $SR" -H "Authorization: Bearer $SR" \
    -H "Content-Type: application/json" -d "{\"email\":\"$e\",\"password\":\"senha-teste-123\",\"email_confirm\":true}"
done
psql -q postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "insert into public.membros(user_id,nome) select id,'Dono teste' from auth.users where email='dono@teste.local'"
psql -q postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/fluxos.sql 2>&1 | grep -E "ERROR" | head -1
psql -q postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/fluxos_v11.sql 2>&1 | grep -E "ERROR" | head -1
