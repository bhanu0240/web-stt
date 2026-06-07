/**
 * Embedding examples for the UI (semantic search / reindex). ASR picks combine
 * Hub `listModels` (@huggingface/hub), `inference=warm`, and this fallback list.
 */
export type ShowcaseModel = {
  id: string;
  /** Short human-readable name for search and display. */
  label: string;
  /** When true, Hub reports inference provider mapping (likely works with @huggingface/inference). */
  hostedInference?: boolean;
  /** Hub download count when available (used for sort only). */
  downloads?: number;
};

/**
 * Static ASR list when the Hub warm-inference catalog cannot be fetched.
 * Kept to Whisper + Distil families that usually have inference provider metadata.
 */
export const HF_ASR_FALLBACK_MODELS: ShowcaseModel[] = [
  { id: 'openai/whisper-large-v3', label: 'Whisper Large v3 (OpenAI)' },
  { id: 'openai/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (OpenAI)' },
  { id: 'openai/whisper-large-v2', label: 'Whisper Large v2 (OpenAI)' },
  { id: 'openai/whisper-medium', label: 'Whisper Medium (OpenAI)' },
  { id: 'openai/whisper-small', label: 'Whisper Small (OpenAI)' },
  { id: 'openai/whisper-base', label: 'Whisper Base (OpenAI)' },
  { id: 'openai/whisper-tiny', label: 'Whisper Tiny (OpenAI)' },
  { id: 'distil-whisper/distil-large-v3', label: 'Distil-Whisper Large v3' },
  { id: 'distil-whisper/distil-large-v2', label: 'Distil-Whisper Large v2' },
  { id: 'distil-whisper/distil-medium.en', label: 'Distil-Whisper Medium (English)' },
  { id: 'distil-whisper/distil-small.en', label: 'Distil-Whisper Small (English)' },
];

/** Embedding models suitable for semantic search / reindex in this project. */
export const HF_EMBED_SHOWCASE_MODELS: ShowcaseModel[] = [
  { id: 'intfloat/multilingual-e5-small', label: 'multilingual-e5-small' },
  { id: 'intfloat/multilingual-e5-base', label: 'multilingual-e5-base' },
  { id: 'intfloat/multilingual-e5-large', label: 'multilingual-e5-large' },
  { id: 'sentence-transformers/all-MiniLM-L6-v2', label: 'all-MiniLM-L6-v2' },
  { id: 'BAAI/bge-small-en-v1.5', label: 'bge-small-en-v1.5' },
  { id: 'BAAI/bge-base-en-v1.5', label: 'bge-base-en-v1.5' },
];
