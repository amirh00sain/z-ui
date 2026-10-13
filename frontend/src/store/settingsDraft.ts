import { create } from 'zustand'

// Cross-component signal for unsaved settings changes: SettingsLayout writes it, the sidebar submenu reads it before switching sections
interface SettingsDraftState {
  dirty: boolean
  setDirty: (dirty: boolean) => void
  /** Registered by SettingsLayout: discards the current draft */
  discard: () => void
  setDiscard: (fn: () => void) => void
}

export const useSettingsDraft = create<SettingsDraftState>((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
  discard: () => {},
  setDiscard: (fn) => set({ discard: fn }),
}))
