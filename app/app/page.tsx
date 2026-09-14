"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Video, Item, State } from "@/lib/store";
import type { PublicConfig } from "@/lib/config";
import { Act, addDays, BRAND, CODE_KEY, DAY_NAMES, VideoRow, fmtDateTime, fmtDay, fmtTime, isoDow, ItemDetail, LOCALE, StatsSection, todayLocal, weekStart } from "./parts";

type Tab = "hoy" | "semana" | "videos" | "publicaciones" | "metricas" | "ajustes";
type Me = { session: { email: string; name?: string; picture?: string } | null; googleConfigured: boolean; authConfigured: boolean };
type FullState = State & {
  config?: PublicConfig;
  defaultStyleGuide?: string;
  metricsSources?: { apify: boolean; youtube: boolean; tiktok: boolean; instagram: boolean };
  modelo?: {
    palancas: { id: string; nombre: string; pregunta: string; evidencia: string; conclusion: string; faltan?: string; brazos: { valor: string; piezas: number; vistas: number; exitos: number; pMejor: number; post: { media: number; lo: number; hi: number } }[] }[];
    decisiones: { palanca: string; elegido: string; motivo: string; explorando: boolean }[];
    conocimiento: {
      observaciones: number; piezasPublicadas: number; vistasTotales: number; conRetencion: number;
      sabemos: string[]; faltan: string[];
      veredicto: string; porQue: string;
      tareas: { texto: string; detalle: string }[];
      meta: { hechas: number; total: number };
    };
  };
};

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "hoy", label: "Hoy", short: "Hoy" },
  { id: "semana", label: "Semana", short: "Semana" },
  { id: "videos", label: "Videos", short: "Videos" },
  { id: "publicaciones", label: "Publicaciones", short: "Posts" },
  { id: "metricas", label: "Métricas", short: "Datos" },
  { id: "ajustes", label: "Ajustes", short: "Ajustes" },
];

