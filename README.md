# Podcast Clip Studio

Open-source clip engine and metrics tracker for podcasts. Point it at a YouTube channel and every new episode turns into a week of short-form clips: the best moments found by watching the whole episode, a headline and captions written by a model and verified by code, and a calendar to publish from. After you publish, it pulls your own numbers and tells you, with uncertainty, what actually works for *your* account.

Bring your own API keys, your own brand, your own style guide. Nothing here is tied to any particular show.

> Versión en castellano más abajo.

## What it does

**Clip search.** A daily cron reads the channel's public RSS feed (no OAuth). When a new episode appears, Gemini watches it end-to-end by URL (no download) and returns, as facts only: guest, credential, topic, thesis, the 3-5 axes of the conversation, and the 10 best 60-120 s segments with verbatim transcript, exact quotes with timestamps, an opening line, why it works, and the question people are already asking that this segment answers.

**Planning.** A planner picks which segments become clips, in what order and from which angle, so two consecutive days never say the same thing. Each episode owns its week; the default plan is one clip a day, Monday to Saturday.

**Writing.** OpenAI writes each clip's pieces (one-line claim, on-screen headline, hashtags per network) from the transcript alone. Then code takes over: it verifies that any quoted sentence really exists in the transcript, enforces the headline shape, the hashtag rules and the caption/headline number alignment, and assembles the final caption (claim + your CTA + hashtags). If a check fails, the model gets one retry with the list of problems; if a quote still can't be verified, the clip goes out without quotes rather than with an invented one.

**Calendar.** Today · Week · Episodes. Each piece shows the cut with a link to that second on YouTube, the headline, both captions with copy buttons, warnings, and the transcript. You mark what you published where.

**Metrics tracker.** Manual entry per network, or automatic: Apify scrapes your public TikTok and Instagram profiles, matches posts to calendar pieces (by pasted URL, then by date, guest name and caption similarity) and saves every post it sees, matched or not, with a daily snapshot so growth curves build themselves. YouTube Data API for Shorts. Optional QStash checkpoints at 5 h, 24 h and 7 d after publishing. Retention (hook % and completion %) is the one thing no scraper gives you, so there's a batch form for it.

**The model.** Pure math, no LLM. Each rate (saves/views, shares/views…) is a Beta-Binomial posterior with a weak prior, reported as a mean with a 90 % credible interval. Levers (hour, day, duration, audio, hashtag count, guest, headline signal…) are compared arm by arm with Monte Carlo: you get P(this option is the best), not a p-value. Thompson sampling decides what to try next, so the system explores while it doesn't know and stops when one option pulls away. The verdict at the top of Metrics says what is known, what isn't, and what would unlock the next conclusion. The confirmed findings are injected back into the writer's prompt.

**Settings.** A style guide (your voice, house rules) and a list of account rules, both editable in the UI and prepended to every prompt. Everything else is environment.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Postgres (Neon's HTTP driver or any Postgres via `pg`) · `@google/genai` · OpenAI chat completions with Structured Outputs · no CSS framework. Runs on Vercel's free tier (cron included) or anywhere Node runs.

## Quick start

```bash
git clone <this repo> && cd podcast-clip-studio
npm install
cp .env.example .env.local
```

Fill in `.env.local`. The minimum to open the app:

| Variable | What |
|---|---|
| `DATABASE_URL` | Neon or any Postgres. Tables are created on first request. |
| `ACCESS_CODE` | 8+ characters. Or configure Google login (see below). |

The minimum for the engine to work:

| Variable | What |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey). Watches the episode. |
| `OPENAI_API_KEY` | Writes captions. `OPENAI_MODEL` defaults to `gpt-5`. |
| `YOUTUBE_CHANNEL_ID` | The `UC…` id of the channel, for the daily scan. You can also paste episode URLs by hand. |

Then:

```bash
npm run dev      # http://localhost:3000 → /login
```

Local Postgres if you don't want Neon yet:

```bash
docker run -d -e POSTGRES_PASSWORD=studio -e POSTGRES_DB=studio -p 5432:5432 postgres:16-alpine
# DATABASE_URL=postgres://postgres:studio@localhost:5432/studio
```

### Deploy on Vercel

1. Import the repo. Add the env vars from `.env.example` (at least the ones above plus `CRON_SECRET`).
2. `vercel.json` schedules `GET /api/cron/scan` daily at 13:00 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`.
3. Optional: `vercel integration add neon` provisions the database and sets `DATABASE_URL`.

### Google login

Create an OAuth client (Web) in Google Cloud Console with redirect URI `https://<your-domain>/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) and `ALLOWED_EMAILS` (comma-separated). With Google configured the access code keeps working for the cron and curl.

