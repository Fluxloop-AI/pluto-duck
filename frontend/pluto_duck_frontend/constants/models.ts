export type LocalModelOption = {
  id: string;
  label: string;
  repoId: string;
  filename: string;
  description?: string;
  quantization?: string;
};

export const REMOTE_MODEL_OPTIONS = [
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
];

export const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: 'qwen3-8b-q4_k_m',
    label: 'Qwen3 8B (local, Q4_K_M)',
    repoId: 'Qwen/Qwen3-8B-GGUF',
    filename: 'Qwen3-8B-Q4_K_M.gguf',
    description: '8B 베이스 모델 GGUF (약 5GB) - 기본 테스트용 로컬 모델',
    quantization: 'Q4_K_M',
  },
];

export const LOCAL_MODEL_OPTION_MAP = LOCAL_MODEL_OPTIONS.reduce<
  Record<string, LocalModelOption>
>((acc, option) => {
  acc[option.id] = option;
  return acc;
}, {});

export const ALL_MODEL_OPTIONS = [
  ...REMOTE_MODEL_OPTIONS,
  ...LOCAL_MODEL_OPTIONS.map(option => ({
    id: `local:${option.id}`,
    name: option.label,
  })),
];

