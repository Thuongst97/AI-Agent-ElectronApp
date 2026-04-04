import { create } from 'zustand'
import { AppSettings, AppStatus, DEFAULT_SETTINGS } from '@shared/ipc-types'

interface SettingsState {
  settings:    AppSettings
  status:      AppStatus | null
  isLoaded:    boolean

  loadSettings: ()                           => Promise<void>
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  refreshStatus: ()                          => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings:  DEFAULT_SETTINGS,
  status:    null,
  isLoaded:  false,

  loadSettings: async () => {
    const settings = await window.electronAPI.getSettings()
    set({ settings, isLoaded: true })
  },

  saveSettings: async (partial) => {
    await window.electronAPI.setSettings(partial)
    const settings = await window.electronAPI.getSettings()
    set({ settings })
  },

  refreshStatus: async () => {
    const status = await window.electronAPI.getStatus()
    set({ status })
  },
}))
