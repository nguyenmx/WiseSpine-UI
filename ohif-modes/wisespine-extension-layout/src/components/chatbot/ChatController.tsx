/**
 * ChatController is the main component for the chatbot panel. 
 * It manages the conversation state, handles user input
 * and interfaces with the AI providers.
 
 * 1. Captures the viewport and attaches it to the user message.
 * 2. Routes to the correct AI provider based on the selected model.
 * 3. Streams the response token by token into the chat bubble.
 * 4. Renders the message history, model selector, and input bar.
 */
import React, { useState, useEffect, useRef } from 'react';
import { streamOllama } from '../models/OllamaProvider';
import { streamDeepSeek } from '../models/DeepSeekProvider';
import { GEMINI_MODELS, streamGemini } from '../models/GeminiProvider';
import { getViewportMeta, formatViewportMeta } from './viewportContext';
import type { ChatMessage } from '../models/OllamaProvider';
import ThinkingIndicator from './ThinkingIndicator';
import ChatInput from './ChatInput';
import { useDragDrop } from './useDragDrop';
import { resolveMessageImage } from './resolveImage';
import { useModelSelector } from './useModelSelector';

// Clinical base prompt — appended with live DICOM metadata from viewportContext on every send
const BASE_PROMPT =
  'You are a clinical assistant embedded in a spine imaging viewer. ' +
  'Answer questions about radiology findings, spinal anatomy, pathology, and patient imaging clearly and concisely. ' +
  'If asked something unrelated to medicine or imaging, politely redirect the conversation back to clinical topics.';

const getSystemPrompt = () => BASE_PROMPT + formatViewportMeta(getViewportMeta());

type Message = ChatMessage & { imageDataUrl?: string };

export default function ChatController() {
  // Model list, selection, filter chips, and provider-type flags
  const {
    ollamaModels,
    deepSeekModels,
    modelFilter,
    selectedModel,
    setSelectedModel,
    isGemini,
    isDeepSeek,
    supportsImages,
    showOllama,
    showDeepSeek,
    showGemini,
    allModels,
    handleFilterChange,
  } = useModelSelector();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null); // explicit image override
  const [error, setError] = useState<string | null>(null);
  const { isDragOver, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(setPreviewDataUrl);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null); // lets us cancel in-flight requests

  // Keep the message list scrolled to the bottom
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, isLoading]);

  // Appends each streamed token to the last (assistant) bubble
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

  // Called once the provider confirms the request — adds the empty assistant bubble
  const onStreamStart = () => {
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setIsLoading(false);
  };

  // Resolves the image, builds the user message, then routes to the correct provider
  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed || !selectedModel || isLoading) return;

    const { imageDataUrl, imageBase64, mimeType } = await resolveMessageImage(supportsImages, previewDataUrl);
    const userMessage: Message = { role: 'user', content: trimmed, ...(imageDataUrl ? { imageDataUrl } : {}) };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setIsLoading(true);
    setError(null);

    const abort = new AbortController();
    abortControllerRef.current = abort;

    try {
      if (isGemini) {
        await streamGemini(selectedModel, nextMessages, getSystemPrompt(), imageBase64, mimeType, onStreamStart, appendToken, abort.signal);
      } else if (isDeepSeek) {
        await streamDeepSeek(selectedModel, nextMessages, getSystemPrompt(), onStreamStart, appendToken, abort.signal);
      } else {
        await streamOllama(selectedModel, nextMessages, getSystemPrompt(), onStreamStart, appendToken, imageBase64, abort.signal);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(`Failed to get response: ${err.message}`);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-black text-white"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Shown when the user drags an image over the panel */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-blue-900/40">
          <span className="text-sm font-semibold text-blue-200">Drop image to attach</span>
        </div>
      )}

      {/* Model selector — filter chips + dropdown */}
      <div className="border-b border-gray-700 p-2">
        <div className="mb-1.5 flex gap-1">
          {(['all', 'vision', 'text'] as const).map(f => (
            <button
              key={f}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${modelFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'}`}
              onClick={() => handleFilterChange(f)}
            >
              {f === 'all' ? 'All' : f === 'vision' ? '🖼 Vision' : '💬 Text'}
            </button>
          ))}
        </div>
        {/* Switching model aborts any in-flight request and clears the conversation */}
        <select
          className="w-full rounded bg-white px-2 py-1 text-sm text-black"
          value={selectedModel}
          onChange={e => {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            setSelectedModel(e.target.value);
            setMessages([]);
            setError(null);
            setIsLoading(false);
          }}
          disabled={!allModels}
        >
          {!allModels && <option value="">No models available</option>}
          {showOllama && (
            <optgroup label="Local (Ollama) — Vision">
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          )}
          {showDeepSeek && (
            <optgroup label="DeepSeek — Text">
              {deepSeekModels.map(m => <option key={m} value={m}>{m}</option>)}
            </optgroup>
          )}
          {showGemini && (
            <optgroup label="Gemini — Vision">
              {GEMINI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
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
          // Show the captured image inside the assistant bubble so the user can see what was sent
          const contextImage = !isUser ? (messages[i - 1] as Message | undefined)?.imageDataUrl : undefined;
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
                {contextImage && (
                  <img
                    src={contextImage}
                    alt="Viewport capture"
                    style={{ display: 'block', maxWidth: '100%', maxHeight: '180px', borderRadius: '0.375rem', border: '1px solid #374151', objectFit: 'contain', marginBottom: '0.5rem' }}
                  />
                )}
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              </div>
            </div>
          );
        })}

        {/* Thinking indicator shown while waiting for the first token */}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ backgroundColor: '#1f2937', color: '#9ca3af', borderRadius: '1rem 1rem 1rem 0.25rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.25rem' }}>{selectedModel}</div>
              <ThinkingIndicator />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded bg-red-900 p-2 text-sm text-red-200">{error}</div>
        )}
      </div>

      {/* Input bar — textarea, voice button, send button, image preview */}
      <ChatInput
        supportsImages={supportsImages}
        previewDataUrl={previewDataUrl}
        onClearPreview={() => setPreviewDataUrl(null)}
        isLoading={isLoading}
        inputText={inputText}
        onInputChange={setInputText}
        onSend={handleSend}
        onError={msg => setError(msg)}
        selectedModel={selectedModel}
      />
    </div>
  );
}
