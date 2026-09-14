// El planificador: de los tramos candidatos que encontró Gemini, cuáles van a
// clip, en qué orden y con qué ángulo. Habla por JSON con Structured Outputs.

import { fmtTime, openaiJson } from "@/lib/openai";
import { doctrine } from "@/lib/style";
import type { ClipCandidate, State, Video } from "@/lib/store";

export const PLANNER_INSTRUCTION = `# TAREA: el plan de la semana
Ahora sólo PLANIFICÁS: qué tramos van a clip, en qué orden y con qué ángulo. Después se escribe cada pieza en otra llamada.

Recibís los tramos candidatos a clip (con puntaje, motivo, citas) y cuántos clips hay que agendar. Los clips salen un día cada uno, en el orden que devuelvas.

# Criterios
- El primer clip de la semana es el más fuerte: anécdota con final, opinión con convicción o número concreto. Los siguientes alternan ÁNGULOS: no dos clips seguidos sobre la misma idea. Si dos tramos cuentan lo mismo, elegí uno.
- Un clip tiene que darle al que lo ve una razón SOCIAL para reenviarlo (queda bien compartiéndolo: dato útil, opinión defendible, identidad). "El creador siendo simpático" no califica.
- Repartí entre los ejes del video cuando se pueda.
- No inventes: sólo índices de la lista y ángulos que salgan de lo que hay.

# Salida
- clips: lista ORDENADA (el primero sale primero) de {candidate_index, angulo (una línea: qué vende este clip), gancho_sugerido (la primera frase del tramo tal cual o el dato que abre)}. Exactamente la cantidad pedida, sin repetir índice.
- nota_semana: una línea para el editor con el hilo de la semana.`;

export type VideoPlan = {
  clips: { candidate_index: number; angulo: string; gancho_sugerido: string }[];
  nota_semana: string;
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clips", "nota_semana"],
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_index", "angulo", "gancho_sugerido"],
        properties: { candidate_index: { type: "integer" }, angulo: { type: "string" }, gancho_sugerido: { type: "string" } },
      },
    },
    nota_semana: { type: "string" },
  },
} as const;

export async function planVideo(state: State, video: Video, nClips: number, candidates: ClipCandidate[]): Promise<VideoPlan> {
  const a = video.analysis!;
  const brief = [
    `VIDEO: ${video.title}`,
    `TESIS: ${a.tesis}`,
    `TEMA: ${a.tema}`,
    ...(a.ejes?.length ? ["EJES:", ...a.ejes.map((e, i) => `[${i}] ${e.nombre} — ${e.idea}`)] : []),
    `HAY QUE AGENDAR: ${nClips} clips.`,
    "",
    "TRAMOS CANDIDATOS A CLIP:",
    ...candidates.map(
      (c, i) =>
        `[${i}] ${fmtTime(c.inicio)}–${fmtTime(c.fin)} · puntaje ${c.puntaje} · eje ${c.eje ?? "?"} · "${c.titulo}" · tema: ${c.tema}\n    motivo: ${c.motivo}\n    citas: ${c.citas.map((q) => `"${q.texto}"`).join(" | ")}`,
    ),
  ].join("\n");
  let plan: VideoPlan;
  try {
    plan = await openaiJson<VideoPlan>(
      [
        { role: "system", content: doctrine(state) + "\n\n---\n" + PLANNER_INSTRUCTION },
        { role: "user", content: brief },
      ],
      PLAN_SCHEMA,
      "plan_video",
    );
  } catch {
    // Sin planificador (o sin OpenAI): el orden por puntaje de Gemini vale.
    plan = { clips: [], nota_semana: "" };
  }
  // Saneo: índices válidos, sin repetir, cantidad pedida (relleno por puntaje).
  const seen = new Set<number>();
  plan.clips = plan.clips.filter((c) => candidates[c.candidate_index] && !seen.has(c.candidate_index) && seen.add(c.candidate_index));
  for (let i = 0; plan.clips.length < nClips && i < candidates.length; i++) {
    if (!seen.has(i)) {
      seen.add(i);
      plan.clips.push({ candidate_index: i, angulo: candidates[i].motivo, gancho_sugerido: candidates[i].gancho });
    }
  }
  plan.clips = plan.clips.slice(0, nClips);
  return plan;
}
