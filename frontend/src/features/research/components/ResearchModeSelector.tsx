import { useResearchModeStore } from '../store';
import { RESEARCH_MODE_UI } from '../config';
import './ResearchModeSelector.css';

interface ResearchModeSelectorProps {
  compact?: boolean;
}

export function ResearchModeSelector({ compact = false }: ResearchModeSelectorProps) {
  const { modes, activeMode, setActiveMode } = useResearchModeStore();

  return (
    <div className={`research-mode-selector ${compact ? 'compact' : ''}`}>
      {modes.map((modeConfig) => {
        const ui = RESEARCH_MODE_UI[modeConfig.mode];
        const Icon = ui.icon;
        const isActive = modeConfig.mode === activeMode;

        return (
          <button
            key={modeConfig.mode}
            className={`research-mode-toggle ${modeConfig.mode} ${isActive ? 'active' : ''}`}
            onClick={() => setActiveMode(modeConfig.mode)}
            title={ui.description}
            type="button"
          >
            <Icon size={14} />
            <span className="mode-label">{ui.label}</span>
          </button>
        );
      })}
    </div>
  );
}