export default function CalendarioPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [code, setCode] = useState("");
  const [state, setState] = useState<FullState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("hoy");
  const [monday, setMonday] = useState(() => weekStart(todayLocal()));
  const [open, setOpen] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [saleEl, setSaleEl] = useState("");

  // Sesión: Google (cookie) o el código de acceso guardado (respaldo).
  useEffect(() => {
    const saved = localStorage.getItem(CODE_KEY);
    if (saved) setCode(saved);
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((m: Me) => setMe(m))
      .catch(() => setMe({ session: null, googleConfigured: false, authConfigured: false }));
    const h = window.location.hash.replace("#", "") as Tab;
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);

  const authed = Boolean(me?.session) || Boolean(code);
  const headers = useCallback((): Record<string, string> => (code ? { "x-access-code": code } : {}), [code]);

  const load = useCallback(async () => {
    const res = await fetch("/api/calendar", { headers: headers() });
    if (res.status === 401) {
      localStorage.removeItem(CODE_KEY);
      setCode("");
      if (!me?.session) window.location.href = "/login";
      return;
    }
    setState((await res.json()) as FullState);
  }, [headers, me]);

  useEffect(() => {
    if (me && authed) load().catch((e) => setError(String(e)));
    if (me && !authed) window.location.href = "/login";
  }, [me, authed, load]);

  // El cron corre UNA vez por día: si el último escaneo está viejo, se dispara
  // solo al abrir la app (leer el RSS es gratis).
  const scannedRef = useRef(false);
  useEffect(() => {
    if (!state || scannedRef.current || !state.config?.youtubeChannelId) return;
    const last = state.lastScanAt ? new Date(state.lastScanAt).getTime() : 0;
    if (Date.now() - last < 6 * 3600_000) return;
    scannedRef.current = true;
    fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify({ action: "scan" }) })
      .then(() => load())
      .catch(() => {});
  }, [state, headers, load]);

  const drafting = state?.items.some((i) => i.status === "drafting") ?? false;
  useEffect(() => {
    if (!authed || !drafting) return;
    const t = setInterval(() => load().catch(() => {}), 12_000);
    return () => clearInterval(t);
  }, [authed, drafting, load]);

  const act: Act = async (body, label) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        if (data.items) setState(data as FullState);
      } else setState(data as FullState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(null);
    }
  };

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  const videosById = useMemo(() => {
    const m = new Map<string, Video>();
    state?.videos.forEach((e) => m.set(e.videoId, e));
    return m;
  }, [state]);

  const today = todayLocal();
  const todays = (state?.items ?? []).filter((i) => i.date === today);
  const next = (state?.items ?? []).filter((i) => i.date > today && i.status !== "published").sort((a, b) => a.date.localeCompare(b.date))[0];
  const openItem = open ? state?.items.find((i) => i.id === open) : undefined;

  function go(t: Tab) {
    setTab(t);
    setOpen(null);
    window.location.hash = t;
  }

  if (!me || (authed && !state)) {
    return (
      <main className="app">
        <div className="loading">Cargando {BRAND}…</div>
      </main>
    );
  }
  if (!authed) return null; // redirige a /login

  const s = state!;
  const detail = openItem && (
    <ItemDetail item={openItem} video={videosById.get(openItem.videoId)} busy={busy} copied={copied} onCopy={copy} onAct={act} onClose={() => setOpen(null)} />
  );

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          {BRAND}<i className="brand-sq" aria-hidden="true" />
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "tab-on" : ""}`} onClick={() => go(t.id)}>
              {t.label}
              {t.id === "hoy" && todays.some((i) => i.status !== "published") && <i className="dot" />}
            </button>
          ))}
        </nav>
        <div className="user">
          {me.session ? (
            <form method="post" action="/api/auth/logout">
              <span className="user-name" title={me.session.email}>{me.session.email.split("@")[0]}</span>
              <span aria-hidden="true"> · </span>
              <button className="link-btn">salir</button>
            </form>
          ) : null}
        </div>
      </header>

      {error && <div className="error-box">⚠ {error}</div>}
      {s.config && <SetupNotice config={s.config} />}

      {/* ───────── HOY ───────── */}
      {tab === "hoy" && (
        <section className="view">
          {(() => {
            const pending = todays.filter((i) => i.status !== "published").length;
            return (
              <div className="view-head hoy-head">
                <div>
                  <h1>
                    {DAY_NAMES[isoDow(today) - 1]} {fmtDay(today)}
                  </h1>
                  <p className="hoy-sub">
                    {todays.length === 0 ? (
                      next ? (
                        <>Hoy no se publica. Próxima pieza: <b>{DAY_NAMES[isoDow(next.date) - 1]} {fmtDay(next.date)}</b>.</>
                      ) : (
                        <>No hay piezas agendadas. Escaneá el canal o analizá un video en Videos.</>
                      )
                    ) : pending === 0 ? (
                      <>Hoy está <b>cerrado</b>: {todays.length} de {todays.length} publicadas.</>
                    ) : (
                      <>Falta <b>{pending} pieza{pending > 1 ? "s" : ""}</b> para cerrar hoy. Ventana {s.config?.publishTime ?? "21:00"} hs.</>
                    )}
                  </p>
                </div>
                <div className="hoy-agents">
                  <i aria-hidden="true" className={drafting ? "live" : ""} />
                  {drafting ? "Redactando…" : "Redactor en espera"}
                </div>
              </div>
            );
          })()}

          <WeekStrip state={s} today={today} />

          <Kicker>Hoy en el calendario</Kicker>
          {todays.length === 0 && <div className="hoy-empty">Nada agendado para hoy.</div>}
          {todays.map((it) => (
            <TodayCard key={it.id} item={it} video={videosById.get(it.videoId)} busy={busy} onAct={act} onOpen={() => setOpen(open === it.id ? null : it.id)} />
          ))}

          {detail}

          <UpcomingList state={s} today={today} onOpen={(id) => { setTab("semana"); setOpen(id); window.location.hash = "semana"; }} />
        </section>
      )}

      {/* ───────── SEMANA ───────── */}
      {tab === "semana" && (
        <section className="view">
          <div className="week-nav">
            <button className="btn ghost" onClick={() => setMonday(addDays(monday, -7))}>‹ anterior</button>
            <div className="week-title">
              Semana del {fmtDay(monday)} al {fmtDay(addDays(monday, 6))}
              {monday !== weekStart(today) && <button className="link-btn" onClick={() => setMonday(weekStart(today))}>hoy</button>}
            </div>
            <button className="btn ghost" onClick={() => setMonday(addDays(monday, 7))}>siguiente ›</button>
          </div>

          <div className="week">
            {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((date, i) => {
              const items = s.items.filter((it) => it.date === date);
              return (
                <div key={date} className={`day ${date === today ? "day-today" : ""} ${date < today ? "day-past" : ""}`}>
                  <div className="day-head">
                    <span className="day-name">{DAY_NAMES[i]}</span>
                    <span className="day-date">{fmtDay(date)}</span>
                  </div>
                  {items.length === 0 && <div className="day-empty">—</div>}
                  {items.map((it) => {
                    const ep = videosById.get(it.videoId);
                    const title = it.status === "drafting" ? "Redactando…" : it.clip?.tituloInterno ?? "";
                    return (
                      <button key={it.id} className={`chip chip-clip ${it.status === "published" ? "chip-done" : ""} ${open === it.id ? "chip-open" : ""}`} onClick={() => setOpen(open === it.id ? null : it.id)}>
                        <span className="chip-kind">CLIP · {it.time}</span>
                        <span className="chip-title">{title}</span>
                        <span className="chip-video">{ep?.title ?? ""}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {detail}
        </section>
      )}

      {/* ───────── VIDEOS ───────── */}
      {tab === "videos" && (
        <section className="view">
          <div className="view-head">
            <h1>Videos</h1>
            <div className="dim">
              {s.lastScanAt ? `Último escaneo del canal: ${fmtDateTime(s.lastScanAt)}` : "Todavía no se escaneó el canal"}
              {" · el cron mira el canal todos los días."}
            </div>
          </div>
          <div className="toolbar">
            <button className="btn primary" disabled={!!busy || !s.config?.youtubeChannelId} title={s.config?.youtubeChannelId ? "" : "Configurá YOUTUBE_CHANNEL_ID"} onClick={() => act({ action: "scan" }, "scan")}>
              {busy === "scan" ? "Escaneando…" : "Escanear canal ahora"}
            </button>
            <div className="toolbar-add">
              <input type="text" placeholder="URL de YouTube para analizar un video a mano" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
              <input type="date" value={saleEl} onChange={(e) => setSaleEl(e.target.value)} aria-label="Fecha en que sale el video" title="Sale el… (para un video no listado que se publica más adelante). Vacío = hoy." />
              <button
                className="btn primary"
                disabled={!!busy || !urlInput.trim()}
                onClick={() =>
                  act({ action: "addVideo", url: urlInput.trim(), saleEl: saleEl || undefined }, "add").then(() => {
                    setUrlInput("");
                    setSaleEl("");
                  })
                }
              >
                {busy === "add" ? "Analizando… (2-4 min)" : "Analizar"}
              </button>
            </div>
          </div>
          <div className="video-list">
            {s.videos.length === 0 && <div className="hoy-empty">Todavía no hay videos. Pegá una URL de YouTube o escaneá el canal.</div>}
            {[...s.videos]
              .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
              .map((ep) => (
                <VideoRow key={ep.videoId} ep={ep} busy={busy} onAct={act} state={s} />
              ))}
          </div>
          {detail}
        </section>
      )}

      {/* ───────── PUBLICACIONES ───────── */}
      {tab === "publicaciones" && <Publicaciones state={s} />}

      {/* ───────── MÉTRICAS ───────── */}
      {tab === "metricas" && (
        <section className="view">
          <div className="view-head">
            <h1>Métricas</h1>
          </div>

          {s.modelo && <Veredicto k={s.modelo.conocimiento} />}
          <Retencion state={s} busy={busy} onAct={act} />
          {s.modelo && <ModeloSection modelo={s.modelo} />}
          <StatsSection state={s} defaultOpen />

          <div className="sec-kicker"><span>De dónde salen estos números</span><i /></div>
          <p className="fuente-nota">
            El sync lee los perfiles de TikTok e Instagram con Apify, empareja cada post con su pieza del calendario y carga
            las métricas solo, todos los días después del escaneo. Instagram no expone guardados ni compartidos: esos dos se
            cargan a mano en el detalle de la pieza. YouTube se lee con la Data API si hay clave.
          </p>
          <div className="toolbar">
            <button className="btn ghost" disabled={!!busy} onClick={() => act({ action: "syncMetrics" }, "sync")}>
              {busy === "sync" ? "Sincronizando… (1-3 min)" : "Sincronizar ahora"}
            </button>
            <div className="toolbar-status">
              {s.lastMetricsSyncAt ? `Último sync: ${fmtDateTime(s.lastMetricsSyncAt)}` : "Todavía no se sincronizó"}
              {s.metricsSources && !s.metricsSources.apify && " · falta APIFY_TOKEN"}
            </div>
          </div>
          {s.metricsSync && (
            <div className="sync-sources">
              {(["tiktok", "instagram"] as const).map((n) => {
                const d = s.metricsSync![n];
                if (!d) return null;
                const flojo = d.leidos > 0 && d.emparejados < Math.min(3, d.leidos);
                return (
                  <div key={n} className={`sync-source ${d.error ? "bad" : flojo ? "warn" : "ok"}`}>
                    <span className="ss-net">{n === "tiktok" ? "TikTok" : "Instagram"}</span>
                    {d.error ? (
                      <span className="ss-detail">falló: {d.error}</span>
                    ) : (
                      <span className="ss-detail">
                        <b>{d.emparejados}</b> de {d.leidos} posts emparejados con una pieza del calendario
                        {d.ultimoPost && ` · último post de la cuenta: ${new Date(d.ultimoPost).toLocaleDateString(LOCALE)}`}
                      </span>
                    )}
                    {flojo && !d.error && (
                      <span className="ss-hint">
                        {d.emparejados === 0 ? "No encontró ninguna pieza del calendario." : "Está midiendo muy pocos de los posts que leyó."} Suele
                        pasar cuando el caption se editó al publicar: pegá la URL del post en Seguimiento y queda emparejado.
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ───────── AJUSTES ───────── */}
      {tab === "ajustes" && <Ajustes state={s} me={me} busy={busy} onAct={act} />}

      <nav className="bottombar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "tab-on" : ""}`} onClick={() => go(t.id)}>
            {t.short}
          </button>
        ))}
      </nav>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="sec-kicker">
      <span>{children}</span>
      <i aria-hidden="true" />
    </div>
  );
}

