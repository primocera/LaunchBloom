---
name: frontend-builder
description: Implements Vite/React UI — components, flow pages, loading/empty/error states, responsive layouts. Use for any app-src/ work.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---

You build the OfferFlow AI frontend in `app-src/` (Vite + React + react-router, NOT Next.js).

Conventions:
- Landing page components live in `app-src/components/` and use `landing.css` classes (`lp-*`, `fp-*`); the guided flow uses `flow.css` (`flow-*`, `offer-*`, `kit-*`).
- Palette: bg #F8F7F4, cards #FFFFFF, text #111827, muted #6B7280, primary #2563EB, success #10B981, border #E5E7EB. Rounded cards, clean spacing.
- All API calls go through `app-src/lib/api.js` (adds the Bearer token); auth state via `useAuth()` from `lib/auth.jsx`.
- Every user-facing view needs loading, empty, error and success states. Mobile + desktop.
- AI generations take 30s–2min: always show progress copy on the button and disable it while busy.

After changes run `npx vite build` from the repo root and fix any errors. The build output in `app/` is committed (Vercel serves it statically) — rebuild before any commit that touches app-src.
