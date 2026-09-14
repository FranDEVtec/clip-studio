import { BRAND_NAME, REPO_URL } from "@/lib/config";
import { CopyButton } from "@/components/copy-button";

/** Lo que la persona pega en Claude Code o Codex. Una sola frase, sin pasos: los pasos están en ONBOARDING.md. */
export const ONBOARDING_PROMPT = `Cloná ${REPO_URL} en una carpeta nueva y seguí ONBOARDING.md paso a paso. Es mi copia de Clip Studio: preguntame lo que necesites (mi canal de YouTube, mi nombre, mis redes y mis API keys), validá cada dato con npm run setup, creá la base gratis en Neon y dejalo deployado en mi cuenta de Vercel. No inventes valores ni saltees pasos.`;

const PASOS = [
  { n: "01", t: "Subís el video a YouTube", d: "Como siempre. Un cron diario lee el RSS público del canal y lo detecta solo." },
  { n: "02", t: "Gemini mira el video entero", d: "Y devuelve sólo hechos: los diez mejores tramos de 60 a 120 segundos, con transcripción verbatim y citas con su segundo exacto." },
  { n: "03", t: "Se escribe cada clip, y el código lo verifica", d: "Un planificador elige cinco tramos con ángulos distintos. OpenAI escribe titular y captions. Un programa comprueba que cada cita exista y que el formato se cumpla." },
  { n: "04", t: "Publicás vos, y después miden tus números", d: "Cada día tenés un clip listo: el corte, el titular y los captions para copiar. Cuando publicás, el tracker trae tus métricas y te dice, con incertidumbre, qué funciona en tu cuenta." },
];

const CONFIANZA = [
  { t: "Open source, licencia MIT", d: "Todo el código está en GitHub. Lo podés leer, cambiar y auditar antes de correrlo." },
  { t: "Sin base de datos nuestra", d: "Esta página no guarda nada. Tu copia corre en tu cuenta de Vercel, con tu propia base gratis en Neon. Nada tuyo pasa por acá." },
  { t: "Tus keys, en tu cuenta", d: "Las claves de Gemini, OpenAI y Apify viven en las variables de entorno de tu deploy. Nunca llegan al navegador ni a terceros." },
  { t: "Nada publica solo", d: "El sistema planifica, escribe y mide. Apretar publicar sigue siendo tuyo." },
];

const NECESITAS = [
  { t: "Cuenta de Vercel", d: "gratis; ahí corre tu copia y el cron diario" },
  { t: "Base en Neon", d: "gratis; el agente la crea con un comando" },
  { t: "Key de Gemini", d: "gratis en Google AI Studio; mira los videos" },
  { t: "Key de OpenAI", d: "paga por uso; escribe los captions" },
  { t: "Token de Apify", d: "opcional; trae las métricas de TikTok e Instagram" },
];

export function Landing() {
  return (
    <main className="landing">
      <div className="gate-ember" aria-hidden="true" />
      <div className="gate-grain" aria-hidden="true" />

      <header className="landing-top">
        <div className="brand">
          {BRAND_NAME}<i className="brand-sq" aria-hidden="true" />
        </div>
        <nav className="landing-nav">
          <a href="#instalar">Instalar</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="gate-kicker">
          <span className="gate-square" style={{ width: 8, height: 8 }} aria-hidden="true" />
          <span>para creadores que suben a YouTube</span>
        </div>
        <h1 className="landing-h1">
          Cada video que subís se convierte en una semana de clips.
        </h1>
        <p className="landing-lead">
          Un motor open source que mira tu video entero, encuentra los mejores momentos, escribe titular y captions que el código verifica, y después aprende de tus propios números. Corre en tu cuenta, con tus keys.
        </p>
        <div className="landing-cta">
          <a className="gate-btn" href="#instalar">
            <span className="gate-btn-label">Instalar con Claude Code o Codex</span>
            <span className="gate-btn-arrow" aria-hidden="true">→</span>
          </a>
          <a className="btn ghost landing-ghost" href={REPO_URL} target="_blank" rel="noreferrer">Leer el código</a>
        </div>
      </section>

      <section className="landing-section">
        <div className="sec-kicker"><span>Cómo funciona</span><i aria-hidden="true" /></div>
        <ol className="landing-steps">
          {PASOS.map((p) => (
            <li key={p.n} className="landing-step">
              <span className="gate-n">{p.n}</span>
              <div>
                <div className="landing-step-t">{p.t}</div>
                <div className="landing-step-d">{p.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <div className="sec-kicker"><span>Por qué podés confiar</span><i aria-hidden="true" /></div>
        <div className="landing-grid">
          {CONFIANZA.map((c) => (
            <div key={c.t} className="landing-card">
              <div className="landing-card-t">{c.t}</div>
              <div className="landing-card-d">{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="instalar">
        <div className="sec-kicker"><span>Instalar en 10 minutos</span><i aria-hidden="true" /></div>
        <p className="landing-p">
          Abrí <b>Claude Code</b> o <b>Codex</b> en una carpeta vacía y pegá esto. El agente clona el repo, te pregunta lo que hace falta, valida cada dato contra la API real y deploya tu copia en tu Vercel.
        </p>
        <div className="landing-prompt">
          <div className="landing-prompt-head">
            <span className="platform">Prompt para el agente</span>
            <CopyButton text={ONBOARDING_PROMPT} label="copiar prompt" />
          </div>
          <pre>{ONBOARDING_PROMPT}</pre>
        </div>
        <p className="landing-p dim">
          Te va a pedir: la URL de tu canal, tu nombre, tus handles de TikTok e Instagram y las keys de Gemini y OpenAI. Nada más. Si preferís hacerlo a mano, el <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">README</a> tiene los mismos pasos.
        </p>
        <div className="landing-need">
          {NECESITAS.map((n) => (
            <div key={n.t} className="landing-need-row">
              <span className="landing-need-t">{n.t}</span>
              <span className="landing-need-d">{n.d}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <span>
          Powered by <b>SWAP Labs</b>
        </span>
        <span className="landing-foot-right">
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <span aria-hidden="true"> · </span>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT</a>
          <span aria-hidden="true"> · </span>
          <a href={`${REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">Seguridad</a>
        </span>
      </footer>
    </main>
  );
}
