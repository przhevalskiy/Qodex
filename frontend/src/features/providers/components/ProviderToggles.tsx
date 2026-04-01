import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check, Rocket, Flame, Feather } from 'lucide-react';
import { useProviderStore } from '../store';
import { ProviderName } from '@/shared/types';
import './ProviderToggles.css';

interface ProviderTogglesProps {
  selectedProvider?: ProviderName;
  onProviderChange?: (name: ProviderName) => void;
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  auto: 'Picks the best model for your query automatically.',
  mistral: 'Fast and efficient — great for quick lookups and summaries.',
  claude: 'Precise and thorough — best for deep analysis and writing.',
};

const TOOLTIP_WIDTH = 260;

export function ProviderToggles({ selectedProvider, onProviderChange }: ProviderTogglesProps = {}) {
  const { providers, activeProvider, setActiveProvider } = useProviderStore();
  const [open, setOpen] = useState(false);
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const [tooltipSide, setTooltipSide] = useState<'right' | 'left'>('right');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentProvider = selectedProvider || activeProvider;
  const handleProviderChange = onProviderChange || setActiveProvider;
  const activeProviderObj = providers.find(p => p.name === currentProvider);
  const displayName = currentProvider === 'auto' ? 'Auto' : (activeProviderObj?.display_name ?? 'Model');

  const providerIcon = (name: string) => {
    if (name === 'auto') return <Rocket size={13} strokeWidth={2} />;
    if (name === 'mistral') return <Flame size={13} strokeWidth={2} />;
    if (name === 'claude') return <Feather size={13} strokeWidth={2} />;
    return null;
  };

  const checkTooltipSide = useCallback(() => {
    if (!dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    setTooltipSide(spaceRight >= TOOLTIP_WIDTH + 12 ? 'right' : 'left');
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) checkTooltipSide();
  }, [open, checkTooltipSide]);

  const renderOption = (name: string, label: string, isActive: boolean, disabled = false) => (
    <div
      key={name}
      className="provider-inline-option-wrapper"
      onMouseEnter={() => setHoveredOption(name)}
      onMouseLeave={() => setHoveredOption(null)}
    >
      <button
        type="button"
        className={`provider-inline-option ${isActive ? 'active' : ''}`}
        onClick={() => { handleProviderChange(name as ProviderName); setOpen(false); }}
        disabled={disabled}
      >
        <span className="provider-inline-option-label">{providerIcon(name)}<span>{label}</span></span>
        {isActive && <Check size={13} strokeWidth={2.5} />}
      </button>
      {hoveredOption === name && PROVIDER_DESCRIPTIONS[name] && (
        <div className={`provider-inline-tooltip provider-inline-tooltip--${tooltipSide}`}>
          {PROVIDER_DESCRIPTIONS[name]}
        </div>
      )}
    </div>
  );

  return (
    <div className="provider-inline" ref={wrapperRef}>
      {open && (
        <div className="provider-inline-dropdown" ref={dropdownRef}>
          {renderOption('auto', 'Auto', currentProvider === 'auto')}
          <div className="provider-inline-divider" />
          {providers.map((provider) =>
            renderOption(provider.name, provider.display_name, provider.name === currentProvider, !provider.configured)
          )}
        </div>
      )}

      <button
        type="button"
        className={`provider-inline-toggle ${open ? 'open' : ''} ${currentProvider === 'auto' ? 'auto' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Switch AI model"
      >
        <span>{displayName}</span>
        <ChevronDown size={13} strokeWidth={2.5} className={`provider-chevron ${open ? 'flipped' : ''}`} />
      </button>
    </div>
  );
}
