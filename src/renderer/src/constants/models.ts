export interface ModelOption {
  value: string
  label: string
}

export interface ModelGroup {
  group: string
  models: ModelOption[]
}

export const MODEL_GROUPS: ModelGroup[] = [
  {
    group: 'OpenAI',
    models: [
      { value: 'gpt-4o',      label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'o1',          label: 'o1' },
      { value: 'o1-mini',     label: 'o1-mini' },
      { value: 'o3-mini',     label: 'o3-mini' },
    ],
  },
  {
    group: 'Anthropic (via GitHub Models)',
    models: [
      { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku' },
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
