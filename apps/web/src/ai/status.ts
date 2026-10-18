import { useEffect, useState } from 'react';
import { useAi } from './settings';
import { ollama } from './llm';

export type AiStatus = {
  llm: 'ok' | 'off' | 'error' | 'missing';
  llmText: string;
  stt: 'local' | 'online' | 'escrito';
  sttText: string;
};
/**
 * Estado resumido para la barra lateral. Solo consulta Ollama si la IA está activada: con la
 * configuración inicial la app no hace ninguna solicitud de red.
 */
export function useAiStatus(): AiStatus {
  const useLlm = useAi((s) => s.useLlm),
    provider = useAi((s) => s.provider),
    ollamaUrl = useAi((s) => s.ollamaUrl),
    model = useAi((s) => s.assign.conversacion),
    openaiModel = useAi((s) => s.openai.model),
    sttEngine = useAi((s) => s.stt);
  const [llm, setLlm] = useState<AiStatus['llm']>('off');
  useEffect(() => {
    if (!useLlm) {
      setLlm('off');
      return;
    }
    if (provider === 'openai') {
      setLlm(openaiModel ? 'ok' : 'missing');
      return;
    }
    let alive = true;
    const check = () =>
      ollama({ ollamaUrl })
        .list()
        .then(
          (l) =>
            alive &&
            setLlm(
              !model
                ? 'missing'
                : l.some((m) => m.name === model || m.name === `${model}:latest`)
                  ? 'ok'
                  : 'missing',
            ),
        )
        .catch(() => alive && setLlm('error'));
    void check();
    const timer = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [useLlm, provider, ollamaUrl, model, openaiModel]);
  const llmText =
    llm === 'off'
      ? 'Interlocutores por reglas'
      : llm === 'ok'
        ? `Modelo: ${provider === 'openai' ? openaiModel : model}`
        : llm === 'missing'
          ? 'Falta asignar un modelo'
          : 'Ollama no responde';
  const stt: AiStatus['stt'] =
    sttEngine === 'escrito' ? 'escrito' : sttEngine === 'navegador' ? 'online' : 'local';
  const sttText =
    stt === 'escrito'
      ? 'Respuestas escritas'
      : stt === 'online'
        ? 'Voz: reconocimiento del navegador'
        : 'Voz: transcripción local';
  return { llm, llmText, stt, sttText };
}
