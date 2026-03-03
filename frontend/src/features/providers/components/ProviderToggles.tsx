import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useProviderStore } from '../store';
import { ProviderName } from '@/shared/types';
import './ProviderToggles.css';

interface ProviderTogglesProps {
  selectedProvider?: ProviderName;
  onProviderChange?: (name: ProviderName) => void;
}

export function ProviderToggles({ selectedProvider, onProviderChange }: ProviderTogglesProps = {}) {
  const { providers, activeProvider, setActiveProvider } = useProviderStore();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const currentProvider = selectedProvider || activeProvider;
  const handleProviderChange = onProviderChange || setActiveProvider;
  const activeProviderObj = providers.find(p => p.name === currentProvider);
  const displayName = currentProvider === 'auto' ? 'Auto' : (activeProviderObj?.display_name ?? 'Model');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="provider-inline" ref={wrapperRef}>
      {open && (
        <div className="provider-inline-dropdown">
          <button
            className={`provider-inline-option ${currentProvider === 'auto' ? 'active' : ''}`}
            onClick={() => { handleProviderChange('auto'); setOpen(false); }}
          >
            <span>Auto</span>
            {currentProvider === 'auto' && <Check size={13} strokeWidth={2.5} />}
          </button>
          <div className="provider-inline-divider" />
          {providers.map((provider) => {
            const isActive = provider.name === currentProvider;
            return (
              <button
                key={provider.name}
                className={`provider-inline-option ${isActive ? 'active' : ''}`}
                onClick={() => { handleProviderChange(provider.name); setOpen(false); }}
                disabled={!provider.configured}
              >
                <span>{provider.display_name}</span>
                {isActive && <Check size={13} strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      )}

      <button
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
