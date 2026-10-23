# Licencias y procedencia

Actualización 0.3.0: Three.js 0.180.0 (MIT, [texto](third-party/three-LICENSE)); runtime HumanForge 0.8.1 fijado al commit `2226df1f50a04c5a8e1c02ea33780d28337dfbb1` (MIT, [texto](third-party/humanforge-LICENSE)); recursos humanos MakeHuman/MPFB CC0-1.0 ([procedencia individual](third-party/humanforge-ASSETS.md)). Selección y SHA-256 en `apps/web/public/avatars/PROVENANCE.json`. Los archivos integrados y su generación están documentados en `apps/web/src/vendor/humanforge/UPSTREAM.md`. Vitest se actualiza a 4.1.12; el resto de las versiones se consulta en el lockfile.

El código de Oratoria Lab se entrega bajo MIT. Las dependencias conservan sus propias licencias; este inventario se obtiene de package.json del árbol instalado. Las versiones exactas e integridades de paquetes están en pnpm-lock.yaml. Los textos de licencia/NOTICE disponibles se conservan en third-party y se copian como recursos de distribución durante build.

| Dependencia                 | Versión                        | SPDX declarado                            | Textos conservados                                                                        |
| --------------------------- | ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| @axe-core/playwright        | 4.13.0                         | MPL-2.0                                   | [texto](third-party/axe-core-playwright-LICENSE)                                          |
| @huggingface/jinja          | 0.5.10                         | MIT                                       | [texto](third-party/huggingface-jinja-LICENSE)                                            |
| @huggingface/transformers   | 3.8.1                          | Apache-2.0                                | [texto](third-party/huggingface-transformers-LICENSE)                                     |
| @playwright/test            | 1.64.0                         | Apache-2.0                                | [texto](third-party/playwright-test-NOTICE), [texto](third-party/playwright-test-LICENSE) |
| @protobufjs/aspromise       | 1.1.2                          | BSD-3-Clause                              | [texto](third-party/protobufjs-aspromise-LICENSE)                                         |
| @protobufjs/base64          | 1.1.2                          | BSD-3-Clause                              | [texto](third-party/protobufjs-base64-LICENSE)                                            |
| @protobufjs/codegen         | 2.0.5                          | BSD-3-Clause                              | [texto](third-party/protobufjs-codegen-LICENSE)                                           |
| @protobufjs/eventemitter    | 1.1.1                          | BSD-3-Clause                              | [texto](third-party/protobufjs-eventemitter-LICENSE)                                      |
| @protobufjs/fetch           | 1.1.1                          | BSD-3-Clause                              | [texto](third-party/protobufjs-fetch-LICENSE)                                             |
| @protobufjs/float           | 1.0.2                          | BSD-3-Clause                              | [texto](third-party/protobufjs-float-LICENSE)                                             |
| @protobufjs/path            | 1.1.2                          | BSD-3-Clause                              | [texto](third-party/protobufjs-path-LICENSE)                                              |
| @protobufjs/pool            | 1.1.0                          | BSD-3-Clause                              | [texto](third-party/protobufjs-pool-LICENSE)                                              |
| @protobufjs/utf8            | 1.1.2                          | BSD-3-Clause                              | [texto](third-party/protobufjs-utf8-LICENSE)                                              |
| @tauri-apps/api             | 2.12.3                         | Apache-2.0 OR MIT                         | [texto](third-party/tauri-apps-api-LICENSE.spdx)                                          |
| @types/node                 | 24.19.2                        | MIT                                       | [texto](third-party/types-node-LICENSE)                                                   |
| @types/react                | 19.3.0                         | MIT                                       | [texto](third-party/types-react-LICENSE)                                                  |
| cookie                      | 1.1.1                          | MIT                                       | [texto](third-party/cookie-LICENSE)                                                       |
| csstype                     | 3.2.3                          | MIT                                       | [texto](third-party/csstype-LICENSE)                                                      |
| echarts                     | 6.1.0                          | Apache-2.0                                | [texto](third-party/echarts-NOTICE), [texto](third-party/echarts-LICENSE)                 |
| flatbuffers                 | 25.9.23                        | Apache-2.0                                | [texto](third-party/flatbuffers-LICENSE)                                                  |
| @diffusionstudio/piper-wasm | 1.0.0                          | MIT (incluye eSpeak NG, GPL-3.0-or-later) | [aviso](third-party/piper-phonemize-NOTICE), [GPL-3.0](third-party/espeak-ng-GPL-3.0)     |
| @mediapipe/tasks-vision     | 0.10.35                        | Apache-2.0                                | El paquete npm no incluye archivo de licencia                                             |
| fflate                      | 0.8.3                          | MIT                                       | [texto](third-party/fflate-LICENSE)                                                       |
| pdfjs-dist                  | 6.3.289                        | Apache-2.0                                | [texto](third-party/pdfjs-dist-LICENSE)                                                   |
| guid-typescript             | 1.0.9                          | ISC                                       |                                                                                           |
| idb                         | 8.0.4                          | ISC                                       | [texto](third-party/idb-LICENSE)                                                          |
| long                        | 5.3.2                          | Apache-2.0                                | [texto](third-party/long-LICENSE)                                                         |
| lucide-react                | 1.55.0                         | ISC                                       | [texto](third-party/lucide-react-LICENSE)                                                 |
| onnxruntime-common          | 1.22.0-dev.20250409-89f8206ba4 | MIT                                       |                                                                                           |
| onnxruntime-web             | 1.22.0-dev.20250409-89f8206ba4 | MIT                                       |                                                                                           |
| platform                    | 1.3.6                          | MIT                                       | [texto](third-party/platform-LICENSE)                                                     |
| protobufjs                  | 7.6.6                          | BSD-3-Clause                              | [texto](third-party/protobufjs-LICENSE)                                                   |
| react                       | 19.3.0                         | MIT                                       | [texto](third-party/react-LICENSE)                                                        |
| react-dom                   | 19.3.0                         | MIT                                       | [texto](third-party/react-dom-LICENSE)                                                    |
| react-router                | 7.18.4                         | MIT                                       | [texto](third-party/react-router-LICENSE.md)                                              |
| react-router-dom            | 7.18.4                         | MIT                                       | [texto](third-party/react-router-dom-LICENSE.md)                                          |
| scheduler                   | 0.28.0                         | MIT                                       | [texto](third-party/scheduler-LICENSE)                                                    |
| set-cookie-parser           | 2.7.2                          | MIT                                       | [texto](third-party/set-cookie-parser-LICENSE)                                            |
| tailwindcss                 | 4.3.3                          | MIT                                       | [texto](third-party/tailwindcss-LICENSE)                                                  |
| tslib                       | 2.3.0                          | 0BSD                                      | [texto](third-party/tslib-LICENSE.txt)                                                    |
| typescript                  | 5.9.3                          | Apache-2.0                                | [texto](third-party/typescript-LICENSE.txt)                                               |
| undici-types                | 7.24.6                         | MIT                                       | [texto](third-party/undici-types-LICENSE)                                                 |
| vite                        | 7.3.7                          | MIT                                       | [texto](third-party/vite-LICENSE.md)                                                      |
| vitest                      | 4.1.11                         | MIT                                       | [texto](third-party/vitest-LICENSE.md)                                                    |
| zod                         | 4.6.7                          | MIT                                       | [texto](third-party/zod-LICENSE)                                                          |
| zrender                     | 6.1.0                          | BSD-3-Clause                              | [texto](third-party/zrender-LICENSE)                                                      |
| zustand                     | 5.0.15                         | MIT                                       | [texto](third-party/zustand-LICENSE)                                                      |

