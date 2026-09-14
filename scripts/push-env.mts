#!/usr/bin/env tsx
// Sube .env.local a las variables de entorno del proyecto de Vercel linkeado.
//
//   npm run push-env            → producción
//   npm run push-env -- preview → otro entorno
//
// Requiere `vercel link` hecho. Usa `vercel env add NAME <env> --force` con el
// valor por stdin, así ninguna key pasa por la línea de comandos ni por el
// historial de la shell. Las variables vacías se saltean.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const target = process.argv[2] ?? "production";
const file = process.argv[3] ?? ".env.local";
const text = readFileSync(file, "utf8");
let n = 0;
for (const raw of text.split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  if (!value) continue;
  const r = spawnSync("npx", ["vercel", "env", "add", key, target, "--force"], { input: value, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`✗ ${key}: ${(r.stderr || r.stdout).trim().split("\n").slice(-1)[0]}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${key}`);
    n++;
  }
}
console.log(`\n${n} variable(s) subidas a ${target}.`);
