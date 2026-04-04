export interface ModelOption {
  value: string
  label: string
}

export interface ModelGroup {
  group: string
  models: ModelOption[]
}

/** Models available via the GitHub Copilot SDK. */
export const MODEL_GROUPS: ModelGroup[] = [
  {
    group: 'OpenAI (via Copilot)',
    models: [
      { value: 'gpt-4o',              label: 'GPT-4o' },
      { value: 'gpt-4o-mini',         label: 'GPT-4o Mini' },
      { value: 'gpt-4.1',             label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini',        label: 'GPT-4.1 Mini' },
      { value: 'o1',                  label: 'o1' },
      { value: 'o1-mini',             label: 'o1-mini' },
      { value: 'o3',                  label: 'o3' },
      { value: 'o3-mini',             label: 'o3-mini' },
      { value: 'o4-mini',             label: 'o4-mini' },
    ],
  },
  {
    group: 'Anthropic (via Copilot)',
    models: [
      { value: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5' },
      { value: 'claude-sonnet-4',     label: 'Claude Sonnet 4' },
      { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    group: 'Google (via Copilot)',
    models: [
      { value: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash' },
      { value: 'gemini-2.5-pro',      label: 'Gemini 2.5 Pro' },
    ],
  },
]

export const ALL_KNOWN_VALUES = MODEL_GROUPS.flatMap(g => g.models.map(m => m.value))
export const CUSTOM_SENTINEL  = '__custom__'

/** Return the display label for a model value, or the value itself if custom. */
export function modelLabel(value: string): string {
  for (const g of MODEL_GROUPS) {
    const found = g.models.find(m => m.value === value)
    if (found) return found.label
  }
  return value || 'Select model'
}

/** Models that support the reasoningEffort parameter. */
export const REASONING_MODELS = new Set([
  'o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini',
  'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-3-7-sonnet-20250219',
  'gemini-2.5-pro',
])
