import { DEEPSEEK_API_KEY } from './aiConfig';
import type { ChatMessage } from './OllamaProvider';

const DEEPSEEK_BASE = 'https://openrouter.ai/api/v1';

/** Fallback model list if the API fetch fails */
export const DEEPSEEK_MODELS = ['deepseek/deepseek-r1-0528:free'];

/**
 * Fetch available DeepSeek models from OpenRouter.
 * Filters to only deepseek/ models, falling back to DEEPSEEK_MODELS on error.
 */
export async function fetchDeepSeekModels(): Promise<string[]> {
  try {
    const response = await fetch(`${DEEPSEEK_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
    });
    if (!response.ok) return DEEPSEEK_MODELS;
    const data = await response.json();
    const ids: string[] = (data.data ?? [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => id.startsWith('deepseek/'))
      .sort();
    return ids.length > 0 ? ids : DEEPSEEK_MODELS;
  } catch {
    return DEEPSEEK_MODELS;
  }
}

/**
 * Stream a response from the DeepSeek API (OpenAI-compatible SSE format).
 * onStart  — called just before the first content token (skips reasoning phase)
 * onToken  — called for each streamed content token
 */
export async function streamDeepSeek(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onStart: () => void,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message ?? `HTTP ${response.status}`);
  }

  // Don't call onStart() immediately — defer until the first real content token
  // so the ThinkingIndicator keeps cycling through DeepSeek R1's reasoning phase.
  let started = false;

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const token = JSON.parse(jsonStr).choices?.[0]?.delta?.content ?? '';
        if (token) {
          if (!started) { onStart(); started = true; }
          onToken(token);
        }
      } catch { /* skip malformed chunks */ }
    }
  }
}
