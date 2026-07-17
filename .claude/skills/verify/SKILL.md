---
name: verify
description: Build/launch/drive recipe for verifying changes in the running app (Next.js dev + Playwright).
---

# Verifying changes in the running app

## Launch

```powershell
# New runtime exports in type-heavy modules go stale under Turbopack HMR —
# clear the cache before judging a change (see project memory).
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
pnpm dev        # ready in ~2s on http://localhost:3000
```

## Drive (headless Playwright)

Browsers are already installed (`~/AppData/Local/ms-playwright`). pnpm hides
transitive deps, so require the direct devDep:

```js
const { chromium } = require("@playwright/test");
```

Signed-out demo plan (no Supabase needed), cribbed from `e2e/plan.spec.ts`:
goto `/plan` → redirects `/plan/new` → "Add a program" → palette search →
pick option → Done → Continue → "Build my plan" → back on `/plan`.

- Local plan lives at localStorage key `uwfinder.plan.v1` — read it with
  `page.evaluate` to assert writes.
- Catalog gotcha: the search input is controlled; `fill()` right after goto
  lands before hydration and the filter never fires. Wait for a
  `tbody tr` first, then `pressSequentially`.
- Add-to-term surfaces: catalog row "Add" button; course detail
  `/course/<code>` "Add to plan"; one-click `/course/<code>?from=picker&term=<termId>`.
- A reliably program-blocked course for an engineering plan: `actsc363`
  ("Actuarial Science or Mathematical Finance students only", no prereqs).

## Flows worth driving

- Add a course via catalog picker → assert localStorage write + modal closes.
- Re-open same course → "Already placed in …", every option disabled.
- Blocked course → "This course isn't open to your program.", no term options.
- One-click add → button "Add to <term>", routes to /plan on success;
  bogus/blocked term falls back to the full picker, writes nothing.
