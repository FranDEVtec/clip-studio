# Contributing

Thanks for looking at this. The project is small on purpose: a clip engine and a metrics tracker, nothing else. Pull requests that keep it that way are welcome.

## Ground rules

- **Rules that matter live in code, not in prompts.** If you want the model to always do X, add a check in `lib/copy.ts` (`findProblems`) or the equivalent gate, and a test. Every rule that only lived in a system prompt eventually got ignored.
- **Nothing automatic publishes.** The app plans, writes and measures. Publishing is a human action.
- **Quotes are verified.** Never weaken `quoteIsReal`.
- **No brand in the code.** Names, colours, handles, hashtags and CTAs come from `lib/config.ts` (environment) or from Settings in the UI.
- **No secrets in the repo.** Not in code, not in docs, not in fixtures. `.env*` is git-ignored except `.env.example`.

## Dev loop

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and ACCESS_CODE at least
npm run dev                  # http://localhost:3000
npm run typecheck
npm test                     # pure unit tests, no network
npm run setup                # onboarding script (validates keys against the real APIs)
npm run build
```

For a local Postgres: `docker run -d -e POSTGRES_PASSWORD=studio -e POSTGRES_DB=studio -p 5432:5432 postgres:16-alpine` and `DATABASE_URL=postgres://postgres:studio@localhost:5432/studio`.

## Where things are

See `docs/ARCHITECTURE.md`.

## Tests

Tests are plain TypeScript files run with `tsx` (`lib/*.test.ts`). They cover the pure parts: planner gates, copy gates, post matching, the Bayesian model. Anything that touches Gemini, OpenAI, Apify or the database is verified by running the app.

## Style

Spanish (rioplatense) in UI strings, prompts and comments, to match the product's first users. The UI vocabulary is *video* and *clip*, never *episode* or *guest*: this is for solo creators. English is fine in docs and commit messages. Keep comments about *why*, not *what*.
