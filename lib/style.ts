// La guía de estilo: lo que en cada podcast es propio (voz, reglas de la casa,
// qué funciona y qué no) y que acá NO viene cableado. Se edita en Ajustes, se
// guarda en la base y va primero en todos los system prompts de redacción.

import { CONTENT_LANGUAGE, PODCAST_DESCRIPTION, PODCAST_NAME } from "@/lib/config";
import type { State } from "@/lib/store";

export const DEFAULT_STYLE_GUIDE = `# Guía de estilo (editala en Ajustes)

- Voz: directa, concreta, sin hype. Frases cortas. El dato específico gana siempre.
- Nunca inventar: todo lo que se afirma tiene que estar en la transcripción.
- Un solo pedido por pieza (comentar, guardar o ir al episodio), nunca dos.
- Sin preguntas retóricas de apertura, sin contrastes "no es X, es Y", sin adjetivos vacíos.`;

/** Preámbulo común de todos los prompts de producción. */
export function doctrine(state: State): string {
  const guide = state.settings?.styleGuide?.trim() || DEFAULT_STYLE_GUIDE;
  return [
    `Trabajás para ${PODCAST_NAME}, ${PODCAST_DESCRIPTION}. Escribís en ${CONTENT_LANGUAGE}.`,
    "",
    guide,
    "",
    "Trabajás siempre en JSON con el esquema que te pide cada tarea; nada de prosa fuera del JSON.",
  ].join("\n");
}

/** Reglas propias que el usuario cargó (Ajustes → Reglas). Se anexan a los prompts. */
export function rulesBlock(state: State): string {
  const rules = (state.settings?.rules ?? []).filter((r) => r.active).map((r) => r.text.trim()).filter(Boolean);
  if (!rules.length) return "";
  return ["", "# REGLAS DE LA CUENTA (obligatorias)", ...rules.map((r) => `- ${r}`)].join("\n");
}
