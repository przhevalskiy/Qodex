import { Target, Radar, Compass } from 'lucide-react';
import type { ResearchMode } from '@/shared/types';

export interface ResearchModeUIConfig {
  icon: typeof Target;
  label: string;
  description: string;
}

export const RESEARCH_MODE_UI: Record<ResearchMode, ResearchModeUIConfig> = {
  quick: {
    icon: Target,
    label: 'Focused',
    description: 'Searches for most relevant sources',
  },
  enhanced: {
    icon: Radar,
    label: 'Broad',
    description: 'Broader search across more sources',
  },
  deep: {
    icon: Compass,
    label: 'Exploratory',
    description: 'Widest search for exhaustive analysis',
  },
};
