import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import './PromptWizardModal.css';

interface WizardQuestion {
  question: string;
  options: string[];
  placeholder: string;
  contextKey: string;
}

interface WizardConfig {
  label: string;
  questions: [WizardQuestion, WizardQuestion];
}

const RESEARCH_PATTERNS = [
  /\bpr request\b/i, /\bpress release\b/i, /\bpitch\b/i, /\bthought leadership\b/i,
  /\bop.?ed\b/i, /\bbyline\b/i, /\bsecure (coverage|placement)\b/i,
  /\bget (coverage|a story|press)\b/i, /\bwant (coverage|press|to pitch)\b/i,
];

const EVENT_PATTERNS = [
  /\bevent\b/i, /\blaunch (event|party)\b/i, /\bproduct launch\b/i,
  /\bconference\b/i, /\bwebinar\b/i, /\bsummit\b/i, /\bpanel\b/i,
  /\bspeaking (engagement|slot)\b/i,
];

const MEDIA_PATTERNS = [
  /\bmedia kit\b/i, /\bpress kit\b/i, /\bboilerplate\b/i,
  /\bfact sheet\b/i, /\bspokesperson bio\b/i, /\bheadshot\b/i,
];

export function detectWizardIntent(message: string): string | null {
  if (RESEARCH_PATTERNS.some(p => p.test(message))) return 'research';
  if (EVENT_PATTERNS.some(p => p.test(message))) return 'event';
  if (MEDIA_PATTERNS.some(p => p.test(message))) return 'media';
  return null;
}

const WIZARD_CONFIGS: Record<string, WizardConfig> = {
  research: {
    label: 'Research & PR',
    questions: [
      {
        question: "What's the story angle or key message?",
        options: [
          'Company milestone or announcement',
          'Product launch or feature update',
          'Executive thought leadership',
          'Research or data findings',
          'Partnership or collaboration',
        ],
        placeholder: 'Describe the angle...',
        contextKey: 'Story Angle',
      },
      {
        question: 'Who is the target audience or outlet type?',
        options: [
          'Trade / industry press',
          'National business media',
          'Tech publications',
          'Local / regional news',
          'Podcast or broadcast',
        ],
        placeholder: 'Specific outlet or audience...',
        contextKey: 'Target Outlets',
      },
    ],
  },

  event: {
    label: 'Event Communications',
    questions: [
      {
        question: 'What type of event is this?',
        options: [
          'Product launch',
          'Conference or summit',
          'Webinar or virtual event',
          'Media briefing or press day',
          'Customer or partner event',
        ],
        placeholder: 'Describe the event...',
        contextKey: 'Event Type',
      },
      {
        question: 'What communications assets do you need?',
        options: [
          'Press release',
          'Media invite and talking points',
          'Social media copy',
          'Executive briefing materials',
          'Post-event recap',
        ],
        placeholder: 'Describe the deliverables...',
        contextKey: 'Deliverables',
      },
    ],
  },

  other: {
    label: 'Communications Request',
    questions: [
      {
        question: 'What type of communications project is this?',
        options: [
          'Internal communications',
          'Executive messaging',
          'Crisis or issues management',
          'Content and thought leadership',
          'Brand and awareness campaign',
        ],
        placeholder: 'Describe the project type...',
        contextKey: 'Project Type',
      },
      {
        question: 'What is the primary audience for this request?',
        options: [
          'Employees / internal',
          'Customers / prospects',
          'Media / press',
          'Investors / analysts',
          'Partners / ecosystem',
        ],
        placeholder: 'Describe the audience...',
        contextKey: 'Audience',
      },
    ],
  },
};

interface PromptWizardModalProps {
  isOpen: boolean;
  intent: string;
  originalMessage: string;
  onComplete: (enriched: string) => void;
  onDismiss: () => void;
}

export function PromptWizardModal({ isOpen, intent, originalMessage, onComplete, onDismiss }: PromptWizardModalProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [customInput, setCustomInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const config = WIZARD_CONFIGS[intent] || WIZARD_CONFIGS['other'];

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setAnswers(['', '']);
      setCustomInput('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, step]);

  if (!isOpen || !config) return null;

  const currentQ = config.questions[step];
  const currentAnswer = answers[step];

  const handleOptionSelect = (option: string) => {
    const newAnswers = [...answers];
    newAnswers[step] = option;
    setAnswers(newAnswers);
    setCustomInput('');
  };

  const handleCustomChange = (val: string) => {
    setCustomInput(val);
    const newAnswers = [...answers];
    newAnswers[step] = val;
    setAnswers(newAnswers);
  };

  const canAdvance = currentAnswer.trim().length > 0;

  const handleNext = () => {
    if (!canAdvance) return;
    if (step < 1) {
      setStep(1);
      setCustomInput('');
    } else {
      // Build enriched message
      const parts = [originalMessage];
      config.questions.forEach((q, i) => {
        if (answers[i]?.trim()) {
          parts.push(`${q.contextKey}: ${answers[i].trim()}`);
        }
      });
      onComplete(parts.join('\n'));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleNext();
    if (e.key === 'Escape') onDismiss();
  };

  return (
    <div className="wizard-overlay" onClick={onDismiss}>
      <div className="wizard-modal" onClick={e => e.stopPropagation()}>
        <div className="wizard-header">
          <span className="wizard-label">{config.label}</span>
          <span className="wizard-step">{step + 1} of 2</span>
        </div>

        <div className="wizard-progress">
          <div className="wizard-progress-bar" style={{ width: `${(step + 1) * 50}%` }} />
        </div>

        <p className="wizard-question">{currentQ.question}</p>

        <div className="wizard-options">
          {currentQ.options.map((opt) => (
            <button
              key={opt}
              className={`wizard-option ${currentAnswer === opt ? 'selected' : ''}`}
              onClick={() => handleOptionSelect(opt)}
            >
              {opt}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          className="wizard-custom-input"
          type="text"
          placeholder={currentQ.placeholder}
          value={customInput}
          onChange={e => handleCustomChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="wizard-actions">
          <button className="wizard-skip" onClick={onDismiss}>Skip</button>
          <button
            className="wizard-next"
            onClick={handleNext}
            disabled={!canAdvance}
          >
            {step < 1 ? 'Next' : 'Send'}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
