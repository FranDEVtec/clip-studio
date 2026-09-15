import { BRAND_NAME, CONTACT_URL, REPO_URL } from "@/lib/config";

// Vuelta del checkout. Mercado Pago agrega ?estado=ok|pendiente|fallo (back_urls);
// /api/pay manda ?estado=error si no pudo crear el checkout.
const COPY: Record<string, { t: string; d: string }> = {
  ok: { t: "Pago recibido. Gracias.", d: "Escribime ahora con el mail o el usuario con el que pagaste y coordinamos la llamada. En esa llamada dejamos tu copia andando con tu canal, tus keys y tu guía de estilo." },
  pendiente: { t: "Pago pendiente.", d: "Mercado Pago todavía lo está procesando. Cuando se acredite, escribime y coordinamos la llamada." },
  fallo: { t: "El pago no se completó.", d: "No se cobró nada. Podés volver a intentar desde la landing o escribirme y lo resolvemos por otro medio." },
  error: { t: "No pude abrir el checkout.", d: "El cobro no está configurado en este deploy o Mercado Pago no respondió. Escribime y lo arreglamos por otro medio." },
};

export default async function Gracias({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const c = COPY[estado ?? ""] ?? COPY.ok;
  return (
    <main className="landing">
      <header className="landing-top">
        <a className="brand" href="/">{BRAND_NAME}<i className="brand-sq" aria-hidden="true" /></a>
      </header>
      <section className="landing-hero">
        <h1 className="landing-h1" style={{ maxWidth: "20ch" }}>{c.t}</h1>
        <p className="landing-lead">{c.d}</p>
        <div className="landing-cta">
          <a className="gate-btn" href={CONTACT_URL} target="_blank" rel="noreferrer">
            <span className="gate-btn-label">Escribime</span>
            <span className="gate-btn-arrow" aria-hidden="true">→</span>
          </a>
          <a className="btn ghost landing-ghost" href="/">Volver</a>
        </div>
      </section>
      <footer className="landing-foot">
        <span>Powered by <b>SWAP Labs</b></span>
        <span className="landing-foot-right"><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></span>
      </footer>
    </main>
  );
}
