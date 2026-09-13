// Tareas diferidas con Upstash QStash (Marketplace, plan free).
//
// El cron de Vercel en plan Hobby corre una vez por día; para "5 horas después
// de publicar, traé las métricas" hace falta un programador externo. QStash
// recibe un mensaje con Upstash-Delay y llama a nuestra URL cuando vence,
// reenviando los headers Upstash-Forward-* (ahí viaja el CRON_SECRET, que es
// lo que autoriza el endpoint).

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN && process.env.QSTASH_URL);
}

/** Programa una llamada GET a `url` dentro de `delaySeconds`. Devuelve el messageId o null. */
export async function scheduleGet(url: string, delaySeconds: number): Promise<string | null> {
  if (!qstashConfigured()) return null;
  // La URL destino va tal cual después de /v2/publish/ (sin encodear).
  const res = await fetch(`${process.env.QSTASH_URL!.replace(/\/$/, "")}/v2/publish/${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.QSTASH_TOKEN}`,
      "Upstash-Method": "GET",
      "Upstash-Delay": `${Math.max(1, Math.round(delaySeconds))}s`,
      "Upstash-Retries": "2",
      ...(process.env.CRON_SECRET ? { "Upstash-Forward-Authorization": `Bearer ${process.env.CRON_SECRET}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`QStash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { messageId?: string };
  return data.messageId ?? null;
}

/** Checkpoints de métricas después de publicar: 5 h, 24 h y 7 días. */
export const METRIC_CHECKPOINTS: { key: string; seconds: number }[] = [
  { key: "5h", seconds: 5 * 3600 },
  { key: "24h", seconds: 24 * 3600 },
  { key: "7d", seconds: 7 * 86400 },
];
