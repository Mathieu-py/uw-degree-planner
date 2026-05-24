# Local Supabase

This directory holds the Supabase project for the planner: schema migrations,
local-dev config, and an RLS smoke-test script. It's only used in local
development for now — production wiring (cloud project, env vars in the host)
is deferred.

## Prerequisites

- Docker Desktop running (the Supabase CLI starts Postgres + GoTrue + Studio +
  Inbucket as containers).
- The `supabase` CLI is a project devDependency — no global install needed,
  invoke it as `pnpm exec supabase ...`.

## First-time setup

```bash
# Boot Postgres / Auth / Storage / Studio (~30s the first time).
pnpm exec supabase start

# Get the anon key + URLs to drop into .env.local.
pnpm exec supabase status
```

Copy `.env.example` to `.env.local` and paste in the printed values:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
```

Then `pnpm dev` and the planner should load with a "Sign in" button in the
header. The button does nothing useful yet — see "Enabling Google sign-in"
below.

## Re-applying migrations

```bash
pnpm exec supabase db reset
```

Drops and recreates the local database from `migrations/*.sql` (and runs
`seed.sql` if present). Safe — local data only.

## Enabling Google sign-in

The migration and code paths are ready, but the local Auth server has Google
disabled by default so `supabase start` succeeds for contributors who don't
care about auth.

1. Create an OAuth 2.0 Client ID at
   <https://console.cloud.google.com/apis/credentials>:
   - Application type: **Web application**
   - Authorized redirect URI:
     `http://127.0.0.1:54321/auth/v1/callback`
2. Put the client id + secret into `.env.local`:
   ```
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
   ```
3. Flip `enabled = true` under `[auth.external.google]` in `config.toml`.
4. Restart: `pnpm exec supabase stop && pnpm exec supabase start`.

## Verifying RLS

`test/rls.sql` creates two users, seeds plans for each, and asserts that one
user cannot see the other's data via direct query — but can resolve the
other's `share_token` through the `get_shared_plan` RPC. Run it against a
fresh database:

```bash
pnpm exec supabase db reset
psql "$(pnpm exec supabase status --output env | grep DB_URL | cut -d= -f2-)" \
  -f supabase/test/rls.sql
```

The script `RAISE NOTICE`s its assertions; a clean run prints "RLS test
passed" at the end.
