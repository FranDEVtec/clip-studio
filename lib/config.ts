// Configuración por entorno: marca, cuenta y plan de publicación.
//
// Todo lo que identifica a UN canal vive acá, leído de variables de entorno,
// para que el resto del código no sepa de ninguna marca en particular. Las API
// keys NO pasan por este módulo: cada integración lee la suya de process.env
// en el momento de usarla y nunca se manda al cliente.
//
// Las variables NEXT_PUBLIC_* también las ve el navegador (se inlinean en el
// build): sólo van ahí cosas que no son secretas (nombre, color, zona horaria).

const env = (key: string, fallback = ""): string => (process.env[key] ?? "").trim() || fallback;

export const BRAND_NAME = env("NEXT_PUBLIC_BRAND_NAME", "Clip Studio");
export const BRAND_ACCENT = env("NEXT_PUBLIC_BRAND_ACCENT", "#ff6a00");
export const TIMEZONE = env("NEXT_PUBLIC_TIMEZONE", "America/Argentina/Buenos_Aires");
export const LOCALE = env("NEXT_PUBLIC_LOCALE", "es-AR");

/** Quién habla en los videos: entra a los prompts. */
export const CREATOR_NAME = env("CREATOR_NAME", BRAND_NAME);
/** De qué va el canal, en una línea: entra a los prompts. */
export const CHANNEL_DESCRIPTION = env("CHANNEL_DESCRIPTION", "un canal de YouTube de vlogs y videos hablados");
/** Idioma y registro en que se escribe el copy. */
export const CONTENT_LANGUAGE = env("CONTENT_LANGUAGE", "español rioplatense, con voseo natural");

/** Hashtag de la marca (sin #). Si está, se exige en todas las captions. */
export const BRAND_HASHTAG = env("BRAND_HASHTAG").replace(/^#/, "").toLowerCase();
/** CTA fijo que cierra cada caption. */
export const CTA_TEXT = env("CTA_TEXT", "▶️ Video completo en YouTube");

export const YOUTUBE_CHANNEL_ID = env("YOUTUBE_CHANNEL_ID");
export const TIKTOK_USERNAME = env("TIKTOK_USERNAME").replace(/^@/, "");
export const INSTAGRAM_USERNAME = env("INSTAGRAM_USERNAME").replace(/^@/, "");

export const PUBLISH_TIME = env("PUBLISH_TIME", "21:00");
export const CLIPS_PER_VIDEO = Number(env("CLIPS_PER_VIDEO", "5"));
/** Al primer escaneo, sólo los videos de los últimos N días entran solos. */
export const FRESH_DAYS = Number(env("FRESH_DAYS", "14"));
/** Un video más corto que esto no se clipea: es un Short o un corte, y se ignora. */
export const VIDEO_MIN_SEC = Number(env("VIDEO_MIN_SEC", "300"));

/** ¿Este deploy es la landing pública (la de quien comparte el proyecto) o la app de un creador? */
export const LANDING_MODE = env("LANDING_MODE") === "1";
/** URL del repo, para la landing y los créditos. */
export const REPO_URL = "https://github.com/FranDEVtec/clip-studio";

// ── Cobro (sólo en la landing) ─────────────────────────────────────────────
// La instalación asistida se cobra con Mercado Pago (MP_ACCESS_TOKEN crea una
// preferencia de Checkout Pro en /api/pay) o con cualquier link de pago fijo
// (PAY_URL: Stripe Payment Link, link de pago de Mercado Pago, Lemon Squeezy…).
// Si no hay ninguno, el botón lleva al contacto.
export const PAY_PRICE = Number(env("PAY_PRICE", "0"));
export const PAY_CURRENCY = env("PAY_CURRENCY", "ARS").toUpperCase();
export const PAY_URL = env("PAY_URL");
export const PAY_CONFIGURED = Boolean(PAY_URL) || Boolean(process.env.MP_ACCESS_TOKEN && PAY_PRICE > 0);
/** Adónde escribe la gente después de pagar (o si el pago no está configurado). */
export const CONTACT_URL = env("NEXT_PUBLIC_CONTACT_URL", "https://instagram.com/franbottaroo");

/** Lo que la UI puede saber de la configuración. Nunca incluye secretos. */
export function publicConfig() {
  return {
    brandName: BRAND_NAME,
    creatorName: CREATOR_NAME,
    timezone: TIMEZONE,
    youtubeChannelId: YOUTUBE_CHANNEL_ID,
    tiktokUsername: TIKTOK_USERNAME,
    instagramUsername: INSTAGRAM_USERNAME,
    brandHashtag: BRAND_HASHTAG,
    ctaText: CTA_TEXT,
    publishTime: PUBLISH_TIME,
    clipsPerVideo: CLIPS_PER_VIDEO,
    weeklyPlan: env("WEEKLY_PLAN", "(default)"),
    integrations: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      apify: Boolean(process.env.APIFY_TOKEN),
      youtubeApi: Boolean(process.env.YOUTUBE_API_KEY),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