## Modelo opcional

Whisper Tiny multilingüe: modelo base openai/whisper-tiny, conversión onnx-community/whisper-tiny. Revisión fijada ff4177021cc41f7db950912b73ea4fdf7d01d8e7; ocho archivos, 43.615.928 bytes. Cada URL y SHA-256 está en packages/model-manager/src/manifest.json. Hashes ONNX tomados de LFS de esa revisión; hashes JSON calculados sobre los archivos obtenidos de ella.

El repositorio original de OpenAI declara MIT para código y pesos; la ficha base en Hugging Face declara Apache-2.0. La conversión consultada identifica el modelo base pero no declara una licencia independiente. Se conservan ambas referencias, compatibles con el uso previsto; los pesos no se redistribuyen en este ZIP.

- [Original y licencia MIT](https://github.com/openai/whisper)
- [Ficha del modelo base](https://huggingface.co/openai/whisper-tiny)
- [Conversión y revisión fijada](https://huggingface.co/onnx-community/whisper-tiny/tree/ff4177021cc41f7db950912b73ea4fdf7d01d8e7)

## Modelos que se descargan solo si los instalas

| Modelo                           | Origen                                                       | Licencia                                                                 |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Whisper Base y Small (ONNX)      | onnx-community/whisper-base y whisper-small, revisión fijada | Modelo original de OpenAI (MIT); ver la ficha de cada conversión         |
| Voces Piper (cinco en español)   | rhasspy/piper-voices, revisión fijada                        | Cada voz tiene su tarjeta de modelo (MODEL_CARD) con su licencia y datos |
| MediaPipe Face y Pose Landmarker | storage.googleapis.com/mediapipe-models                      | Apache-2.0 según la documentación de MediaPipe                           |
| Modelos de Ollama                | Registro de Ollama, instalados por el propio Ollama          | La que informa Ollama en /api/show, visible en Modelos de IA             |

Ningún peso se incluye en el repositorio, el build ni el ZIP.

## Rust y herramientas nativas

Cargo declara Tauri 2/tauri-build 2 (MIT OR Apache-2.0), rusqlite 0.37 (MIT), serde 1, serde_json 1 y uuid 1 (MIT OR Apache-2.0) y sysinfo 0.39 (MIT). Cargo.lock está versionado. En esta entrega se compiló la biblioteca, se ejecutaron sus pruebas y se compiló el binario de Linux en modo depuración; no se distribuye ningún binario.

[Repositorios Tauri](https://github.com/tauri-apps/tauri), [rusqlite](https://github.com/rusqlite/rusqlite), [serde_json](https://github.com/serde-rs/json), [uuid](https://github.com/uuid-rs/uuid), [sysinfo](https://github.com/GuillaumeGomez/sysinfo).

## Elecciones de compatibilidad

Transformers.js 3.8.1 declara onnxruntime-web 1.22.0-dev.20250409-89f8206ba4; se conserva esa pareja y sus archivos WASM. Las voces Piper usan la misma versión, de modo que el build incluye una sola copia del runtime. sharp y onnxruntime-node se excluyen con overrides de pnpm porque son rutas nativas Node que no usa la app de navegador/Tauri. No se ocultan vulnerabilidades ignorando advisories: esas dependencias no forman parte del árbol final. La auditoría es una consulta al registro, no una prueba completa de seguridad.

## Documentación técnica consultada

- [Vite](https://vite.dev/guide/)
- [Tauri configuración](https://v2.tauri.app/reference/config/) y [capacidades](https://v2.tauri.app/security/capabilities/)
- [Transformers.js 3.8.1, modelos propios](https://huggingface.co/docs/transformers.js/v3.8.1/en/custom_usage)
- [ECharts, importación modular](https://echarts.apache.org/handbook/en/basics/import/)
- [pnpm, overrides](https://pnpm.io/settings/dependency-resolution)
- [GitHub Pages, workflows](https://docs.github.com/es/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
