# Clip Studio — guía para agentes

Motor de clips y tracker de métricas para creadores que suben a YouTube. Next.js 15, TypeScript, Postgres. Sin framework de CSS.

- **¿Te pidieron instalarlo para alguien?** Seguí `ONBOARDING.md` paso a paso. No inventes valores ni imprimas keys.
- **¿Vas a tocar el código?** Leé `docs/ARCHITECTURE.md` (mapa de módulos) y `CONTRIBUTING.md` (reglas). Corré `npm test` y `npm run build` antes de dar algo por terminado.

Reglas que no se negocian:

1. Las reglas que importan viven en código (`lib/copy.ts → findProblems`), no en prompts.
2. `quoteIsReal` no se debilita: ninguna cita sale sin verificarse contra la transcripción.
3. Nada publica solo.
4. Ninguna marca en el código: todo sale de `lib/config.ts` (entorno) o de Ajustes.
5. Ningún secreto en el repo.
