# Clip Studio

Open-source clip engine and metrics tracker for creators who upload to YouTube. Point it at your channel and every new video turns into a week of short-form clips: the best moments found by watching the whole video, a headline and captions written by a model and verified by code, and a calendar to publish from. After you publish, it pulls your own numbers and tells you, with uncertainty, what actually works for *your* account.

Runs in your own Vercel account, with your own keys. Nothing here is tied to any particular channel.

> Versión en castellano más abajo. · Powered by [SWAP Labs](https://github.com/FranDEVtec).

## Install in 10 minutes with an agent

Open **Claude Code** or **Codex** in an empty folder and paste:

> Cloná https://github.com/FranDEVtec/clip-studio en una carpeta nueva y seguí ONBOARDING.md paso a paso. Es mi copia de Clip Studio: preguntame lo que necesites (mi canal de YouTube, mi nombre, mis redes y mis API keys), validá cada dato con npm run setup, creá la base gratis en Neon y dejalo deployado en mi cuenta de Vercel. No inventes valores ni saltees pasos.

The agent follows [`ONBOARDING.md`](ONBOARDING.md): it asks for your channel URL, your name, your handles and your Gemini and OpenAI keys, validates every value against the real API with `npm run setup`, creates a free Postgres on Neon and deploys to your Vercel. You get a URL and an access code.

Prefer to do it by hand? Same steps, below.

## What it does

**Clip search.** A daily cron reads the channel's public RSS feed (no OAuth). When a new video appears, Gemini watches it end-to-end by URL (no download) and returns, as facts only: topic, thesis, the 3-5 axes of the video, and the 10 best 60-120 s segments with verbatim transcript, exact quotes with timestamps, an opening line, why it works, and the question people are already asking that this segment answers. Shorts and videos under 5 minutes are skipped.

**Planning.** A planner picks which segments become clips, in what order and from which angle, so two consecutive days never say the same thing. Each video owns its week; the default plan is one clip a day, Monday to Saturday.

**Writing.** OpenAI writes each clip's pieces (one-line claim, on-screen headline, hashtags per network) from the transcript alone. Then code takes over: it verifies that any quoted sentence really exists in the transcript, enforces the headline shape, the hashtag rules and the caption/headline number alignment, and assembles the final caption (claim + your CTA + hashtags). If a check fails, the model gets one retry with the list of problems; if a quote still can't be verified, the clip goes out without quotes rather than with an invented one.

**Calendar.** Today · Week · Videos. Each piece shows the cut with a link to that second on YouTube, the headline, both captions with copy buttons, warnings, and the transcript. You mark what you published where.

**Metrics tracker.** Manual entry per network, or automatic: Apify reads your public TikTok and Instagram profiles, matches posts to calendar pieces (by pasted URL, then by date and caption similarity) and saves every post it sees, matched or not, with a daily snapshot so growth curves build themselves. YouTube Data API for Shorts. Retention (hook % and completion %) is the one thing no scraper gives you, so there's a batch form for it.

**The model.** Pure math, no LLM. Each rate (saves/views, shares/views…) is a Beta-Binomial posterior with a weak prior, reported as a mean with a 90 % credible interval. Levers (hour, day, duration, audio, hashtag count, headline signal…) are compared arm by arm with Monte Carlo: you get P(this option is the best), not a p-value. Thompson sampling decides what to try next, so the system explores while it doesn't know and stops when one option pulls away. The verdict at the top of Metrics says what is known, what isn't, and what would unlock the next conclusion. Confirmed findings are injected back into the writer's prompt.

**Settings.** A style guide (your voice, house rules), editable in the UI and prepended to every prompt. Everything else is environment.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Postgres (Neon's HTTP driver or any Postgres via `pg`) · `@google/genai` · OpenAI chat completions with Structured Outputs · no CSS framework. Runs on Vercel's free tier (cron included) or anywhere Node runs.

## Manual setup

```bash
git clone --depth 1 https://github.com/FranDEVtec/clip-studio.git && cd clip-studio
rm -rf .git            # Vercel blocks CLI deploys whose commit author isn't a member of your account
npm install
npm run setup          # asks for channel, name, handles and keys; validates each one; writes .env.local
```

`npm run setup` also accepts everything as flags (see `ONBOARDING.md`). What it writes:

| Variable | What |
|---|---|
| `DATABASE_URL` | Neon or any Postgres. Tables are created on first request. Empty until you create the database. |
| `ACCESS_CODE` | Generated. The app's password. Or configure Google login (below). |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey), free. Watches the video. |
| `OPENAI_API_KEY` | Plans the week and writes captions. `OPENAI_MODEL` defaults to `gpt-5`. |
| `YOUTUBE_CHANNEL_ID` | Resolved from your channel URL. |
| `CREATOR_NAME`, `CHANNEL_DESCRIPTION`, `CONTENT_LANGUAGE` | Go into the prompts. |
| `CRON_SECRET` | Generated. Vercel sends it to the daily cron. |

Then:

```bash
npx vercel login && npx vercel link
npx vercel integration add neon     # free Postgres, sets DATABASE_URL on Vercel
npm run push-env                    # uploads .env.local to production
npx vercel --prod
```

Local development: `npx vercel env pull .env.local` then `npm run dev` → `http://localhost:3000`. Without Vercel, any Postgres works: `docker run -d -e POSTGRES_PASSWORD=studio -e POSTGRES_DB=studio -p 5432:5432 postgres:16-alpine` and `DATABASE_URL=postgres://postgres:studio@localhost:5432/studio`.

### Google login

Create an OAuth client (Web) in Google Cloud Console with redirect URI `https://<your-domain>/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`) and `ALLOWED_EMAILS` (comma-separated). The access code keeps working for the cron and curl.

### Branding and plan

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | Clip Studio |
| `NEXT_PUBLIC_BRAND_ACCENT` | `#ff6a00` (any hex) |
| `NEXT_PUBLIC_TIMEZONE` / `NEXT_PUBLIC_LOCALE` | `America/Argentina/Buenos_Aires` / `es-AR` |
| `BRAND_HASHTAG` | Required in every caption if set |
| `CTA_TEXT` | Closes every caption |
| `WEEKLY_PLAN`, `PUBLISH_TIME`, `CLIPS_PER_VIDEO`, `VIDEO_MIN_SEC` | `1,2,3,4,5,6`, `21:00`, `5`, `300` |

### Metrics (optional)

`APIFY_TOKEN` + `TIKTOK_USERNAME` / `INSTAGRAM_USERNAME` for the profile scrape (Apify's free plan covers a daily sync of two accounts). `YOUTUBE_API_KEY` for Shorts.

### Hosting the public landing

The deploy that shares the project sets `LANDING_MODE=1`: `/` renders the landing (what it is, why to trust it, pricing, the onboarding prompt, FAQ) and the app lives at `/app`. The landing stores nothing and needs no database.

**Charging for assisted installs.** The pricing section offers a paid "I install it for you" tier. Set `MP_ACCESS_TOKEN` (Mercado Pago production access token), `PAY_PRICE` and `PAY_CURRENCY` and `/api/pay` creates a Checkout Pro preference per click and redirects to it; Mercado Pago sends people back to `/gracias`. Or set `PAY_URL` to any fixed payment link (Stripe Payment Link, Mercado Pago link, Lemon Squeezy). With neither, the button links to `NEXT_PUBLIC_CONTACT_URL`.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build (includes type check)
npm run typecheck
npm test            # pure unit tests: planner, copy gates, post matching, Bayesian model
npm run setup       # onboarding: validates keys, writes .env.local
npm run push-env    # uploads .env.local to the linked Vercel project
```

## How it's built

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Short version: `lib/video-engine.ts` (perceive) → `lib/agents.ts` (plan) → `lib/copy.ts` (write + verify) → `lib/pipeline.ts` (orchestrate) → `lib/store.ts` (persist) · `lib/metrics-sync.ts` (measure) → `lib/stats.ts` (model). The UI is `app/app`.

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

Motor de clips y tracker de métricas para creadores que suben a YouTube, open source. Apuntalo a tu canal y cada video nuevo se convierte en una semana de clips: los mejores momentos encontrados mirando el video entero, un titular y captions escritos por un modelo y verificados por código, y un calendario desde donde publicar. Después de publicar, trae tus propios números y te dice, con incertidumbre, qué funciona en *tu* cuenta.

Corre en tu cuenta de Vercel, con tus keys. Nada acá está atado a un canal en particular.

**Instalación con un agente.** Abrí Claude Code o Codex en una carpeta vacía y pegá el prompt de arriba. El agente sigue `ONBOARDING.md`: te pide el canal, tu nombre, tus redes y tus keys, valida cada dato con `npm run setup`, crea la base gratis en Neon y deploya en tu Vercel.

**Cómo funciona.** Un cron diario lee el RSS público del canal. Gemini mira el video nuevo por URL y devuelve sólo hechos: tema, tesis, ejes y los 10 mejores tramos de 60-120 s con transcripción verbatim, citas con segundo, gancho, motivo y la curiosidad que responde. Un planificador elige cuáles van a clip y con qué ángulo. OpenAI escribe las piezas del caption a partir de la transcripción, y el código verifica que toda cita exista, que el titular tenga forma de titular y que los hashtags cumplan las reglas; el caption final lo arma el código (claim + tu CTA + hashtags). Vos publicás y marcás dónde. Las métricas se cargan a mano o llegan solas por Apify (TikTok/Instagram) y la YouTube Data API. Un modelo bayesiano (sin LLM) compara palancas con intervalos creíbles y decide con Thompson sampling qué probar en la próxima pieza; sus conclusiones firmes vuelven al prompt del redactor.

**Principios.** Percibir y redactar son modelos distintos a temperaturas distintas. Las reglas que importan viven en código, no en el prompt. Nada automático publica. Salir con menos piezas sin aviso es el peor resultado. Lo que la red no reporta es "no se sabe", nunca cero.
