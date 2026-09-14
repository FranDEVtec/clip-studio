# Security

## Reporting a vulnerability

Open a private security advisory on GitHub (Security → Advisories → "Report a vulnerability") or contact the maintainer linked in `package.json`. Please do not open a public issue for security problems. You will get an acknowledgement within a few days.

## Security model

This is a single-tenant tool: one deployment serves one podcast and its team. There is no multi-user isolation inside a deployment.

**Authentication.** Two mechanisms, both fail-closed:

- Google OAuth 2.0 (authorization code + PKCE). The `id_token` is verified against Google's `tokeninfo` endpoint, the `aud` claim is checked against `GOOGLE_CLIENT_ID`, and the email must be in `ALLOWED_EMAILS`. Sessions are an HMAC-SHA256 signed cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days) signed with `AUTH_SECRET`.
- `ACCESS_CODE` (8+ characters) sent as the `x-access-code` header, compared in constant time. Meant for the single-operator case and for the cron.

If neither is configured, every protected route returns 401 and the login page says so. There are no default credentials.

**Cron.** `/api/cron/scan` accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) or a valid session/code. Set `CRON_SECRET`; the self-invoking chain (`step=write`, `step=metrics`) uses it too.

**Secrets never leave the server.** API keys (Gemini, OpenAI, Apify, YouTube, QStash, Google) are read from environment variables at call time. `publicConfig()` only exposes booleans ("configured or not") and non-secret settings. Nothing under `NEXT_PUBLIC_*` is secret by construction.

**Database.** All queries are parameterised (tagged templates for both the Neon HTTP driver and `pg`). The state is small and fully upserted in one transaction.

**Inputs.** User-supplied YouTube URLs are reduced to an 11-character video id before use. Post URLs are restricted to TikTok, Instagram and YouTube hosts. Free text fields are length-capped.

**Prompt injection.** Video titles and transcripts from third parties are passed to the models as data. The gates that matter (quote verification, hashtag rules, headline shape) are enforced in code after the model answers, not by the prompt.

## What you should do when deploying

- Generate `AUTH_SECRET` and `CRON_SECRET` with `openssl rand -base64 32`.
- Prefer Google login with an explicit `ALLOWED_EMAILS` list over the access code.
- Keep `DATABASE_URL` and all API keys in the platform's encrypted env store, never in the repo.
- Rotate any key you paste into a chat, a screenshot or a ticket.
