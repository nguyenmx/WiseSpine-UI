# Chatbot

AI chat panel embedded in the WiseSpine OHIF viewer. Supports multiple model providers and automatically attaches the active viewport image to every message.

---

## File Overview

| File | Purpose |
|---|---|
| `ChatController.tsx` | Root component. Owns message history, streaming state, and send routing. |
| `ChatInput.tsx` | Textarea, send button, voice button, and image preview row. |
| `ThinkingIndicator.tsx` | Animated cycling text shown while the model is generating. |
| `VoiceInput.tsx` | Microphone button using the Web Speech API (continuous, interim results). |
| `imageCapture.ts` | Captures the active OHIF viewport canvas (+ SVG annotation overlays) as a JPEG base64 string. Also handles dragged image sources. |
| `useDragDrop.ts` | Hook that manages drag-over state and resolves dropped images from files, HTML, or OHIF thumbnail drag events. |
| `useModelSelector.ts` | Hook that fetches available models on mount, manages the selected model, filter (All / Vision / Text), and exposes provider-type flags. |
| `viewportContext.ts` | Shared bridge between `WiseSpineLayoutComponent` and `ChatController`. The layout writes DICOM metadata here; the chat reads it to build the system prompt. |

---

## Model Providers

Providers live in `../models/` and are selected at send time based on the active model name:

| Provider | Detection | Capability |
|---|---|---|
| `GeminiProvider` | `gemini-` prefix | Vision + text via Google Generative Language API |
| `DeepSeekProvider` | `deepseek-` / `deepseek/` prefix | Text only via OpenRouter |
| `OllamaProvider` | anything else | Vision + text via local Ollama instance (`localhost:11434`) |

API keys are read from environment variables in `../models/aiConfig.ts` (`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`).

---

## Image Attachment

For vision-capable models (Gemini, Ollama), an image is attached to every outgoing message:

1. **Explicit override** — user drags an image file or OHIF thumbnail onto the chat panel. The image is shown as a preview thumbnail; clicking × reverts to auto-capture.
2. **Auto-capture** — `imageCapture.ts` finds the largest canvas in the DOM, composites any SVG annotation overlays on top, and returns the result as a JPEG data URL.

The captured image is stored in the message object as `imageDataUrl` and rendered inside the assistant's reply bubble so the user can see what was sent.

---

## Viewport Context

`WiseSpineLayoutComponent` calls `setViewportMeta()` whenever the active viewport changes, passing DICOM fields (patient age/sex, modality, body part, study/series description, date). `ChatController` reads this via `getViewportMeta()` and appends it to the system prompt so the model has clinical context without the user having to describe the study manually.

---

## Adding a New Model Provider

1. Create `../models/YourProvider.ts` exporting a `streamYourProvider(model, messages, systemPrompt, onStart, onToken, signal)` function.
2. Add detection logic to `useModelSelector.ts` (e.g. `isYourProvider = selectedModel.startsWith('your-prefix')`).
3. Add the fetch call for available models inside the `useEffect` in `useModelSelector.ts`.
4. Add a routing branch in `ChatController.tsx`'s `handleSend`.
