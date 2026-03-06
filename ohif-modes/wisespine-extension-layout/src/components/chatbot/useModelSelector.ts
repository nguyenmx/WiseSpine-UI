import { useState, useEffect } from 'react';
import { GEMINI_API_KEY, DEEPSEEK_API_KEY } from '../models/aiConfig';
import { fetchOllamaModels } from '../models/OllamaProvider';
import { DEEPSEEK_MODELS, fetchDeepSeekModels } from '../models/DeepSeekProvider';
import { GEMINI_MODELS } from '../models/GeminiProvider';

export type ModelFilter = 'all' | 'vision' | 'text';

export function useModelSelector() {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [deepSeekModels, setDeepSeekModels] = useState<string[]>(DEEPSEEK_MODELS);
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (DEEPSEEK_API_KEY) return DEEPSEEK_MODELS[0];
    if (GEMINI_API_KEY) return GEMINI_MODELS[0];
    return '';
  });

  // Fetch available models on mount; fall back to cloud models if Ollama is unavailable
  useEffect(() => {
    if (DEEPSEEK_API_KEY) {
      fetchDeepSeekModels().then(setDeepSeekModels);
    }

    fetchOllamaModels()
      .then(names => {
        setOllamaModels(names);
        if (names.length > 0) setSelectedModel(names[0]);
        else if (DEEPSEEK_API_KEY) setSelectedModel(DEEPSEEK_MODELS[0]);
        else if (GEMINI_API_KEY) setSelectedModel(GEMINI_MODELS[0]);
      })
      .catch(() => {
        if (DEEPSEEK_API_KEY) setSelectedModel(DEEPSEEK_MODELS[0]);
        else if (GEMINI_API_KEY) setSelectedModel(GEMINI_MODELS[0]);
      });
  }, []);

  const isGemini = selectedModel.startsWith('gemini-');
  const isDeepSeek = selectedModel.startsWith('deepseek-') || selectedModel.startsWith('deepseek/');
  const isOllama = !isGemini && !isDeepSeek;
  const supportsImages = isGemini || isOllama;

  const showOllama = modelFilter !== 'text' && ollamaModels.length > 0;
  const showDeepSeek = modelFilter !== 'vision' && !!DEEPSEEK_API_KEY;
  const showGemini = modelFilter !== 'text' && !!GEMINI_API_KEY;
  const allModels = showOllama || showDeepSeek || showGemini;

  const handleFilterChange = (f: ModelFilter) => {
    setModelFilter(f);
    const nextShowOllama = f !== 'text' && ollamaModels.length > 0;
    const nextShowDeepSeek = f !== 'vision' && !!DEEPSEEK_API_KEY;
    const nextShowGemini = f !== 'text' && !!GEMINI_API_KEY;
    const selIsOllama = !selectedModel.startsWith('gemini-') && !selectedModel.startsWith('deepseek-') && !selectedModel.startsWith('deepseek/');
    const selIsDeepSeek = selectedModel.startsWith('deepseek-') || selectedModel.startsWith('deepseek/');
    const selIsGemini = selectedModel.startsWith('gemini-');
    const stillVisible = (selIsOllama && nextShowOllama) || (selIsDeepSeek && nextShowDeepSeek) || (selIsGemini && nextShowGemini);
    if (!stillVisible) {
      if (nextShowOllama) setSelectedModel(ollamaModels[0]);
      else if (nextShowDeepSeek) setSelectedModel(deepSeekModels[0]);
      else if (nextShowGemini) setSelectedModel(GEMINI_MODELS[0]);
    }
  };

  return {
    ollamaModels,
    deepSeekModels,
    modelFilter,
    selectedModel,
    setSelectedModel,
    isGemini,
    isDeepSeek,
    isOllama,
    supportsImages,
    showOllama,
    showDeepSeek,
    showGemini,
    allModels,
    handleFilterChange,
  };
}
