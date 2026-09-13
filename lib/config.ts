// Configuración por entorno: marca, cuenta y plan de publicación.
//
// Todo lo que identifica a UN podcast vive acá, leído de variables de entorno,
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

/** Cómo se llama y qué es el podcast: entra a los prompts. */
export const PODCAST_NAME = env("PODCAST_NAME", BRAND_NAME);
export const PODCAST_DESCRIPTION = env("PODCAST_DESCRIPTION", "un podcast de entrevistas");
/** Idioma y registro en que se escribe el copy. */
export const CONTENT_LANGUAGE = env("CONTENT_LANGUAGE", "español rioplatense, con voseo natural");

/** Hashtag de la marca (sin #). Si está, se exige en todas las captions. */
export const BRAND_HASHTAG = env("BRAND_HASHTAG").replace(/^#/, "").toLowerCase();
/** CTA fijo que cierra cada caption. */
export const CTA_TEXT = env("CTA_TEXT", "▶️ Episodio completo en YouTube");

export const YOUTUBE_CHANNEL_ID = env("YOUTUBE_CHANNEL_ID");
export const TIKTOK_USERNAME = env("TIKTOK_USERNAME").replace(/^@/, "");
export const INSTAGRAM_USERNAME = env("INSTAGRAM_USERNAME").replace(/^@/, "");

export const PUBLISH_TIME = env("PUBLISH_TIME", "21:00");
export const CLIPS_PER_EPISODE = Number(env("CLIPS_PER_EPISODE", "5"));
export const STRETCH_EXTRA_CLIPS = Number(env("STRETCH_EXTRA_CLIPS", "2"));
/** Al primer escaneo, sólo los episodios de los últimos N días entran solos. */
export const FRESH_DAYS = Number(env("FRESH_DAYS", "14"));
/** Un video más corto que esto no es un episodio: es un corte y se ignora. */
export const EPISODE_MIN_SEC = Number(env("EPISODE_MIN_SEC", "1200"));

/** Lo que la UI puede saber de la configuración. Nunca incluye secretos. */
export function publicConfig() {
  return {
    brandName: BRAND_NAME,
    podcastName: PODCAST_NAME,
    timezone: TIMEZONE,
    youtubeChannelId: YOUTUBE_CHANNEL_ID,
    tiktokUsername: TIKTOK_USERNAME,
    instagramUsername: INSTAGRAM_USERNAME,
    brandHashtag: BRAND_HASHTAG,
    ctaText: CTA_TEXT,
    publishTime: PUBLISH_TIME,
    clipsPerEpisode: CLIPS_PER_EPISODE,
    weeklyPlan: env("WEEKLY_PLAN", "(default)"),
    integrations: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      apify: Boolean(process.env.APIFY_TOKEN),
      youtubeApi: Boolean(process.env.YOUTUBE_API_KEY),
      qstash: Boolean(process.env.QSTASH_TOKEN && process.env.QSTASH_URL),
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
