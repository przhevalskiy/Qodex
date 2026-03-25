import { Zap, Telescope, Atom } from 'lucide-react';
import type { ResearchMode } from '@/shared/types';

export interface ResearchModeUIConfig {
  icon: typeof Search;
  label: string;
  description: string;
  rangeLabel: string;
}

export const RESEARCH_MODE_UI: Record<ResearchMode, ResearchModeUIConfig> = {
  quick: {
    icon: Zap,
    label: 'Quick',
    description: 'Searches for most relevant sources',
    rangeLabel: 'up to 7',
  },
  enhanced: {
    icon: Telescope,
    label: 'Enhanced',
    description: 'Broader search across more sources',
    rangeLabel: 'up to 12',
  },
  deep: {
    icon: Atom,
    label: 'Deep Research',
    description: 'Widest search for exhaustive analysis',
    rangeLabel: 'up to 16',
  },
};
