import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Provider, ProviderName } from '@/shared/types';
import { api } from '@/shared/services/api';

interface ProviderState {
  providers: Provider[];
  activeProvider: ProviderName;
  isLoading: boolean;
  error: string | null;
}

interface ProviderActions {
  fetchProviders: () => Promise<void>;
  setActiveProvider: (name: ProviderName) => void;
  isProviderConfigured: (name: ProviderName) => boolean;
  getActiveProviderInfo: () => Provider | undefined;
  clearError: () => void;
}

type ProviderStore = ProviderState & ProviderActions;

const DEFAULT_PROVIDERS: Provider[] = [
  { name: 'mistral', display_name: 'Mistral', model: 'mistral-large-latest', configured: false },
  { name: 'claude', display_name: 'Claude', model: 'claude-sonnet-4-5-20250929', configured: false },
];

export const useProviderStore = create<ProviderStore>()(
  persist(
    (set, get) => ({
      // State
      providers: DEFAULT_PROVIDERS,
      activeProvider: 'auto',
      isLoading: false,
      error: null,

      // Actions
      fetchProviders: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.getProviders();
          set({
            providers: response.providers,
            isLoading: false,
          });

          // Set first configured provider as active if current is not configured.
          // Don't touch 'auto' — it's a valid selection that doesn't need a configured key.
          const state = get();
          if (state.activeProvider !== 'auto') {
            const currentActive = response.providers.find(p => p.name === state.activeProvider);
            if (!currentActive?.configured) {
              const firstConfigured = response.providers.find(p => p.configured);
              if (firstConfigured) {
                set({ activeProvider: firstConfigured.name });
              }
            }
          }
        } catch (error) {
          set({ error: (error as Error).message, isLoading: false });
        }
      },

      setActiveProvider: (name: ProviderName) => {
        if (name === 'auto') {
          set({ activeProvider: 'auto' });
          return;
        }
        const state = get();
        const provider = state.providers.find(p => p.name === name);
        if (provider?.configured) {
          set({ activeProvider: name });
        } else {
          set({ error: `Provider ${name} is not configured` });
        }
      },

      isProviderConfigured: (name: ProviderName) => {
        const state = get();
        return state.providers.find(p => p.name === name)?.configured || false;
      },

      getActiveProviderInfo: () => {
        const state = get();
        return state.providers.find(p => p.name === state.activeProvider);
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'qodex-provider-store',
      partialize: () => ({}),
    }
  )
);
