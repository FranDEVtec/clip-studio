// Cliente mínimo de OpenAI con Structured Outputs, y helpers de texto compartidos.

export async function openaiJson<T>(
  messages: unknown[],
  schema: Record<string, unknown>,
  name: string,
  opts: { reasoning?: "minimal" | "low" | "medium" | "high" } = {},
): Promise<T> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY");
  // Los modelos con razonamiento aceptan reasoning_effort; "low" alcanza para
  // redacción estructurada y baja el tiempo a la mitad. OPENAI_REASONING lo pisa.
  const reasoning = opts.reasoning ?? (process.env.OPENAI_REASONING as "low" | undefined) ?? "low";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5",
      messages,
      reasoning_effort: reasoning,
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI no devolvió contenido");
  return JSON.parse(content) as T;
}

/** Normaliza para comparar citas: sin tildes, sin puntuación, sin dobles espacios. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
