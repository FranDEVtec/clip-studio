// Redacción encadenada entre invocaciones.
//
// Una función serverless dura pocos minutos como mucho; un episodio con varios
// clips supera eso. Entonces cada invocación escribe de a 2 piezas mientras le
// quede presupuesto y, si faltan, se re-invoca a sí misma
// (GET /api/cron/scan?step=write) con `after()`, que mantiene viva la función
// hasta que el fetch de continuación sale.

import { after } from "next/server";
import { pendingDrafts, writePendingItems } from "@/lib/pipeline";
import { loadState, logLine, mergeSave, type State } from "@/lib/store";

/**
 * Escribe de a tandas mientras haya presupuesto. En cada vuelta RELEE la base
 * (por si la UI borró o movió piezas) y persiste sólo lo que escribió.
 */
export async function writeLoop(state: State, startedAt: number, budgetMs: number): Promise<number> {
  let current = state;
  let remaining = pendingDrafts(current).length;
  while (remaining > 0 && Date.now() - startedAt < budgetMs) {
    const r = await writePendingItems(current, 2);
    current = await mergeSave(current, r.written);
    remaining = pendingDrafts(current).length;
  }
  Object.assign(state, current);
  return remaining;
}

export { loadState };

/** Headers con los que el servidor se autoriza a sí mismo. */
export function selfAuthHeaders(): Record<string, string> {
  if (process.env.CRON_SECRET) return { authorization: `Bearer ${process.env.CRON_SECRET}` };
  if (process.env.ACCESS_CODE) return { "x-access-code": process.env.ACCESS_CODE };
  return {};
}

/** Re-invoca el cron con un paso dado (write | metrics | analyze) después de responder. */
export function continueStep(origin: string, step: string) {
  const headers = selfAuthHeaders();
  after(async () => {
    try {
      await fetch(`${origin}/api/cron/scan?step=${step}`, { headers, cache: "no-store" });
    } catch (err) {
      console.error("[chain] continuación falló:", err);
    }
  });
}

/** Dispara la próxima invocación si quedan piezas por escribir. */
export function continueWriting(origin: string, remaining: number, state: State) {
  if (remaining > 0) {
    logLine(state, `Quedan ${remaining} piezas por redactar: sigo en la próxima invocación.`);
    continueStep(origin, "write");
  }
}
