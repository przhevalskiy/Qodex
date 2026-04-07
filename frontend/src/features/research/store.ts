import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResearchMode, ResearchModeConfig } from '@/shared/types';
import { api } from '@/shared/services/api';

interface ResearchModeState {
  modes: ResearchModeConfig[];
  activeMode: ResearchMode;
  defaultMode: ResearchMode;
  isLoading: boolean;
  error: string | null;
}

interface ResearchModeActions {
  fetchModes: () => Promise<void>;
  setActiveMode: (mode: ResearchMode) => void;
  getActiveModeConfig: () => ResearchModeConfig | undefined;
  clearError: () => void;
}

type ResearchModeStore = ResearchModeState & ResearchModeActions;

// Default modes (fallback if API is unavailable)
const DEFAULT_MODES: ResearchModeConfig[] = [
  { mode: 'quick', label: 'Focused', description: 'Searches for the most directly relevant sources', top_k: 7, is_default: true },
  { mode: 'enhanced', label: 'Broad', description: 'Wider search including adjacent and related sources', top_k: 12, is_default: false },
  { mode: 'deep', label: 'Exploratory', description: 'Widest search for open-ended discovery and analysis', top_k: 20, is_default: false },
];

export const useResearchModeStore = create<ResearchModeStore>()(
  persist(
    (set, get) => ({
      // State
      modes: DEFAULT_MODES,
      activeMode: 'quick',
      defaultMode: 'quick',
      isLoading: false,
      error: null,

      // Actions
      fetchModes: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.getResearchModes();
          set({
            modes: response.modes,
            defaultMode: response.default,
            isLoading: false,
          });
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
          // Keep using default modes on error
        }
      },

      setActiveMode: (mode: ResearchMode) => {
        set({ activeMode: mode });
      },

      getActiveModeConfig: () => {
        const state = get();
        return state.modes.find(m => m.mode === state.activeMode);
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'qodex-research-mode-store',
      partialize: (state) => ({ activeMode: state.activeMode }),
    }
  )
);
