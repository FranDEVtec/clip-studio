# Onboarding

Runbook para dejar una copia de Clip Studio funcionando en la cuenta de Vercel de una persona. Está escrito para que lo siga un agente (Claude Code, Codex, Cursor) con la persona al lado, pero sirve igual a mano.

Reglas para el agente:

- **No inventes valores.** Cada dato de abajo lo da la persona. Si falta uno, preguntá y esperá.
- **No imprimas keys.** Ni en el chat ni en logs. El script las enmascara; vos también.
- **No saltees la validación.** `npm run setup` llama a cada API con la key real y frena si algo no responde. Si frena, arreglá el dato, no el script.
- **Nada publica solo.** Cuando termines, la persona entra a la app, ve su calendario y publica ella.

## 0. Qué hace falta tener

| Qué | Dónde se consigue | Costo |
|---|---|---|
| Node 20+ y npm | nodejs.org | — |
| Cuenta de Vercel | vercel.com | gratis |
| Cuenta de GitHub | github.com | gratis (para que Vercel deploye) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | gratis |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | paga por uso |
| `APIFY_TOKEN` (opcional) | https://console.apify.com/account/integrations | plan gratis |
| `YOUTUBE_API_KEY` (opcional) | Google Cloud Console → YouTube Data API v3 | gratis |

## 1. Clonar

```bash
git clone --depth 1 https://github.com/FranDEVtec/clip-studio.git
cd clip-studio
rm -rf .git
npm install
```

Se borra `.git` a propósito: Vercel bloquea los deploys por CLI cuando el autor de los commits no es miembro de la cuenta que deploya, y los commits del repo son de otra persona. Sin `.git`, el deploy no lleva metadata y pasa. Para actualizar más adelante, se vuelve a clonar.

## 2. Preguntar

Pedile a la persona, en este orden:

1. La URL de su canal de YouTube (sirve `youtube.com/@handle`, `/channel/UC…` o la URL de un video suyo).
2. Su nombre, como quiere que aparezca en los prompts.
3. De qué va el canal, en una línea.
4. Sus usuarios de TikTok e Instagram (sin @). Pueden faltar.
5. La key de Gemini y la de OpenAI.
6. Opcionales: token de Apify (métricas de TikTok/Instagram), key de YouTube Data API (métricas de Shorts), hashtag de marca, CTA, hora de publicación, zona horaria, días de la semana con clip.

## 3. Validar y escribir `.env.local`

```bash
npm run setup -- \
  --channel="https://www.youtube.com/@handle" \
  --name="Nombre" \
  --description="un canal de vlogs sobre …" \
  --tiktok="usuario" --instagram="usuario" \
  --gemini="…" --openai="…" \
  --apify="…" --youtube-api="…" \
  --hashtag="mimarca" --cta="▶️ Video completo en YouTube" \
  --publish-time="21:00" --timezone="America/Argentina/Buenos_Aires" --plan="1,2,3,4,5,6" \
  --yes
```

Sin `--yes` y en una terminal, el script pregunta lo que falte. Qué hace:

- Resuelve el id `UC…` del canal, lee el RSS y muestra los últimos videos con su duración, marcando cuáles se clipean (más de 5 minutos por defecto).
- Llama a Gemini, OpenAI, Apify y YouTube con la key real. Si una no responde, frena con el motivo.
- Genera `ACCESS_CODE` (la contraseña de la app) y `CRON_SECRET`, y escribe `.env.local`.

Anotá el `ACCESS_CODE` que imprime: es lo que la persona va a usar para entrar.

## 4. Base de datos y deploy en Vercel

```bash
npx vercel login                      # abre el navegador; lo hace la persona
npx vercel link                       # crea el proyecto (aceptar los defaults)
npx vercel integration add neon       # crea la base gratis y setea DATABASE_URL en Vercel
npm run push-env                      # sube .env.local a producción (DATABASE_URL vacío se saltea)
npx vercel --prod                     # deploy
```

Si `vercel integration add neon` pide elegir plan o región, elegí el gratis y la región más cercana. Si la persona prefiere otro Postgres, poné su `DATABASE_URL` en `.env.local` antes de `push-env`.

Para correr también en local: `npx vercel env pull .env.local` trae el `DATABASE_URL` de Neon y `npm run dev` levanta la app en `http://localhost:3000`.

## 5. Verificar

1. Abrí la URL que devolvió el deploy. Tiene que mostrar la pantalla de acceso; entrá con el `ACCESS_CODE`.
2. En **Videos**, apretá **Escanear canal ahora**. Los videos recientes y largos entran en cola; los Shorts quedan como "no analizado".
3. Esperá el análisis (2-4 minutos por video). En **Semana** tienen que aparecer los clips reservados y, al rato, escritos.
4. Abrí uno: corte con link al segundo exacto en YouTube, titular, caption de TikTok y de Instagram, transcripción.
5. En **Ajustes**, revisá que Gemini, OpenAI, canal y cron figuren como configurados.

El cron diario ya está en `vercel.json` (13:00 UTC). Vercel lo activa solo en el deploy de producción.

## 6. Qué decirle a la persona al terminar

- La URL de su app y su código de acceso.
- Que cada día tiene un clip listo en **Hoy**: corta el video en el tramo indicado, pone el titular en pantalla, copia el caption y publica.
- Que después de publicar marque la red en la pieza; si tiene Apify, las métricas llegan solas con el sync diario.
- Que la guía de estilo en **Ajustes** es suya: ahí va su voz.
