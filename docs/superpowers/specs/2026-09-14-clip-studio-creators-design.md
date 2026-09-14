# Clip Studio for creators — design

Date: 2026-09-14. Approved by Fran in chat.

## Goal

Turn Podcast Clip Studio into **Clip Studio**: an open-source clip engine and metrics tracker for
creators with a personal brand who upload vlogs and videos to YouTube. Fran hosts a public landing on
Vercel; each creator runs their own copy with their own keys. Credits: "powered by SWAP Labs".

## 1. Product repositioning

- Name: Clip Studio. Repo renamed to `clip-studio`.
- The speaker is the creator (`CREATOR_NAME`), not a guest. Remove `credencial` and `numero_episodio`
  from the perception schema, the copy schema, the store and the UI.
- Gemini prompt looks for what works in a vlog: anecdote with an ending, strong opinion, concrete
  number, visual moment, change of tone. Planner and writer prompts follow.
- Quote mould: `"..." Name 🎯` only when `QUOTE_WITH_NAME=1`; default is the quote plus emoji.
- Vocabulary: "episodio/invitado" → "video/vos" in UI, prompts, docs.

## 2. Hosting model

- Fran's Vercel: `LANDING=1` → `/` renders the public landing; the app lives at `/app` behind auth.
- Personal deploys: `/` redirects to `/app`. The landing route stays available at `/landing`.
- The landing stores nothing. Static, no database needed when `LANDING=1` and nobody logs in.

## 3. Onboarding via Claude Code / Codex

- Landing has "Copiar prompt": one paragraph telling an agent to clone the repo and follow `ONBOARDING.md`.
- `ONBOARDING.md`: an agent runbook. Collect channel URL, creator name, TikTok/Instagram handles,
  Gemini and OpenAI keys, optional metrics keys. Run `npm run setup`, then `vercel integration add neon`,
  `vercel env` and `vercel --prod`.
- `npm run setup` (`scripts/setup.mts`): interactive when a TTY, flag-driven otherwise. Resolves the
  channel id from any YouTube URL, checks the channel has long videos, verifies the Gemini and OpenAI
  keys with a real call, writes `.env.local`. Never prints the keys back.
- `.claude/commands/onboard.md` and `AGENTS.md` point agents to `ONBOARDING.md`.

## 4. Pruning

Remove: credencial, numero_episodio, stretch clips, QStash checkpoints, separate rules list (one style
guide remains). Keep: daily scan, engine, weekly plan, writer with code gates, Hoy/Semana/Videos,
tracking (manual + Apify + YouTube API), retention form, Bayesian model, settings.

## 5. Verification

Full run against a real vlog channel with Fran's keys locally (deleted afterwards); unit tests and
production build green; Fran's Vercel deployed in landing mode. Repo goes public after Fran sees it.
