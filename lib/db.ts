// Postgres: Neon (HTTP, sin pool) o cualquier Postgres vía `pg`.
//
// Un solo contrato para los dos: `sql()` devuelve una tagged template que
// ejecuta la consulta y resuelve las filas, más `transaction(queries)` que corre
// varias en una transacción. Con Neon se usa su driver HTTP (ideal para
// funciones serverless); con cualquier otra URL, un Pool de `pg`.
//
// Se instancia perezosamente porque Next evalúa módulos en build, cuando
// DATABASE_URL puede no existir todavía.

import { neon, type NeonQueryFunction, type NeonQueryPromise } from "@neondatabase/serverless";
import { Pool } from "pg";

type Row = Record<string, unknown>;

/** Consulta perezosa: no se ejecuta hasta que se la espera o entra a una transacción. */
export type Query = PromiseLike<Row[]> & { readonly text: string; readonly values: unknown[] };

export type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Query) & {
  transaction(queries: Query[]): Promise<void>;
};

let cached: Sql | undefined;

export function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    cached = /neon\.tech/.test(url) ? neonClient(url) : pgClient(url);
  }
  return cached;
}

function neonClient(url: string): Sql {
  const q: NeonQueryFunction<false, false> = neon(url);
  const tagged = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const p = q(strings, ...values) as NeonQueryPromise<false, false, Row[]>;
    return Object.assign(p, { text: strings.join("?"), values });
  }) as unknown as Sql;
  tagged.transaction = async (queries: Query[]) => {
    await q.transaction(queries as unknown as NeonQueryPromise<false, false>[]);
  };
  return tagged;
}

function pgClient(url: string): Sql {
  const pool = new Pool({ connectionString: url, max: 4 });
  const build = (strings: TemplateStringsArray, values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    return { text, values };
  };
  const tagged = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text } = build(strings, values);
    const run = () => pool.query(text, values as unknown[]).then((r) => r.rows as Row[]);
    let started: Promise<Row[]> | undefined;
    const lazy: Query = {
      text,
      values,
      then(onFulfilled, onRejected) {
        if (!started) started = run();
        return started.then(onFulfilled, onRejected);
      },
    };
    return lazy;
  }) as unknown as Sql;
  tagged.transaction = async (queries: Query[]) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const qy of queries) await client.query(qy.text, qy.values as unknown[]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
  return tagged;
}

let schemaReady: Promise<void> | undefined;

/** Crea las tablas si no existen. Idempotente; corre una vez por instancia. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = sql();
      await q`CREATE TABLE IF NOT EXISTS videos (
        video_id text PRIMARY KEY,
        status text NOT NULL,
        published_at timestamptz,
        title text,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await q`CREATE TABLE IF NOT EXISTS items (
        id text PRIMARY KEY,
        video_id text NOT NULL,
        kind text NOT NULL,
        date date NOT NULL,
        time text NOT NULL,
        status text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await q`CREATE INDEX IF NOT EXISTS items_date_idx ON items (date)`;
      await q`CREATE TABLE IF NOT EXISTS meta (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    })().catch((err) => {
      schemaReady = undefined; // que el próximo intento vuelva a probar
      throw err;
    });
  }
  return schemaReady;
}
