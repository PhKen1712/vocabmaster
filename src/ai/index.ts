import type { AiProvider } from '../types';
import {
  checkApiKey as checkGeminiKey,
  defaultModel as defaultGeminiModel,
  generateVocabulary as generateGeminiVocabulary,
  normalizeModel,
  resetGenerationState,
  REQUEST_TIMEOUT_MS,
} from './gemini';
import {
  checkGroqKey,
  defaultGroqModel,
  generateVocabularyGroq,
  normalizeGroqModel,
  resetGroqGenerationState,
} from './groq';
import type { AiRequest, AiResult, GenerateOptions, KeyCheck } from './types';

/**
 * One entry point for the screens: which HTTP API is called depends on the
 * provider the learner picked in Settings, never on a hidden global.
 */
export async function generateVocabulary(
  request: AiRequest,
  options: GenerateOptions = {},
): Promise<AiResult> {
  return (options.provider ?? 'gemini') === 'groq'
    ? generateVocabularyGroq(request, options)
    : generateGeminiVocabulary(request, options);
}

/** Check a key + model without spending content tokens. */
export async function checkProviderKey(
  provider: AiProvider,
  model: string,
): Promise<KeyCheck> {
  return provider === 'groq' ? checkGroqKey(model) : checkGeminiKey(model);
}

export function defaultModelFor(provider: AiProvider): string {
  return provider === 'groq' ? defaultGroqModel() : defaultGeminiModel();
}

/** Normalise a model name the way its provider expects. */
export function normalizeModelFor(provider: AiProvider, model: string): string {
  return provider === 'groq' ? normalizeGroqModel(model) : normalizeModel(model);
}

/** Test-only: clear the single-flight state of both providers. */
export function resetAiState(): void {
  resetGenerationState();
  resetGroqGenerationState();
}

export { REQUEST_TIMEOUT_MS };
export {
  clearProviderKey,
  hasProviderKey,
  loadProviderKey,
  PROVIDER_INFO,
  providerLabel,
  saveProviderKey,
} from './provider';
export type { GenerateOptions, KeyCheck } from './types';
