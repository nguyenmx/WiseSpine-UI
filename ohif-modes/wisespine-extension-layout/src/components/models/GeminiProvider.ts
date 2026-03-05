import { GEMINI_API_KEY } from './aiConfig';
import type { ChatMessage } from './OllamaProvider';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
];

/**
 * Stream a response from the Gemini API (SSE format).
 * Supports optional image attachment via inline_data on the last user message.
 * onStart — called once the HTTP 200 arrives (before first token)
 * onToken — called for each streamed content token
 */
export async function streamGemini(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  imageBase64: string | null,
  mimeType: string,
  onStart: () => void,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const contents = messages.map((m, idx) => {
    const isLastUser = idx === messages.length - 1 && m.role === 'user';
    const parts: any[] = [{ text: m.content }];
    if (isLastUser && imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

  const response = await fetch(
    `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { maxOutputTokens: 8192 },
      }),
    }
  );

  if (!response.ok) {
    const errData = await response.json();
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
        const token = JSON.parse(jsonStr).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (token) onToken(token);
      } catch { /* skip malformed chunks */ }
    }
  }
}
