# Architecture

One Next.js app. Server code in `lib/`, routes in `app/api/`, UI in `app/app/` and `app/login/`, the public landing in `components/landing.tsx` (served at `/` when `LANDING_MODE=1`), onboarding scripts in `scripts/`.

```
YouTube RSS ──▶ scanChannel ──▶ Video(pending)
                                    │
                    step=analyze    ▼
                Gemini (video-engine) ──▶ VideoAnalysis {clips[], ejes[], tesis…}
                                    │
                                    ▼
                scheduleVideo: cederLaSemana → weekSlots → planVideo (OpenAI)
                                    │  reserves Item(drafting) per day
                    step=write      ▼
                writePendingItems → buildClipItem → writeCopy (OpenAI) → findProblems (code)
                                    │  Item(planned) with ClipItem
                                    ▼
                UI: publish, mark networks, paste post URLs
                                    │
                    step=metrics    ▼
                syncMetrics: Apify (TikTok, Instagram) + YouTube API → matchPosts → applyMetrics
                                    │  PublishedPost[] + Item.metrics
                                    ▼
                stats.ts: posterior / analizarPalancas / decidir / conocimiento
                                    │
                                    └──▶ reglasDelModelo → back into the writer's prompt
```

## Modules

| File | Responsibility |
|---|---|
| `lib/config.ts` | Everything that identifies one channel, read from env. `publicConfig()` is what the UI may know (booleans for secrets). |
| `lib/db.ts` | `sql()` tagged template + `transaction()`. Neon HTTP driver when the URL is Neon, `pg` Pool otherwise. `ensureSchema()` creates three tables: `videos`, `items`, `meta`. |
| `lib/store.ts` | The `State` type (videos, items, settings, posts, log) and `loadState` / `saveState` / `mergeSave`. Each entity is a row with key columns plus a JSONB `data`. **`saveState` writes `meta` field by field: a new State field must be added in both `loadState` and `saveState` or it is silently dropped.** |
| `lib/youtube.ts` | Channel RSS, video length from the watch page, oEmbed title, URL parsing. No API key. |
| `lib/video-engine.ts` | Stage 1. Gemini watches the video by URL (`fps 0.2`, low media resolution) with a JSON schema. Filters clips to 45-140 s and sorts by score. |
| `lib/agents.ts` | The planner: which candidates become clips, order and angle. Falls back to score order if OpenAI fails. |
| `lib/copy.ts` | Stage 2. `writeCopy` (OpenAI, Structured Outputs) → `findProblems` (code gates) → one retry → `buildCaption` (code assembles claim + CTA + hashtags). `quoteIsReal` is the last line of defence against invented quotes. |
| `lib/engine.ts` | The copy system prompt and hashtag ban lists. Brand-neutral; brand comes from config. |
| `lib/style.ts` | `doctrine(state)`: creator identity + the editable style guide, prepended to the planner and writer prompts. |
| `lib/planner.ts` | Dates. Weekly plan, video week, free slots, `cederLaSemana` (the video owns its week), `faltantesDeLaSemana` (names what could not be scheduled and why). Pure; tested. |
| `lib/pipeline.ts` | Orchestration: scan → analyze → schedule → write. Idempotent over `State`, logs every step. |
| `lib/chain.ts` | Serverless functions have a time budget. Writing runs in batches of 2 and re-invokes `/api/cron/scan?step=write` with `after()`. |
| `lib/metrics-sync.ts` | Apify actors (`clockworks~tiktok-profile-scraper`, `apify~instagram-scraper`), YouTube Data API, post↔piece matching (`matchPosts`, tested), daily snapshots. |
| `lib/stats.ts` | The Bayesian model. Beta-Binomial posteriors, Monte Carlo comparison of arms, Thompson sampling, the verdict. Deterministic RNG so the report doesn't change on refresh. Pure; tested. |
| `lib/auth.ts` | Google OAuth (PKCE) with an email allowlist, or access code. HMAC-signed session cookie. Fail-closed. |
| `app/api/calendar/route.ts` | `GET` state + config + model; `POST {action}` for every UI action. |
| `app/api/cron/scan/route.ts` | The daily cron and the self-invoked steps: `analyze`, `write`, `metrics`. |
| `app/app/page.tsx` | Tabs: Hoy · Semana · Videos · Publicaciones · Métricas · Ajustes. |
| `app/app/parts.tsx` | ItemDetail, VideoRow, Tracking (metrics per network), StatsSection. |
| `app/page.tsx` | `LANDING_MODE=1` → the public landing; otherwise redirects to `/app`. |
| `scripts/setup.mts` | Onboarding: resolves the channel id, validates every key against its API, writes `.env.local`. Flag-driven so an agent can run it. |
| `scripts/push-env.mts` | Uploads `.env.local` to the linked Vercel project via `vercel env add` (values by stdin). |

## Data model

- **Video**: `videoId`, `title`, `publishedAt`, `status` (`pending → analyzing → analyzed | error | ignored`), `analysis`, `scheduled.clips`, `planNote`.
- **Item** (a clip on a date): `videoId`, `status` (`drafting → planned → published`), `draft` (reserved candidate + angle) until written, then `clip: ClipItem` (cut, captions, pieces, warnings, transcript), `publishedOn[]`, `posts` (URL per network), `metrics` per network.
- **PublishedPost**: what is actually online, matched or not, with a per-day `history` of metrics. This is where the model's observations come from.
- **Settings**: `styleGuide`.

## Time budget

Vercel functions get up to 300 s here (`maxDuration`). Gemini watching a long video uses most of one invocation, so `analyze` is its own step. Writing is chained in batches of 2. Metrics sync is its own step because the scrapers take 1-3 minutes.

## Timezone

Everything user-facing is in `NEXT_PUBLIC_TIMEZONE`. Dates in the database are local `YYYY-MM-DD` strings; the publish instant is derived with `PUBLISH_TIME` in that zone (`metrics-sync.ts → localInstant`).

## What was deliberately left out

Guest and credential handling (this is for solo creators), carousels, thumbnails, video rendering, Canva/CapCut integrations, competitor scraping, LLM audits and weekly reports, vector search, delayed metric checkpoints via an external scheduler. They exist in the private tool this was extracted from and are tied to one show's design system and doctrine. The engine and the tracker are the parts that are the same for everyone.
