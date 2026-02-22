import React, { useState, useEffect, useRef } from 'react';
import { GEMINI_API_KEY, DEEPSEEK_API_KEY } from './aiConfig';
import { fetchOllamaModels, streamOllama } from './OllamaProvider';
import { DEEPSEEK_MODELS, streamDeepSeek } from './DeepSeekProvider';
import type { ChatMessage } from './OllamaProvider';
import VoiceInput from './VoiceInput';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT =
  'You are a clinical assistant embedded in a spine imaging viewer. ' +
  'Answer questions about radiology findings, spinal anatomy, pathology, and patient imaging clearly and concisely. ' +
  'If asked something unrelated to medicine or imaging, politely redirect the conversation back to clinical topics.';

type Message = ChatMessage & { imageDataUrl?: string };

// Capture the src of any data-URL img being dragged (OHIF thumbnails)
let _lastDraggedImageSrc: string | null = null;
document.addEventListener('dragstart', e => {
  const el = e.target as HTMLElement;
  const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
  _lastDraggedImageSrc = img && img.src.startsWith('data:image') ? img.src : null;
});

function getViewportDataUrl(): string | null {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  if (canvases.length === 0) return null;
  const largest = canvases.reduce((a, b) => a.width * a.height >= b.width * b.height ? a : b);
  if (largest.width === 0 || largest.height === 0) return null;
  return largest.toDataURL('image/jpeg', 0.85);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatController() {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachImage, setAttachImage] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Fetch Ollama models on mount; fall back to cloud models if unavailable
  useEffect(() => {
    fetchOllamaModels()
      .then(names => {
        setOllamaModels(names);
        if (names.length > 0) setSelectedModel(names[0]);
        else if (DEEPSEEK_API_KEY) setSelectedModel(DEEPSEEK_MODELS[0]);
        else if (GEMINI_API_KEY) setSelectedModel(GEMINI_MODEL);
      })
      .catch(() => {
        if (DEEPSEEK_API_KEY) setSelectedModel(DEEPSEEK_MODELS[0]);
        else if (GEMINI_API_KEY) setSelectedModel(GEMINI_MODEL);
      });
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, isLoading]);

  const isGemini = selectedModel.startsWith('gemini-');
  const isDeepSeek = selectedModel.startsWith('deepseek-');
  const isOllama = !isGemini && !isDeepSeek;
  const supportsImages = isGemini || isOllama;

  // --- Drag and drop ---
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const imageFile = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (imageFile) { setPreviewDataUrl(await readFileAsDataUrl(imageFile)); setAttachImage(true); return; }
    const html = e.dataTransfer.getData('text/html');
    if (html) {
      const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
      if (img?.src?.startsWith('data:image')) { setPreviewDataUrl(img.src); setAttachImage(true); return; }
    }
    if (_lastDraggedImageSrc) { setPreviewDataUrl(_lastDraggedImageSrc); setAttachImage(true); _lastDraggedImageSrc = null; }
  };

  // --- Shared streaming helpers ---

  // Appends a token to the last message in state (used as onToken callback)
  const appendToken = (token: string) => {
    setMessages(prev => {
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        content: updated[updated.length - 1].content + token,
      };
      return updated;
    });
  };

  // Adds the empty assistant bubble and stops the "thinking" spinner (used as onStart callback)
  const onStreamStart = () => {
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setIsLoading(false);
  };

  // --- Gemini streaming (inline — not extracted, stays here as it handles image data) ---
  const streamGemini = async (
    nextMessages: Message[],
    imageBase64: string | null,
    mimeType: string
  ) => {
    const contents = nextMessages.map((m, idx) => {
      const isLastUser = idx === nextMessages.length - 1 && m.role === 'user';
      const parts: any[] = [{ text: m.content }];
      if (isLastUser && imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });

    const response = await fetch(
      `${GEMINI_BASE}/${selectedModel}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 8192 },
        }),
      }
    );
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message ?? `HTTP ${response.status}`);
    }

    onStreamStart();

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
          if (token) appendToken(token);
        } catch { /* skip */ }
      }
    }
  };

  // --- Main send handler (routes to the correct provider) ---
  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !selectedModel || isLoading) return;

    let imageDataUrl: string | null = null;
    let mimeType = 'image/jpeg';
    if (supportsImages && attachImage) {
      if (previewDataUrl) {
        imageDataUrl = previewDataUrl;
        const match = previewDataUrl.match(/^data:(image\/\w+);base64,/);
        if (match) mimeType = match[1];
      } else {
        imageDataUrl = getViewportDataUrl();
      }
    }

    const imageBase64 = imageDataUrl ? imageDataUrl.split(',')[1] : null;
    const userMessage: Message = { role: 'user', content: trimmed, ...(imageDataUrl ? { imageDataUrl } : {}) };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setIsLoading(true);
    setError(null);

    try {
      if (isGemini) {
        await streamGemini(nextMessages, imageBase64, mimeType);
      } else if (isDeepSeek) {
        await streamDeepSeek(selectedModel, nextMessages, SYSTEM_PROMPT, onStreamStart, appendToken);
      } else {
        await streamOllama(selectedModel, nextMessages, SYSTEM_PROMPT, onStreamStart, appendToken, imageBase64);
      }
    } catch (err: any) {
      setError(`Failed to get response: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const allModels = ollamaModels.length > 0 || DEEPSEEK_API_KEY || GEMINI_API_KEY;

  return (
    <div
      className="relative flex h-full flex-col bg-black text-white"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-blue-900/40">
          <span className="text-sm font-semibold text-blue-200">Drop image to attach</span>
        </div>
      )}

      {/* Model selector */}
      <div className="border-b border-gray-700 p-2">
        <select
          className="w-full rounded bg-white px-2 py-1 text-sm text-black"
          value={selectedModel}
          onChange={e => { setSelectedModel(e.target.value); setMessages([]); setError(null); }}
          disabled={!allModels}
        >
          {!allModels && <option value="">No models available</option>}
          {ollamaModels.length > 0 && (
            <optgroup label="Local (Ollama)">
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          )}
          {DEEPSEEK_API_KEY && (
            <optgroup label="DeepSeek">
              {DEEPSEEK_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          )}
          {GEMINI_API_KEY && (
            <optgroup label="Gemini">
              <option value={GEMINI_MODEL}>{GEMINI_MODEL}</option>
            </optgroup>
          )}
        </select>
      </div>

      {/* Message history */}
      <div ref={messagesContainerRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {messages.length === 0 && !error && (
          <div className="mt-4 text-center text-xs">
            {selectedModel ? (
              <span className="text-green-400">✓ {selectedModel} ready</span>
            ) : (
              <span className="text-red-400">No models available.</span>
            )}
            <p className="mt-1 text-gray-500">Ask anything about your patient or imaging findings.</p>
            {isGemini && (
              <p className="mt-1 text-gray-600">Drag a thumbnail from the left panel to attach it.</p>
            )}
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  backgroundColor: isUser ? '#0c1c4d' : '#1f2937',
                  color: isUser ? '#ffffff' : '#f3f4f6',
                  borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.875rem',
                }}
              >
                {!isUser && (
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af', marginBottom: '0.25rem' }}>
                    {selectedModel}
                  </div>
                )}
                {msg.imageDataUrl && (
                  <img
                    src={msg.imageDataUrl}
                    alt="Attached image"
                    className="mb-1 max-h-32 rounded border border-gray-600 object-contain"
                  />
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ backgroundColor: '#1f2937', color: '#9ca3af', borderRadius: '1rem 1rem 1rem 0.25rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem' }}>{selectedModel}</div>
              <span>Thinking...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded bg-red-900 p-2 text-sm text-red-200">{error}</div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-700 p-2">
        {/* Attach image row — Gemini and Ollama vision models */}
        {supportsImages && (
          <div className="mb-1 flex items-center gap-2">
            <button
              className={`rounded px-2 py-0.5 text-xs ${attachImage ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              onClick={() => {
                const next = !attachImage;
                setAttachImage(next);
                if (next) setPreviewDataUrl(getViewportDataUrl());
                else setPreviewDataUrl(null);
              }}
              title="Attach current viewport image, or drag a thumbnail from the left panel"
            >
              {attachImage ? '📎 Image attached' : '📎 Attach image'}
            </button>
            {previewDataUrl && (
              <div className="relative">
                <img src={previewDataUrl} alt="Preview" className="h-10 w-10 rounded border border-gray-600 object-cover" />
                <button
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-600 text-xs text-white hover:bg-red-600"
                  onClick={() => { setPreviewDataUrl(null); setAttachImage(false); }}
                  title="Remove attached image"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}
        <div
          className="relative rounded-xl border bg-gray-800 transition-all"
          style={isVoiceListening
            ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.25)' }
            : { borderColor: '#4b5563' }
          }
        >
          <textarea
            ref={textareaRef}
            className="w-full resize-none bg-transparent px-3 py-2 pb-10 text-sm text-white placeholder-gray-500 focus:outline-none"
            rows={3}
            placeholder={isVoiceListening ? '' : 'Ask a question... (Enter to send, Shift+Enter for newline)'}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />

          <div className="absolute bottom-2 right-2 flex items-center gap-1" style={{ zIndex: 2 }}>
            <VoiceInput
              onTranscript={setInputText}
              onError={msg => setError(msg)}
              onListeningChange={setIsVoiceListening}
              disabled={isLoading}
            />

            {/* Send button */}
            <button
              className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleSend}
              disabled={isLoading || !inputText.trim() || !selectedModel}
              title="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
