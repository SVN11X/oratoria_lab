import type { ChatMessage } from '@oratoria/defense';

export type LlmConfig = { enabled: boolean; baseUrl: string; model: string; apiKey: string };
export const LLM_PRESETS = [
  {
    id: 'ollama',
    name: 'Ollama en tu computador (gratis y privado)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    needsKey: false,
    help: 'Instala Ollama desde ollama.com y ejecuta una vez «ollama pull qwen2.5:7b». Funciona sin internet y tus textos no salen del equipo. Necesita unos 6 GB de RAM libres.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio en tu computador',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
    help: 'Abre LM Studio, carga un modelo y activa el servidor local. Escribe el nombre del modelo tal como aparece en LM Studio.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini (tiene nivel gratuito)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    needsKey: true,
    help: 'Crea una clave en Google AI Studio. El texto de tu exposición y tus respuestas se envía a Google.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    needsKey: true,
    help: 'Requiere una clave de API con saldo. Escribe un modelo disponible en tu cuenta. El texto se envía a OpenAI.',
  },
  {
    id: 'custom',
    name: 'Otro servicio compatible con OpenAI',
    baseUrl: '',
    model: '',
    needsKey: false,
    help: 'Cualquier servicio que acepte el formato «chat/completions» de OpenAI.',
  },
] as const;
function friendly(status: number, body: string): string {
  if (status === 401 || status === 403) return 'El servicio rechazó la clave. Revísala o crea una nueva.';
  if (status === 404) return 'No se encontró el modelo o la dirección. Revisa ambos campos.';
  if (status === 429)
    return 'El servicio indica que superaste su límite de uso. Espera un momento o cambia de modelo.';
  return `El servicio respondió con un error (${status}). ${body.slice(0, 160)}`;
}
export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
  timeoutMs = 60000,
) {
  if (!config.baseUrl.trim() || !config.model.trim())
    throw new Error('Falta la dirección o el modelo del examinador con IA.');
  const url = `${config.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal && 'any' in AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
  const send = (json: boolean) =>
    fetch(url, {
      method: 'POST',
      signal: combined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        temperature: 0.6,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  let response: Response;
  try {
    response = await send(true);
    if (response.status === 400) response = await send(false);
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw new Error('El examinador con IA tardó demasiado en responder.');
    throw new Error(
      'No se pudo conectar con el examinador con IA. Revisa que el servicio esté encendido, la dirección y que acepte solicitudes desde esta página.',
    );
  }
  if (!response.ok) throw new Error(friendly(response.status, await response.text().catch(() => '')));
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('El servicio respondió sin texto.');
  return text;
}
export async function testLlm(config: LlmConfig): Promise<string> {
  const text = await chat(
    config,
    [
      { role: 'system', content: 'Responde solo con JSON válido.' },
      { role: 'user', content: 'Saluda a un estudiante en una frase. Formato: {"saludo":"..."}' },
    ],
    undefined,
    30000,
  );
  return text.slice(0, 200);
}
