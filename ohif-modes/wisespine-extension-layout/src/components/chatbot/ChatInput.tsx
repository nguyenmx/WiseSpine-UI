import React, { useState, useRef, useEffect } from 'react';
import VoiceInput from './VoiceInput';

interface ChatInputProps {
  supportsImages: boolean;
  previewDataUrl: string | null;
  onClearPreview: () => void;
  isLoading: boolean;
  inputText: string;
  onInputChange: (text: string) => void;
  onSend: () => void;
  onError: (msg: string) => void;
  selectedModel: string;
}

export default function ChatInput({
  supportsImages,
  previewDataUrl,
  onClearPreview,
  isLoading,
  inputText,
  onInputChange,
  onSend,
  onError,
  selectedModel,
}: ChatInputProps) {
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  return (
    <div className="border-t border-gray-700 p-2">
      {/* Image context row — Gemini and Ollama vision models */}
      {supportsImages && (
        <div className="mb-1 flex items-center gap-2">
          {previewDataUrl ? (
            // User dragged/uploaded a specific image — show preview with clear button
            <div className="relative">
              <img src={previewDataUrl} alt="Override image" className="h-10 w-10 rounded border border-blue-500 object-cover" title="Custom image — overrides auto-capture" />
              <button
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-600 text-xs text-white hover:bg-red-600"
                onClick={onClearPreview}
                title="Remove — revert to auto-capture"
              >
                ×
              </button>
            </div>
          ) : (
            // Auto mode: viewport is captured on every send
            <span className="text-xs text-gray-500">📎 Viewport auto-attached • drag image to override</span>
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
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />

        <div className="absolute bottom-2 right-2 flex items-center gap-1" style={{ zIndex: 2 }}>
          <VoiceInput
            onTranscript={onInputChange}
            onError={onError}
            onListeningChange={setIsVoiceListening}
            disabled={isLoading}
          />

          {/* Send button */}
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onSend}
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
  );
}
