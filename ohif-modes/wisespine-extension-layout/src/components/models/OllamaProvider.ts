const OLLAMA_BASE = 'http://localhost:11434';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export async function fetchOllamaModels(): Promise<string[]> {
  const data = await fetch(`${OLLAMA_BASE}/api/tags`).then(r => r.json());
  return (data.models ?? []).map((m: any) => m.name);
}

/**
 * Stream a response from Ollama.
 * onStart      — called once the HTTP 200 arrives (before first token)
 * onToken      — called for each streamed token
 * imageBase64  — optional raw base64 image (no data-URL prefix) attached to the last user message
 *                for vision-capable models such as mistral-small3.1, llava, moondream, etc.
 */
export async function streamOllama(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  onStart: () => void,
  onToken: (token: string) => void,
  imageBase64?: string | null,
  signal?: AbortSignal
): Promise<void> {
  const formattedMessages = messages.map((m, idx) => {
    const isLastUser = idx === messages.length - 1 && m.role === 'user';
    if (isLastUser && imageBase64) {
      return { role: m.role, content: m.content, images: [imageBase64] };
    }
    return { role: m.role, content: m.content };
  });

  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages],
      stream: true,
      options: { num_predict: 2048, num_ctx: 4096 },
    }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  onStart();

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        const token = JSON.parse(line).message?.content ?? '';
        if (token) onToken(token);
      } catch { /* skip malformed chunks */ }
    }
  }
}
