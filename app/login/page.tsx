"use client";

import { useEffect, useState } from "react";

const CODE_KEY = "studio-access-code";
const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Clip Studio";
const TZ = process.env.NEXT_PUBLIC_TIMEZONE || "America/Argentina/Buenos_Aires";
const LOCALE = process.env.NEXT_PUBLIC_LOCALE || "es-AR";

const STEPS = [
  { n: "01", t: "El video entra al canal", d: "el sistema lo detecta y busca los mejores momentos." },
  { n: "02", t: "El redactor escribe cada clip", d: "corte, titular y captions, con tu guía de estilo." },
  { n: "03", t: "Todos los días, una pieza lista", d: "copiás el caption y publicás." },
  { n: "04", t: "Después, los números", d: "métricas propias y un modelo que aprende de ellas." },
];

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const [me, setMe] = useState<{ session: unknown; googleConfigured: boolean; authConfigured: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("error");
    if (q) setError(q);
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((m) => {
        if (m.session) window.location.href = "/app";
        else setMe(m);
      })
      .catch(() => setMe({ session: null, googleConfigured: false, authConfigured: false }));
    const tick = () =>
      setNow(
        new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false })
          .format(new Date())
          .replace(",", " ·"),
      );
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  async function enterWithCode() {
    const c = code.trim();
    if (!c) return;
    const res = await fetch("/api/calendar", { headers: { "x-access-code": c } });
    if (res.status === 401) {
      setError("Código incorrecto");
      return;
    }
    localStorage.setItem(CODE_KEY, c);
    window.location.href = "/app";
  }

  const loading = me === null;
  const codeMode = me?.googleConfigured === false;
  const locked = me !== null && !me.authConfigured;

  return (
    <main className="gate-page">
      <div className="gate-ember" aria-hidden="true" />
      <div className="gate-grain" aria-hidden="true" />
      <div className="gate-grid">
        <section className="gate-left">
          <div className="gate-kicker rise">
            <span className="gate-square" style={{ width: 8, height: 8 }} aria-hidden="true" />
            <span>
              <span className="gate-kicker-long">motor de clips y tracker de métricas</span>
              <span className="gate-kicker-short">clips + métricas</span>
            </span>
          </div>
          <div className="gate-lockup rise" style={{ animationDelay: ".06s" }}>
            <h1 className="gate-wordmark" style={{ margin: 0 }}>
              {BRAND}<span className="gate-square" aria-hidden="true" />
            </h1>
          </div>
          <p className="gate-lead rise" style={{ animationDelay: ".12s" }}>
            Del video publicado a la pieza lista, sin pasos a mano.
          </p>
          <ol className="gate-steps rise" style={{ animationDelay: ".18s" }}>
            {STEPS.map((s) => (
              <li key={s.n} className="gate-step">
                <span className="gate-n">{s.n}</span>
                <span>
                  <span className="gate-t">{s.t}</span>
                  <span className="gate-d"> — {s.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="gate-foot rise" style={{ animationDelay: ".24s" }}>
            <span>{now || " "}</span>
            <span className="gate-foot-right">
              <span className="gate-square" aria-hidden="true" />
              {TZ}
            </span>
          </div>
        </section>

        <section className="gate-right">
          <div className="gate-card rise" style={{ animationDelay: ".1s" }}>
            <div className="gate-card-kicker">
              <span className="gate-square" aria-hidden="true" />
              <span>Acceso</span>
            </div>

            {loading ? (
              <div style={{ marginTop: 20 }}>
                <div className="gate-skel" style={{ width: 172, height: 20 }} />
                <div className="gate-skel" style={{ width: 264, height: 12, marginTop: 10 }} />
                <div className="gate-skel" style={{ width: "100%", height: 56, marginTop: 24, borderRadius: 12 }} />
              </div>
            ) : locked ? (
              <>
                <h2 className="gate-card-title">Acceso sin configurar</h2>
                <p className="gate-card-sub">
                  Definí <code>ACCESS_CODE</code> (8+ caracteres) o el login con Google (<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>AUTH_SECRET</code>, <code>ALLOWED_EMAILS</code>) en las variables de entorno. Hasta entonces nadie entra.
                </p>
              </>
            ) : (
              <>
                <h2 className="gate-card-title">{codeMode ? "Acceso con código" : "Acceso al estudio"}</h2>
                <p className="gate-card-sub">{codeMode ? "Entrá con el código de acceso del deploy." : "Sólo las cuentas habilitadas."}</p>

                {error && (
                  <div className="gate-error" role="alert">
                    <div className="gate-error-head">⚠ No pudimos validar el acceso</div>
                    <div className="gate-error-body">{decodeURIComponent(error)}. Probá de nuevo.</div>
                  </div>
                )}

                {codeMode ? (
                  <>
                    <label htmlFor="code" className="gate-code-label">CÓDIGO DE ACCESO</label>
                    <input id="code" className="gate-code-input" type="password" placeholder="••••••••" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enterWithCode()} autoFocus />
                    <button className="gate-btn center" onClick={enterWithCode}>
                      <span className="gate-btn-label">Entrar</span>
                      <span className="gate-btn-arrow" aria-hidden="true">→</span>
                    </button>
                  </>
                ) : (
                  <a className="gate-btn" href="/api/auth/google">
                    <GoogleIcon />
                    <span className="gate-btn-label">Entrar con Google</span>
                    <span className="gate-btn-arrow" aria-hidden="true">→</span>
                  </a>
                )}

                <div className="gate-card-foot">
                  <div className="gate-index">Hoy · Semana · Videos · Publicaciones · Métricas</div>
                  <p className="gate-legal">Sesión de 30 días. Cerrás sesión desde el menú.</p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
