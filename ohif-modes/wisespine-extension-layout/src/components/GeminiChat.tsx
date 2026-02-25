import React, { useState, useEffect, useRef } from 'react';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT =
  'You are a clinical assistant embedded in a spine imaging viewer. ' +
  'Answer questions about radiology findings, spinal anatomy, pathology, and patient imaging clearly and concisely. ' +
  'If asked something unrelated to medicine or imaging, politely redirect the conversation back to clinical topics.';

const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

type Message = {
  role: 'user' | 'model';
  content: string;
};

export default function GeminiChat() {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem('gemini_api_key') || (process.env.GEMINI_API_KEY as string) || ''
  );
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const saveApiKey = () => {
    const key = apiKeyInput.trim();
    if (!key) return;
    localStorage.setItem('gemini_api_key', key);
    setApiKey(key);
    setApiKeyInput('');
  };

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !apiKey || isLoading) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setIsLoading(true);
    setError(null);

    try {
      const contents = nextMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));

      const response = await fetch(
        `${GEMINI_BASE}/${selectedModel}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { maxOutputTokens: 512 },
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message ?? `HTTP ${response.status}`);
      }

      setMessages(prev => [...prev, { role: 'model', content: '' }]);
      setIsLoading(false);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(jsonStr);
            const token = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            if (token) {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'model',
                  content: updated[updated.length - 1].content + token,
                };
                return updated;
              });
            }
          } catch {
            // skip malformed chunk
          }
        }
      }
    } catch (err: any) {
      setError(`Failed to get response: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // API key entry screen
  // if (!apiKey) {
  //   return (
  //     <div className="flex h-full flex-col items-center justify-center gap-3 bg-black p-4 text-white">
  //       <p className="text-center text-sm text-gray-400">
  //         Enter your Gemini API key to start chatting.
  //       </p>
  //       <input
  //         type="password"
  //         className="w-full rounded bg-white px-2 py-1 text-sm text-black placeholder-gray-400 focus:outline-none"
  //         placeholder="AIza..."
  //         value={apiKeyInput}
  //         onChange={e => setApiKeyInput(e.target.value)}
  //         onKeyDown={e => { if (e.key === 'Enter') saveApiKey(); }}
  //         autoFocus
  //       />
  //       <button
  //         className="rounded bg-blue-700 px-4 py-1 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
  //         onClick={saveApiKey}
  //         disabled={!apiKeyInput.trim()}
  //       >
  //         Save Key
  //       </button>
  //     </div>
  //   );
  // }

  // return (
  //   <div className="flex h-full flex-col bg-black text-white">
  //     {/* Model selector + reset key */}
  //     <div className="flex items-center gap-2 border-b border-gray-700 p-2">
  //       <select
  //         className="flex-1 rounded bg-white px-2 py-1 text-sm text-black"
  //         value={selectedModel}
  //         onChange={e => setSelectedModel(e.target.value)}
  //       >
  //         {MODELS.map(m => (
  //           <option key={m} value={m}>{m}</option>
  //         ))}
  //       </select>
  //       <button
  //         className="text-xs text-gray-500 hover:text-gray-300"
  //         onClick={() => { localStorage.removeItem('gemini_api_key'); setApiKey(''); }}
  //         title="Reset API key"
  //       >
  //         Reset key
  //       </button>
  //     </div>

  return (
    <div className="flex h-full flex-col bg-black text-white">
      {/* Message history */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {messages.length === 0 && !error && (
          <div className="mt-4 text-center text-xs">
            <span className="text-green-400">✓ {selectedModel} ready</span>
            <p className="mt-1 text-gray-500">Ask anything about your patient or imaging findings.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded p-2 text-sm ${
              msg.role === 'user'
                ? 'ml-4 bg-blue-900 text-white'
                : 'mr-4 bg-gray-800 text-gray-100'
            }`}
          >
            <div className="mb-1 text-xs font-semibold text-gray-400">
              {msg.role === 'user' ? 'You' : selectedModel}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}

        {isLoading && (
          <div className="mr-4 rounded bg-gray-800 p-2 text-sm text-gray-400">
            <div className="mb-1 text-xs font-semibold">{selectedModel}</div>
            <span>Thinking...</span>
          </div>
        )}

        {error && (
          <div className="rounded bg-red-900 p-2 text-sm text-red-200">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 p-2">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none rounded bg-white px-2 py-1 text-sm text-black placeholder-gray-400 focus:outline-none"
            rows={3}
            placeholder="Ask a question... (Enter to send, Shift+Enter for newline)"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            className="self-end rounded bg-blue-700 px-3 py-1 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSend}
            disabled={isLoading || !inputText.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