/** Lo que falta configurar para que el motor ande. Desaparece cuando está todo. */
function SetupNotice({ config }: { config: PublicConfig }) {
  const faltan: string[] = [];
  if (!config.integrations.gemini) faltan.push("GEMINI_API_KEY (buscar clips en el video)");
  if (!config.integrations.openai) faltan.push("OPENAI_API_KEY (redactar captions)");
  if (!config.youtubeChannelId) faltan.push("YOUTUBE_CHANNEL_ID (escaneo automático del canal)");
  if (!faltan.length) return null;
  return (
    <div className="notice">
      Falta configurar: {faltan.join(" · ")}. Ver <b>Ajustes</b> y el README.
    </div>
  );
}

function TodayCard({ item: it, video: ep, busy, onAct, onOpen }: { item: Item; video?: Video; busy: string | null; onAct: Act; onOpen: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const title = it.clip?.tituloInterno ?? "";
  const thumb = ep ? `https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg` : undefined;
  const networks: { id: "tiktok" | "instagram" | "youtube"; label: string }[] = [
    { id: "tiktok", label: "TikTok" },
    { id: "instagram", label: "Instagram" },
    { id: "youtube", label: "YouTube" },
  ];
  const on = new Set(it.publishedOn ?? []);
  const head = `CLIP · ${it.time}`;

  if (it.status === "drafting") {
    return (
      <div className="today-card drafting-card">
        <div className="today-thumb ph small" aria-hidden="true" />
        <div className="today-main">
          <div className="today-head">
            <span className="chip-kind">{head}</span>
            <span className="status drafting"><i className="pulse" aria-hidden="true" />Redactando</span>
          </div>
          <div className="skel" style={{ width: "62%", marginTop: 14 }} />
          <div className="skel" style={{ width: "38%", marginTop: 8 }} />
          <div className="dim tiny" style={{ marginTop: 14 }}>El redactor está escribiendo. Se actualiza sola.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`today-card ${it.status === "published" ? "today-done" : ""}`}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="today-thumb clip" src={thumb} alt="" />
      ) : (
        <div className="today-thumb ph" aria-hidden="true" />
      )}
      <div className="today-main">
        <div className="today-head">
          <span className="chip-kind">{head}</span>
          <span className={`status ${it.status}`}>{it.status === "published" ? "Publicado ✓" : "Pendiente"}</span>
        </div>
        <h2 className="today-title" onClick={onOpen}>{title}</h2>
        {it.clip && (
          <div className="today-meta">
            Corte {fmtTime(it.clip.inicio)} → {fmtTime(it.clip.fin)} ({Math.round(it.clip.fin - it.clip.inicio)} s)
            {ep && (
              <>
                {" · "}
                <a href={`${ep.url}&t=${Math.floor(it.clip.inicio)}s`} target="_blank" rel="noreferrer">ver en YouTube ↗</a>
              </>
            )}
          </div>
        )}
        <div className="net-check">
          {networks.map((n) => (
            <button
              key={n.id}
              className={`net-pill ${on.has(n.id) ? "on" : ""}`}
              disabled={!!busy}
              onClick={() => onAct({ action: "publishedOn", itemId: it.id, network: n.id, on: !on.has(n.id) }, "pon")}
              title={on.has(n.id) ? "Publicado — click para desmarcar" : "Marcar como publicado en esta red"}
            >
              {on.has(n.id) ? "✓ " : ""}{n.label}
            </button>
          ))}
        </div>
        <div className="today-actions">
          <button className={`btn ${it.status === "published" ? "ghost" : "primary"}`} disabled={!!busy} onClick={() => onAct({ action: it.status === "published" ? "unpublish" : "publish", itemId: it.id }, "pub")}>
            {it.status === "published" ? "Desmarcar" : <>Marcar publicado <span aria-hidden="true">✓</span></>}
          </button>
          <div className="today-links">
            {it.clip && (
              <>
                <button className={`mono-link ${copied === "cap" ? "ok" : ""}`} onClick={() => copy(it.clip!.captionTikTok ?? it.clip!.caption, "cap")}>{copied === "cap" ? "copiado ✓" : "Caption TT"}</button>
                <button className={`mono-link ${copied === "capig" ? "ok" : ""}`} onClick={() => copy(it.clip!.caption, "capig")}>{copied === "capig" ? "copiado ✓" : "Caption IG"}</button>
                {it.clip.pieces.hook_edicion && (
                  <button className={`mono-link ${copied === "hked" ? "ok" : ""}`} onClick={() => copy(it.clip!.pieces.hook_edicion, "hked")}>{copied === "hked" ? "copiado ✓" : "Titular"}</button>
                )}
              </>
            )}
            <button className="mono-link" onClick={onOpen}>Ver todo</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekStrip({ state, today }: { state: State; today: string }) {
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const week = state.items.filter((i) => i.date >= monday && i.date <= sunday).sort((a, b) => a.date.localeCompare(b.date));
  const done = week.filter((i) => i.status === "published").length;
  const drafting = state.items.filter((i) => i.status === "drafting").length;
  return (
    <div className="strip">
      <div className="strip-cell">
        <span className="strip-label">Semana</span>
        <span className="strip-cells" aria-hidden="true">
          {week.map((i) => (
            <i key={i.id} className={i.status === "published" ? "done" : i.date === today ? "today" : ""} title={`${i.date} · ${i.kind}`} />
          ))}
        </span>
        <span className="strip-val"><b>{done}</b> de {week.length} publicadas</span>
      </div>
      <div className="strip-cell">
        <span className="strip-label">En redacción</span>
        <span className="strip-val">{drafting > 0 ? <><b>{drafting}</b> pieza{drafting > 1 ? "s" : ""}</> : <><b>—</b> nada en cola</>}</span>
      </div>
      <div className="strip-cell">
        <span className="strip-label">Canal</span>
        <span className="strip-val">{state.lastScanAt ? <><b>escaneado {fmtDay(state.lastScanAt.slice(0, 10))}</b> · se mira todos los días</> : <><b>—</b> sin escanear todavía</>}</span>
      </div>
    </div>
  );
}

/**
 * Todo lo que está publicado en las cuentas, empareje o no con el calendario.
 * El calendario dice qué se PLANIFICÓ; esto dice qué está ARRIBA, y es de
 * donde el modelo saca sus observaciones.
 */
function Publicaciones({ state }: { state: FullState }) {
  const [red, setRed] = useState<"todas" | "tiktok" | "instagram">("todas");
  const [soloSueltas, setSoloSueltas] = useState(false);
  const [orden, setOrden] = useState<"fecha" | "views" | "saveRate">("fecha");

  const todos = state.posts ?? [];
  const items = useMemo(() => new Map(state.items.map((i) => [i.id, i])), [state.items]);
  // Lo que la red no reporta se muestra como "—", nunca como 0.
  const sr = (p: (typeof todos)[number]) => (p.metrics.views && p.metrics.saves !== undefined ? p.metrics.saves / p.metrics.views : undefined);
  const n = (x?: number) => (x === undefined ? "—" : x.toLocaleString(LOCALE));

  const curva = (p: (typeof todos)[number]) => {
    const dias = Object.keys(p.history ?? {}).sort();
    if (dias.length < 2) return null;
    const ini = p.history![dias[0]]?.views;
    const fin = p.history![dias[dias.length - 1]]?.views;
    if (!ini || !fin) return null;
    const t = Math.round((new Date(dias[dias.length - 1]).getTime() - new Date(dias[0]).getTime()) / 86400000);
    return { pct: (fin - ini) / ini, dias: Math.max(t, 1), vivo: fin > ini };
  };

  const lista = todos
    .filter((p) => (red === "todas" ? true : p.network === red))
    .filter((p) => (soloSueltas ? !p.itemId : true))
    .slice()
    .sort((a, b) => (orden === "fecha" ? b.publishedAt.localeCompare(a.publishedAt) : orden === "views" ? (b.metrics.views ?? 0) - (a.metrics.views ?? 0) : (sr(b) ?? -1) - (sr(a) ?? -1)));

  const vistas = lista.reduce((t, p) => t + (p.metrics.views ?? 0), 0);
  const conSaves = lista.filter((p) => p.metrics.saves !== undefined && p.metrics.views);
  const creciendo = todos.filter((p) => curva(p)?.vivo).length;
  const srMediano = (() => {
    const xs = conSaves.map((p) => sr(p)!).sort((a, b) => a - b);
    if (!xs.length) return undefined;
    return xs[Math.floor(xs.length / 2)];
  })();

  return (
    <section className="view">
      <div className="view-head">
        <h1>Publicaciones</h1>
        <div className="dim">Todo lo que está arriba en TikTok e Instagram, empareje o no con una pieza del calendario. Queda guardado aunque después caiga del feed.</div>
      </div>

      {todos.length === 0 ? (
        <p className="hoy-empty">
          Todavía no se guardó ninguna. Corré <b>Sincronizar</b> en Métricas: el sync lee los últimos 30 posts de cada cuenta y a partir de ahora los conserva.
        </p>
      ) : (
        <>
          <div className="modelo-head">
            <div className="mk"><b>{todos.length}</b><span>publicaciones</span></div>
            <div className="mk"><b>{vistas.toLocaleString(LOCALE)}</b><span>vistas sumadas</span></div>
            <div className="mk"><b>{srMediano === undefined ? "—" : pc(srMediano)}</b><span>save rate mediano</span></div>
            <div className="mk"><b>{creciendo}</b><span>todavía creciendo</span></div>
          </div>

          <div className="pub-filtros">
            <div className="net-check">
              {(["todas", "tiktok", "instagram"] as const).map((r) => (
                <button key={r} className={`net-pill ${red === r ? "on" : ""}`} onClick={() => setRed(r)}>
                  {r === "todas" ? "Todas" : r === "tiktok" ? "TikTok" : "Instagram"}
                </button>
              ))}
              <button className={`net-pill ${soloSueltas ? "on" : ""}`} onClick={() => setSoloSueltas(!soloSueltas)}>Sólo sueltas</button>
            </div>
            <div className="net-check">
              <span className="t-label dim">Ordenar por</span>
              {(["fecha", "views", "saveRate"] as const).map((o) => (
                <button key={o} className={`net-pill ${orden === o ? "on" : ""}`} onClick={() => setOrden(o)}>
                  {o === "fecha" ? "Fecha" : o === "views" ? "Views" : "Save rate"}
                </button>
              ))}
            </div>
          </div>

          <div className="table-scroll">
            <table className="stats-table pub-tabla">
              <thead>
                <tr>
                  <th scope="col">Publicación</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Red</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className="num">Views</th>
                  <th scope="col" className="num">Saves</th>
                  <th scope="col" className="num">Save rate</th>
                  <th scope="col" className="num">Comentarios</th>
                  <th scope="col" className="num">Crecimiento</th>
                  <th scope="col">Pieza</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const it = p.itemId ? items.get(p.itemId) : undefined;
                  const r = sr(p);
                  const c = curva(p);
                  return (
                    <tr key={`${p.network}:${p.id}`}>
                      <th scope="row" className="pub-text">
                        <a href={p.url} target="_blank" rel="noreferrer">{p.text ? p.text.replace(/\s+/g, " ").slice(0, 78) : "(sin texto)"}</a>
                      </th>
                      <td className="num">{p.publishedAt.slice(0, 10)}</td>
                      <td>{p.network === "tiktok" ? "TikTok" : "Instagram"}</td>
                      <td>{p.kind === "clip" ? "Video" : "Carrusel"}</td>
                      <td className="num">{n(p.metrics.views)}</td>
                      <td className="num">{n(p.metrics.saves)}</td>
                      <td className="num">{r === undefined ? "—" : pc(r)}</td>
                      <td className="num">{n(p.metrics.comments)}</td>
                      <td className="num pub-curva">
                        {!c ? (
                          <span className="faint">1ª medición</span>
                        ) : (
                          <span className={c.vivo ? "vivo" : ""}>
                            {c.pct > 0 ? "+" : ""}
                            {(c.pct * 100).toFixed(0)} % <span className="faint">· {c.dias} d</span>
                          </span>
                        )}
                      </td>
                      <td className="pub-pieza">{it ? <span title={it.clip?.tituloInterno ?? ""}>{it.date} · clip</span> : <span className="faint">suelta</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pal-note">
            El sync guarda un snapshot de cada publicación por día, así que la columna de crecimiento se arma sola. Una publicación “suelta” no está mal: el sistema no la pudo ligar a nada del calendario, y aun así cuenta para el modelo en red, formato, día, hora, duración, audio y hashtags.
          </div>
        </>
      )}
    </section>
  );
}

/** Carga en tanda de la retención: lo único que el modelo pide y nadie puede automatizar. */
function Retencion({ state, busy, onAct }: { state: FullState; busy: string | null; onAct: Act }) {
  const [vals, setVals] = useState<Record<string, { h: string; c: string }>>({});
  const pendientes = state.items
    .flatMap((i) =>
      (["tiktok", "instagram"] as const)
        .filter((n) => (i.metrics?.[n]?.views ?? 0) > 0 && i.metrics?.[n]?.hookPct === undefined)
        .map((n) => ({ it: i, n })),
    )
    .sort((a, b) => b.it.date.localeCompare(a.it.date));

  const cargadas = state.items.reduce((t, i) => t + (["tiktok", "instagram"] as const).filter((n) => i.metrics?.[n]?.hookPct !== undefined).length, 0);

  if (!pendientes.length && !cargadas) return null;

  return (
    <div className="retencion-lote">
      <div className="sec-kicker">
        <span>Retención · lo único que el sistema no puede sacar solo</span>
        <i />
        <span className="dim small">{cargadas} cargada(s)</span>
      </div>
      {pendientes.length === 0 ? (
        <p className="pal-note">Están todas cargadas. El modelo ya puede leer la forma de la curva.</p>
      ) : (
        <>
          <p className="pal-note">
            Los dos números salen del panel de la red, en cada video: <b>hook</b> es el % que pasa los primeros 3 s y <b>completion</b> el % que llega al final. Con tres clips cargados el modelo ya distingue si lo que falla es el arranque o el desarrollo.
          </p>
          <div className="ret-lista">
            {pendientes.slice(0, 12).map(({ it, n }) => {
              const k = `${it.id}:${n}`;
              const v = vals[k] ?? { h: "", c: "" };
              const set = (campo: "h" | "c", x: string) => setVals((p) => ({ ...p, [k]: { ...v, [campo]: x } }));
              const listo = v.h !== "" || v.c !== "";
              return (
                <div key={k} className="ret-fila">
                  <span className="ret-tit">
                    <span className="chip-kind faint">{it.date} · {n === "tiktok" ? "TikTok" : "IG"}</span>
                    <span>{it.clip?.tituloInterno ?? "(pieza)"}</span>
                  </span>
                  <label className="ret-campo">
                    <span className="t-label">Hook %</span>
                    <input type="number" min={0} max={100} value={v.h} onChange={(e) => set("h", e.target.value)} placeholder="—" />
                  </label>
                  <label className="ret-campo">
                    <span className="t-label">Completion %</span>
                    <input type="number" min={0} max={100} value={v.c} onChange={(e) => set("c", e.target.value)} placeholder="—" />
                  </label>
                  <button
                    className="copy-btn"
                    disabled={!!busy || !listo}
                    onClick={() =>
                      onAct({ action: "retencion", itemId: it.id, network: n, hookPct: v.h === "" ? undefined : Number(v.h), completionPct: v.c === "" ? undefined : Number(v.c) }, `ret:${k}`).then(() =>
                        setVals((p) => ({ ...p, [k]: { h: "", c: "" } })),
                      )
                    }
                  >
                    {busy === `ret:${k}` ? "…" : "guardar"}
                  </button>
                </div>
              );
            })}
          </div>
          {pendientes.length > 12 && <p className="dim small">y {pendientes.length - 12} más — se van mostrando a medida que cargás.</p>}
        </>
      )}
    </div>
  );
}

/** La primera pantalla de Métricas: la respuesta, por qué, y qué hacer. */
function Veredicto({ k }: { k: NonNullable<FullState["modelo"]>["conocimiento"] }) {
  const pct = Math.round((k.meta.hechas / k.meta.total) * 100);
  return (
    <div className="veredicto">
      <p className="ver-claim">{k.veredicto}</p>
      <p className="ver-porque">{k.porQue}</p>

      {k.sabemos.length > 0 && (
        <ul className="ver-sabemos">
          {k.sabemos.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}

      <div className="ver-meta">
        <div className="ver-meta-head">
          <span className="t-label">Hacia la primera conclusión</span>
          <span className="ver-meta-val">{k.meta.hechas} de {k.meta.total} piezas medidas</span>
        </div>
        <span className="bar-track"><i style={{ width: `${pct}%` }} /></span>
      </div>

      {k.tareas.length > 0 && (
        <div className="ver-tareas">
          <div className="t-label ver-tareas-t">Qué destraba el modelo</div>
          <ol>
            {k.tareas.map((t, i) => (
              <li key={i}>
                <span className="tarea-n">{i + 1}</span>
                <span>
                  <span className="tarea-t">{t.texto}</span>
                  <span className="tarea-d">{t.detalle}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

const EV: Record<string, { label: string; cls: string }> = {
  nada: { label: "sin datos", cls: "ev-nada" },
  indicio: { label: "indicio", cls: "ev-indicio" },
  señal: { label: "señal", cls: "ev-senal" },
  confirmado: { label: "confirmado", cls: "ev-ok" },
};
const pc = (x: number) => `${(x * 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

/**
 * Una palanca del modelo: la pregunta, la respuesta y la evidencia que la
 * sostiene. El intervalo va dibujado, no escrito: con una posterior Beta lo
 * que decide es cuánto se solapan dos opciones, y eso se ve de un vistazo.
 */
function Palanca({ p, first }: { p: NonNullable<FullState["modelo"]>["palancas"][number]; first: boolean }) {
  const escala = Math.max(0.005, ...p.brazos.map((b) => b.post.hi)) * 1.06;
  const x = (v: number) => `${Math.min(100, (v / escala) * 100)}%`;
  const comparable = p.brazos.length > 1;
  const decidido = p.evidencia === "señal" || p.evidencia === "confirmado";
  return (
    <div className="palanca">
      <div className="pal-head">
        <span className="pal-n">{p.nombre}</span>
        <span className={`pal-ev ${EV[p.evidencia]?.cls ?? ""}`}>{EV[p.evidencia]?.label ?? p.evidencia}</span>
        <span className="dim small">{p.pregunta}</span>
      </div>
      <div className="pal-concl">{p.conclusion}</div>
      <div className="table-scroll">
        <table className="pal-tabla">
          <thead>
            <tr>
              <th scope="col">Opción</th>
              <th scope="col" className="num">Piezas</th>
              <th scope="col" className="num">Vistas</th>
              <th scope="col" className="num">Save rate</th>
              <th scope="col">Intervalo 90 % · escala 0–{pc(escala)}</th>
              <th scope="col" className="num">P(es la mejor)</th>
            </tr>
          </thead>
          <tbody>
            {p.brazos.map((b) => (
              <tr key={b.valor} className={comparable && decidido && b.pMejor > 0.6 ? "lider" : ""}>
                <th scope="row">{b.valor}</th>
                <td className="num">{b.piezas}</td>
                <td className="num">{b.vistas.toLocaleString(LOCALE)}</td>
                <td className="num">{pc(b.post.media)}</td>
                <td>
                  <span className="post-lane" title={`${pc(b.post.lo)} a ${pc(b.post.hi)}`}>
                    <i className="axis" />
                    <i className="ci" style={{ left: x(b.post.lo), width: `calc(${x(b.post.hi)} - ${x(b.post.lo)})` }} />
                    <i className="mean" style={{ left: x(b.post.media) }} />
                  </span>
                </td>
                <td className="num">
                  {comparable ? (
                    <span className="bar-cell">
                      <span className="bar-track"><i style={{ width: `${Math.round(b.pMejor * 100)}%` }} /></span>
                      <span className="bar-val">{(b.pMejor * 100).toFixed(0)} %</span>
                    </span>
                  ) : (
                    <span className="dim">sin comparación</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {first && (
        <div className="pal-note">
          La barra es el rango donde está el save rate real con 90 % de probabilidad; la marca, su valor más probable. Dos filas que se solapan no son distinguibles todavía, por más que una tenga la media más alta.
        </div>
      )}
      {p.faltan && <div className="pal-faltan">Para decidir: {p.faltan}</div>}
    </div>
  );
}

function ModeloSection({ modelo: m }: { modelo: NonNullable<FullState["modelo"]> }) {
  const [open, setOpen] = useState(true);
  const k = m.conocimiento;
  return (
    <div className="modelo">
      <button className="sec-kicker sec-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>La evidencia, palanca por palanca</span>
        <i />
        <span className="dim small" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <>
          <div className="modelo-head">
            <div className="mk"><b>{k.observaciones}</b><span>piezas medidas</span></div>
            <div className="mk"><b>{k.vistasTotales.toLocaleString(LOCALE)}</b><span>vistas acumuladas</span></div>
            <div className="mk"><b>{k.conRetencion}</b><span>con curva de retención</span></div>
            <div className="mk"><b>{k.sabemos.length}</b><span>palancas con señal</span></div>
          </div>

          {m.decisiones.length > 0 && (
            <div className="modelo-box dec">
              <div className="mb-t">Qué hacer en la próxima pieza</div>
              <div className="mb-note">
                Thompson sampling: cada opción sale elegida con la probabilidad de que sea la mejor, así el sistema explora solo mientras no sabe y deja de hacerlo cuando una se despega.
              </div>
              <div className="dec-grid">
                {m.decisiones.map((d, i) => (
                  <div key={i} className={`dec-i ${d.explorando ? "explora" : "explota"}`}>
                    <span className="dec-p">{d.palanca}</span>
                    <span className="dec-v">{d.elegido}</span>
                    <span className="dec-m">{d.explorando ? "explorando" : "explotando"} · {d.motivo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {m.palancas.map((p, i) => (
            <Palanca key={p.id} p={p} first={i === 0} />
          ))}
        </>
      )}
    </div>
  );
}

function UpcomingList({ state, today, onOpen }: { state: State; today: string; onOpen: (id: string) => void }) {
  const upcoming = state.items.filter((i) => i.date > today).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 8);
  if (!upcoming.length) return null;
  return (
    <div className="upcoming">
      <Kicker>Próximas piezas</Kicker>
      <div className="upcoming-table">
        {upcoming.map((it) => {
          return (
            <button key={it.id} className="upcoming-row" onClick={() => onOpen(it.id)}>
              <span className="upcoming-date">{DAY_NAMES[isoDow(it.date) - 1].slice(0, 3)} {fmtDay(it.date)}</span>
              <span className="chip-kind faint">CLIP</span>
              <span className="upcoming-title">
                {it.status === "drafting" ? "Redactando…" : it.clip?.tituloInterno}
              </span>
              <span className="upcoming-hour">{it.time}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ajustes: lo que se edita desde la UI (guía de estilo, reglas) y lo que se
// configura por entorno (se muestra, nunca se edita acá: son secretos).

function Ajustes({ state: s, me, busy, onAct }: { state: FullState; me: Me; busy: string | null; onAct: Act }) {
  const [guide, setGuide] = useState(s.settings?.styleGuide ?? "");
  useEffect(() => setGuide(s.settings?.styleGuide ?? ""), [s.settings?.styleGuide]);
  const cfg = s.config;
  const Row = ({ ok, label, hint }: { ok: boolean; label: string; hint: string }) => (
    <div className={`cfg-row ${ok ? "ok" : "missing"}`}>
      <span className="cfg-dot" aria-hidden="true" />
      <span className="cfg-label">{label}</span>
      <span className="dim small">{ok ? "configurado" : hint}</span>
    </div>
  );
  return (
    <section className="view">
      <div className="view-head">
        <h1>Ajustes</h1>
      </div>
      <div className="settings">
        <div className="card">
          <div className="card-head">
            <span className="platform">Guía de estilo</span>
            <button className="btn primary" disabled={!!busy || guide === (s.settings?.styleGuide ?? "")} onClick={() => onAct({ action: "styleGuide", text: guide }, "guide")}>
              {busy === "guide" ? "Guardando…" : "Guardar"}
            </button>
          </div>
          <div className="card-body">
            <p className="dim small" style={{ marginBottom: 8 }}>
              Va primero en todos los prompts de planificación y redacción: tu voz, las reglas de la casa, lo que funciona y lo que no. Vacío = guía por defecto.
            </p>
            <textarea className="guide-input" rows={12} value={guide} onChange={(e) => setGuide(e.target.value)} placeholder={s.defaultStyleGuide ?? ""} />
          </div>
        </div>

        {cfg && (
          <div className="card">
            <div className="card-head"><span className="platform">Configuración por entorno</span></div>
            <div className="card-body">
              <p className="dim small" style={{ marginBottom: 8 }}>Las claves nunca se muestran ni se editan acá: van en las variables de entorno del deploy (ver README y .env.example).</p>
              <Row ok={cfg.integrations.gemini} label="Gemini" hint="GEMINI_API_KEY — sin esto no se analizan videos" />
              <Row ok={cfg.integrations.openai} label="OpenAI" hint="OPENAI_API_KEY — sin esto no se redactan captions" />
              <Row ok={Boolean(cfg.youtubeChannelId)} label="Canal de YouTube" hint="YOUTUBE_CHANNEL_ID — sin esto no hay escaneo automático" />
              <Row ok={cfg.integrations.apify} label="Apify (métricas TikTok/Instagram)" hint="APIFY_TOKEN + TIKTOK_USERNAME / INSTAGRAM_USERNAME — opcional" />
              <Row ok={cfg.integrations.youtubeApi} label="YouTube Data API (métricas)" hint="YOUTUBE_API_KEY — opcional" />
              <Row ok={cfg.integrations.cronSecret} label="Cron" hint="CRON_SECRET — necesario para el cron diario" />
              <Row ok={me.googleConfigured} label="Login con Google" hint={`se entra con ACCESS_CODE · para Google: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / AUTH_SECRET / ALLOWED_EMAILS`} />
              <div className="dim small" style={{ marginTop: 10 }}>
                Marca: <b>{cfg.brandName}</b> · creador: {cfg.creatorName} · zona horaria: {cfg.timezone} · hora de publicación: {cfg.publishTime} · clips por video: {cfg.clipsPerVideo} · plan semanal: {cfg.weeklyPlan}
                {cfg.brandHashtag ? ` · hashtag: #${cfg.brandHashtag}` : ""} · CTA: “{cfg.ctaText}”
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><span className="platform">Registro del sistema</span></div>
          <div className="card-body">
            <pre className="log-body">{[...s.log].reverse().join("\n") || "(vacío)"}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}
