// El motor está partido en dos etapas a propósito.
//
//   1. Gemini PERCIBE (temp baja). Sólo extrae hechos del episodio:
//      transcripción verbatim de cada tramo, citas textuales con su segundo,
//      nombre del invitado si se dice (lib/episode-engine.ts).
//   2. OpenAI REDACTA (temp media). No ve el video. Recibe la transcripción y
//      las reglas, y devuelve las piezas mínimas — el armado final del caption
//      lo hace el código, no el modelo (lib/copy.ts).
//   3. El código VERIFICA que toda cita textual exista en la transcripción.
//
// Un solo modelo que mira el video Y escribe el copy produce citas que el
// invitado nunca dijo: la temperatura que hace falta para que el copy no suene
// a folleto es la que hace que la percepción invente.

import { BRAND_HASHTAG } from "@/lib/config";

/** Lo que devuelve la etapa 1 para un tramo. Sólo hechos. */
export type Extraction = {
  titulo: string;
  transcripcion: string;
  invitado: string;
  tema: string;
  citas: { texto: string; segundo: number }[];
};

export const COPY_INSTRUCTION = `# TAREA: las piezas del caption de un clip
Recibís la transcripción verbatim de un clip ya cortado y devolvés las piezas de su caption. Trabajás sobre un texto que ya existe. No viste el video. Todo lo que afirmes tiene que estar en la transcripción que te paso: si no está ahí, no pasó.

# TU SALIDA NO ES EL CAPTION FINAL
Devolvés piezas sueltas. El sistema arma el texto final pegando: tu claim, después un CTA fijo, después los hashtags. Por eso:
- NO escribas el CTA. NO escribas "mirá el episodio", "link en bio", "episodio completo".
- NO pegues los hashtags dentro del claim. Van en su propio campo.
- NO uses saltos de línea en el claim. El caption es UNA sola línea: decir una cosa concreta en un renglón ES el formato.

# LOS TRES MOLDES
Elegí uno:
**cita** — la frase textual del invitado, entre comillas. Es el molde más fuerte cuando el clip tiene una frase que se sostiene sola.
**revelacion** — qué se revela y quién lo dice. ("Los secretos para armar un buen mate, según el dueño de la yerbatera más grande del país 🧉")
**pregunta** — sólo si la pregunta es concreta y sobre un hecho puntual del clip, imposible de responder sin verlo. Una pregunta genérica es peor que cualquier revelación.

Cómo elegir: si hay una frase textual que se entiende sola y sorprende, usá **cita**. Si no, **revelacion**. **pregunta** casi nunca.

# LA CITA SE VERIFICA CONTRA EL TEXTO
Si elegís **cita**, el campo cita_textual va copiado carácter por carácter de la transcripción. No la pulas, no la acortes, no le arregles la gramática ni la puntuación. Si el invitado habló mal, va mal.
Un programa compara tu cita contra la transcripción antes de publicar. Si no coincide, tu respuesta se rechaza. Si tampoco coincide en el segundo intento, el clip sale sin comillas. Por eso: **ante la menor duda de si una frase es textual, usá revelacion.** Nunca completes, unas ni "reconstruyas" una frase a partir de dos pedazos separados.

# EL TITULAR EN PANTALLA (hook_edicion)
La frase grande que el editor pone EN PANTALLA en los primeros segundos. Siempre va.
- **3 a 7 palabras**, máximo ~55 caracteres. Sin punto final. Sin comillas.
- Gramática de titular: sin artículos donde se pueda, verbo en infinitivo, futuro o imperativo.
- Dice el payoff, no lo esconde: es la afirmación más fuerte del clip escrita como titular. Nada de preguntas retóricas ni "no vas a creer".
- Si el clip tiene un concepto con nombre, va en el titular: es lo que se recuerda y lo que se busca.
- El nombre y la credencial del invitado NO van en el titular: van aparte (campo credencial).
- Tiene que describir lo que el clip efectivamente muestra. Prometer algo que el clip no entrega mata la pieza.
- Entrá por la curiosidad que la gente YA tiene, no por el vocabulario del episodio. Si el brief trae una CURIOSIDAD DE ENTRADA, esa es tu puerta. El límite es duro: el clip tiene que CUMPLIR esa promesa.
- Si el clip gira alrededor de un número, el número va en el titular, en cifra.

**credencial**: cómo se presenta al invitado, 2 a 5 palabras, sin su nombre. Ej.: "Nutricionista deportivo", "Fundador de X". Sale de lo que él dice de sí mismo; si no hay dato, string vacío.

# ESTILO — que no se note que lo escribió una máquina
El copy lo tiene que poder haber escrito el productor del podcast desde el celular, apurado y con criterio. Frases cortas. El dato específico gana siempre: "una habitación de 25.000 dólares" le gana a "el mundo del lujo".
PROHIBIDO: preguntas retóricas de apertura; contrastes simétricos ("no es X, es Y"); verbos de marketing con sujeto inanimado ("demuestra", "revela", "redefine"); adjetivos vacíos ("increíble", "único", "premium"); palabras infladas ("experiencia", "sumergite", "descubrí", "clave"); cierres de moraleja; cadenas de emojis; mayúsculas gritadas; tono coach o folleto.

# EL INVITADO
Te lo paso yo como dato. Si viene vacío, no lo inventes ni lo deduzcas: dejá el claim sin nombre. Nombrar mal a un invitado real es el peor error que puede cometer este sistema. Cuando el molde sea **cita**, el sistema pega el nombre después de las comillas: vos devolvé sólo la frase entre comillas.

# HASHTAGS — dos juegos distintos
- hashtags (Instagram): exactamente 5, minúscula, sin tildes, sin #. Sobre el TEMA del clip: dos amplios del nicho, dos del tema exacto${BRAND_HASHTAG ? `, y siempre ${BRAND_HASHTAG}` : ", y uno del podcast"}. En Instagram NO van fyp/viral/parati.
- hashtags_tiktok (TikTok): exactamente 5, minúscula, sin tildes, sin #. ${BRAND_HASHTAG ? `Siempre ${BRAND_HASHTAG}, más 4` : "Cinco"} relacionados con lo que pasa en el video (el tema, el nicho, la emoción o el formato). Tendencia sí, pero nunca ajenos al video.

# EL EMOJI
Uno solo, al final del claim, del tema real del clip. Nunca decorativo, nunca dos.

# SI LA TRANSCRIPCIÓN NO ALCANZA
Si el clip es demasiado corto, inaudible o no tiene una idea clara, no inventes una para rellenar. Devolvé el claim más literal y chato que puedas defender con el texto, con el molde revelacion. Es preferible un caption aburrido y cierto a uno atractivo y falso.`;

/** Señal de spam en Instagram. En TikTok sólo los dos últimos. */
export const BANNED_HASHTAGS = ["fyp", "viral", "parati", "foryou", "fypage"];
export const BANNED_HASHTAGS_TIKTOK = ["viral", "fypage"];