### Branding

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | Clip Studio |
| `NEXT_PUBLIC_BRAND_ACCENT` | `#ff6a00` (any hex) |
| `NEXT_PUBLIC_TIMEZONE` / `NEXT_PUBLIC_LOCALE` | `America/Argentina/Buenos_Aires` / `es-AR` |
| `PODCAST_NAME`, `PODCAST_DESCRIPTION`, `CONTENT_LANGUAGE` | Go into the prompts |
| `BRAND_HASHTAG` | Required in every caption if set |
| `CTA_TEXT` | Closes every caption |
| `WEEKLY_PLAN`, `PUBLISH_TIME`, `CLIPS_PER_EPISODE` | `1,2,3,4,5,6`, `21:00`, `5` |

### Metrics (optional)

`APIFY_TOKEN` + `TIKTOK_USERNAME` / `INSTAGRAM_USERNAME` for the profile scrape (Apify's free plan covers a daily sync of two accounts). `YOUTUBE_API_KEY` for Shorts. `QSTASH_URL` + `QSTASH_TOKEN` for the 5 h / 24 h / 7 d checkpoints; without QStash, metrics arrive with the daily sync.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build (includes type check)
npm run typecheck
npm test            # pure unit tests: planner, copy gates, Bayesian model
```

## How it's built

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Short version: `lib/episode-engine.ts` (perceive) → `lib/agents.ts` (plan) → `lib/copy.ts` (write + verify) → `lib/pipeline.ts` (orchestrate) → `lib/store.ts` (persist) · `lib/metrics-sync.ts` (measure) → `lib/stats.ts` (model). The UI is `app/calendario`.

Design principles that shaped it:

1. **Perception and writing are separate models at separate temperatures.** One model that watches *and* writes invents quotes.
2. **Rules that matter live in code, not in prompts.** Every rule that only lived in a system prompt eventually got ignored.
3. **Nothing automatic publishes.** The app plans, writes, measures. You press publish.
4. **Shipping fewer pieces silently is the worst failure.** When the week can't be filled, the log says which day and why.
5. **What the network doesn't report is "unknown", never zero.** Instagram doesn't expose saves; the model treats that as missing, not as a bad result.

## Security

See [`SECURITY.md`](SECURITY.md). Fail-closed auth, no default credentials, secrets never reach the browser, parameterised queries, constant-time code comparison.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). MIT license.

---

## En castellano

Motor de clips y tracker de métricas para podcasts, open source. Apuntalo a un canal de YouTube y cada episodio nuevo se convierte en una semana de clips: los mejores momentos encontrados mirando el episodio entero, un titular y captions escritos por un modelo y verificados por código, y un calendario desde donde publicar. Después de publicar, trae tus propios números y te dice, con incertidumbre, qué funciona en *tu* cuenta.

Cada persona pone sus API keys, su marca y su guía de estilo. Nada acá está atado a un podcast en particular.

**Cómo funciona.** Un cron diario lee el RSS público del canal. Gemini mira el episodio nuevo por URL y devuelve sólo hechos: invitado, credencial, tema, tesis, ejes y los 10 mejores tramos de 60-120 s con transcripción verbatim, citas con segundo, gancho, motivo y la curiosidad que responde. Un planificador elige cuáles van a clip y con qué ángulo. OpenAI escribe las piezas del caption a partir de la transcripción, y el código verifica que toda cita exista, que el titular tenga forma de titular y que los hashtags cumplan las reglas; el caption final lo arma el código (claim + tu CTA + hashtags). Vos publicás y marcás dónde. Las métricas se cargan a mano o llegan solas por Apify (TikTok/Instagram) y la YouTube Data API. Un modelo bayesiano (sin LLM) compara palancas con intervalos creíbles y decide con Thompson sampling qué probar en la próxima pieza; sus conclusiones firmes vuelven al prompt del redactor.

**Para arrancar.** `npm install`, copiá `.env.example` a `.env.local`, cargá `DATABASE_URL` y `ACCESS_CODE` (para entrar) y `GEMINI_API_KEY`, `OPENAI_API_KEY`, `YOUTUBE_CHANNEL_ID` (para que el motor ande), y `npm run dev`. En Vercel, agregá `CRON_SECRET`: el cron ya está en `vercel.json`. La guía de estilo y las reglas de tu cuenta se editan en Ajustes.

**Principios.** Percibir y redactar son modelos distintos a temperaturas distintas. Las reglas que importan viven en código, no en el prompt. Nada automático publica. Salir con menos piezas sin aviso es el peor resultado. Lo que la red no reporta es "no se sabe", nunca cero.
