import { DEEPSEEK_API_KEY } from './aiConfig';
import type { ChatMessage } from './OllamaProvider';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const OPENROUTER_VISION_MODELS = [
  'meta-llama/llama-3.2-11b-vision-instruct:free',
  'meta-llama/llama-3.2-90b-vision-instruct:free',
  'qwen/qwen-2.5-vl-7b-instruct:free',
];

/**
 * Stream a vision-capable response from OpenRouter (OpenAI-compatible SSE format).
 * Uses the multi-part content format to pass an image alongside the user text.
 */
export async function streamOpenRouterVision(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  imageBase64: string | null,
  mimeType: string,
  onStart: () => void,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const formattedMessages = messages.map((m, idx) => {
    const isLastUser = idx === messages.length - 1 && m.role === 'user';
    if (isLastUser && imageBase64) {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message ?? `HTTP ${response.status}`);
  }

  onStart();

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
        if (token) onToken(token);
      } catch { /* skip malformed chunks */ }
    }
  }
}
