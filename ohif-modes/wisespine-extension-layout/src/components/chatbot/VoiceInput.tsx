/** No npm packages used — relies on two browser-native Web APIs:
 *  navigator.mediaDevices.getUserMedia  (microphone permission prompt)
 * window.SpeechRecognition / webkitSpeechRecognition  (speech-to-text)
 * Supported in Chrome/Edge; Firefox does not support the Web Speech API.
 */

import React, { useState, useEffect, useRef } from 'react';

interface Props {
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
  onListeningChange?: (listening: boolean) => void;
  disabled?: boolean;
}

export default function VoiceInput({
  onTranscript,
  onError,
  onListeningChange,
  disabled,
}: Props) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Notify parent when listening state changes
  useEffect(() => {
    onListeningChange?.(isListening);
  }, [isListening, onListeningChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  const toggleListening = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    try {
      // getUserMedia triggers the browser's permission prompt on first call
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop()); // only needed for the permission prompt
    } catch {
      onError('Microphone access denied. Please allow microphone access in your browser settings.');
      return;
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      onError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;      // keep listening through pauses
    recognition.interimResults = true;  // show words in real time as they're spoken
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (e: any) => {
      // Concatenate all results (final + interim) accumulated so far
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      onTranscript(transcript);
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'aborted') onError(`Speech recognition error: ${e.error}`);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  };

  return (
    <>
      <style>{`@keyframes mic-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>

      {/* Microphone button */}
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          isListening
            ? 'bg-red-600 text-white hover:bg-red-500'
            : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
        }`}
        onClick={toggleListening}
        disabled={disabled}
        title={isListening ? 'Stop listening' : 'Speak your message'}
        style={isListening ? { animation: 'mic-pulse 1.2s ease-in-out infinite' } : {}}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" />
          <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z" />
        </svg>
      </button>
    </>
  );
}
