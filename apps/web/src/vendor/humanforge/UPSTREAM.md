# HumanForge: runtime integrado

Fuente: https://github.com/abdulrehman043/humanforge/tree/2226df1f50a04c5a8e1c02ea33780d28337dfbb1

Versión de origen: 0.8.1. Código MIT; copia del texto en `docs/third-party/humanforge-LICENSE`. Los datos de MakeHuman/MPFB utilizados son CC0-1.0; procedencia individual en `docs/third-party/humanforge-ASSETS.md`. No se usa TalkingHead ni ninguno de sus recursos con restricción comercial.

Se integraron únicamente `runtime`, `glb`, `sliders` y `catalog`, a partir de `src/human/`. JavaScript generado con `typescript.transpileModule`, TypeScript 5.9.3, destino ES2022 y módulos ESNext. Se agregó la cabecera de licencia y `.js` a imports relativos. Las declaraciones se emitieron desde el mismo origen con `emitDeclarationOnly` y los tipos de Three 0.180.0. No se incorpora el editor, React Native, selfies, servicios remotos ni descargas del SDK.

Los recursos de `apps/web/public/avatars/human` se copiaron del mismo commit. `manifest.json` se redujo a los peinados, vestuario y texturas incluidos; se retiró la referencia a un paquete móvil ausente. `PROVENANCE.json` registra tamaños y SHA-256. `pnpm verify:avatars` comprueba los bytes de esta selección. `.gitattributes` impide que Git cambie sus finales de línea durante un checkout en Windows.

El código integrado se conserva como dependencia de terceros, separado del lint y formateo propios. Los adaptadores `HumanCommittee`, `human-look` y sus pruebas sí se verifican con TypeScript estricto y ESLint.
