import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { ArrowRight, SkipForward } from 'lucide-react';
import './PromptWizardModal.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardQuestion {
  question: string;
  options: string[];
  placeholder: string;
  contextKey: string;
}

export interface WizardConfig {
  label: string;
  questions: [WizardQuestion, WizardQuestion];
}

export type WizardRole = 'faculty' | 'student' | null;

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

const FACULTY_PATTERNS = [
  /\b(my (course|class|students?|syllabus|curriculum|module|session|seminar|workshop))\b/i,
  /\b(i (teach|am teaching|am designing|am building|am creating|am developing))\b/i,
  /\b(assign(ing|ment for my)|for my students?)\b/i,
  /\b(instructor|professor|faculty|lecturer|educator)\b/i,
  /\b(course (design|material|content|pack|reader))\b/i,
  /\b(pedagogical|pedagogy|learning outcome|learning objective)\b/i,
];

const STUDENT_PATTERNS = [
  /\b(my (assignment|homework|essay|thesis|dissertation|exam|midterm|final|project|paper))\b/i,
  /\b(i (am studying|am taking|need to study|need to read|am preparing|am writing))\b/i,
  /\b(for (my (class|course|degree|major|module|professor|exam|assignment)))\b/i,
  /\b(help me (study|understand|prepare|review|revise))\b/i,
  /\b(my professor|my lecturer|my instructor)\b/i,
  /\b(study (guide|notes|for))\b/i,
];

export function detectRole(message: string): WizardRole {
  if (FACULTY_PATTERNS.some(p => p.test(message))) return 'faculty';
  if (STUDENT_PATTERNS.some(p => p.test(message))) return 'student';
  return null;
}

// ---------------------------------------------------------------------------
// Wizard configs — keyed as `${intent}:${role}` or `${intent}` for faculty-only
// ---------------------------------------------------------------------------

export const WIZARD_CONFIGS: Record<string, WizardConfig> = {

  // --- BUILDER (faculty only) ---
  'builder:faculty': {
    label: 'Builder',
    questions: [
      {
        question: "What's the pedagogical goal?",
        options: [
          'Introduce a real-world dilemma',
          'Illustrate a strategic framework',
          'Spark debate on a contested issue',
          'Show consequences of a decision',
          'Explore a failure or turnaround',
        ],
        placeholder: 'Something else...',
        contextKey: 'Goal',
      },
      {
        question: 'Who is the audience?',
        options: [
          'First-year MBA',
          'Advanced MBA',
          'Executive Education',
          'Undergraduate',
          'Mixed / Open enrolment',
        ],
        placeholder: 'Something else...',
        contextKey: 'Audience',
      },
    ],
  },

  // --- LESSON PLAN (faculty only) ---
  'lesson_plan:faculty': {
    label: 'Lesson Plan',
    questions: [
      {
        question: 'How long is the session?',
        options: ['60 min', '90 min', 'Half day (3 hrs)', 'Full day', 'Multi-session series'],
        placeholder: 'Something else...',
        contextKey: 'Duration',
      },
      {
        question: "What's the primary teaching method?",
        options: [
          'Case discussion',
          'Lecture + Q&A',
          'Group exercise / workshop',
          'Simulation or role-play',
          'Flipped classroom',
        ],
        placeholder: 'Something else...',
        contextKey: 'Method',
      },
    ],
  },

  // --- FIND READINGS: faculty ---
  'find_readings:faculty': {
    label: 'Find Readings',
    questions: [
      {
        question: 'What course level is this for?',
        options: [
          'First-year MBA',
          'Advanced MBA',
          'Executive Education',
          'Undergraduate',
          'PhD seminar',
        ],
        placeholder: 'Something else...',
        contextKey: 'Level',
      },
      {
        question: "What's the reading's purpose in the course?",
        options: [
          'Introduce a concept',
          'Anchor a case discussion',
          'Provide theoretical grounding',
          'Offer a practitioner perspective',
          'Spark debate or critical thinking',
        ],
        placeholder: 'Something else...',
        contextKey: 'Purpose',
      },
    ],
  },

  // --- FIND READINGS: student ---
  'find_readings:student': {
    label: 'Find Readings',
    questions: [
      {
        question: "What's the context for these readings?",
        options: [
          'Weekly reading / prep',
          'Essay or paper research',
          'Exam preparation',
          'Group project',
          'Personal interest / going deeper',
        ],
        placeholder: 'Something else...',
        contextKey: 'Context',
      },
      {
        question: 'What level of depth do you need?',
        options: [
          'Introductory overview',
          'Intermediate — some prior knowledge',
          'Advanced — technical or theoretical',
          'Mix of introductory and advanced',
        ],
        placeholder: 'Something else...',
        contextKey: 'Depth',
      },
    ],
  },

  // --- EXPLAIN: faculty ---
  'explain:faculty': {
    label: 'Explainer',
    questions: [
      {
        question: 'What angle do you need?',
        options: [
          'Conceptual foundations & theory',
          'How to teach this in a classroom',
          'Real-world applications & examples',
          'Connections to other frameworks',
          'Common misconceptions to address',
        ],
        placeholder: 'Something else...',
        contextKey: 'Angle',
      },
      {
        question: 'Who are you explaining this to?',
        options: [
          'First-year MBA students',
          'Advanced MBA students',
          'Executive Education participants',
          'Undergraduate students',
          'Mixed audience',
        ],
        placeholder: 'Something else...',
        contextKey: 'Audience',
      },
    ],
  },

  // --- EXPLAIN: student ---
  'explain:student': {
    label: 'Explainer',
    questions: [
      {
        question: 'How familiar are you with this topic?',
        options: [
          'Complete beginner — start from scratch',
          'I\'ve heard of it but need clarity',
          'I understand basics, need more depth',
          'I need exam-ready precision',
        ],
        placeholder: 'Something else...',
        contextKey: 'Level',
      },
      {
        question: 'What do you need this for?',
        options: [
          'General understanding',
          'Essay or written assignment',
          'Exam preparation',
          'Class discussion or seminar',
          'Research or deeper study',
        ],
        placeholder: 'Something else...',
        contextKey: 'Purpose',
      },
    ],
  },
  'generate_questions:faculty': {
    label: 'Assessment',
    questions: [
      {
        question: "What's the assessment format?",
        options: [
          'In-class discussion',
          'Take-home essay',
          'Timed exam',
          'Group presentation',
          'Participation rubric',
        ],
        placeholder: 'Something else...',
        contextKey: 'Format',
      },
      {
        question: 'What cognitive level should the questions target?',
        options: [
          'Recall & comprehension',
          'Application to new scenarios',
          'Analysis & synthesis',
          'Evaluation & critique',
          'Mixed levels',
        ],
        placeholder: 'Something else...',
        contextKey: 'Level',
      },
    ],
  },

  // --- GENERATE QUESTIONS: student ---
  'generate_questions:student': {
    label: 'Assessment',
    questions: [
      {
        question: 'What are you preparing for?',
        options: [
          'Weekly quiz or check-in',
          'Midterm exam',
          'Final exam',
          'Essay or written assignment',
          'Class discussion or seminar',
        ],
        placeholder: 'Something else...',
        contextKey: 'Preparing for',
      },
      {
        question: 'What cognitive level do you want to practise?',
        options: [
          'Recall & comprehension',
          'Application to scenarios',
          'Critical analysis',
          'All levels mixed',
        ],
        placeholder: 'Something else...',
        contextKey: 'Level',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Intent detection patterns
// ---------------------------------------------------------------------------

const BUILDER_PATTERNS = [
  /\b(build|create|write|draft|develop|construct|generate|produce)\b.{0,40}\bcase stud(y|ies)\b/i,
  /\b(build|create|write|draft|develop|construct|generate|produce|design)\s.{0,30}(syllabus|syllabi|curriculum|curricula|report|proposal|framework|guide|handbook|slides?|deck|presentation|program)\b/i,
  /\bfrom scratch\b/i,
  /\bnew (case|syllabus|curriculum|report|proposal)\b/i,
];

const LESSON_PLAN_PATTERNS = [
  /\blesson plan\b/i,
  /\bteaching (plan|strategy|approach|activity|activities)\b/i,
  /\b(design|create|build|plan|develop)\s.{0,20}(session|workshop|module)\b/i,
  /\bhow (to|would you|should i) teach\b/i,
  /\bclassroom (activity|activities|exercise|discussion)\b/i,
];

const FIND_READINGS_PATTERNS = [
  /\b(find|suggest|recommend|give me|list|what are).{0,20}(readings?|articles?|papers?|books?|texts?)\b/i,
  /\bwhat should i read\b/i,
  /\breading list\b/i,
  /\b(readings?|articles?|papers?|books?) (for|on|about)\b/i,
  /\bsuitable (readings?|texts?|materials?)\b/i,
];

const EXPLAIN_PATTERNS = [
  /\bexplain\b/i,
  /\bwhat (is|are|does)\b.{0,30}\b(mean|work|do)\b/i,
  /\bbreak (it|this|.{0,20}) down\b/i,
  /\bhelp me understand\b/i,
  /\bin (plain|simple|layman|everyday) (terms|language|words)\b/i,
  /\bdefine\b/i,
  /\bhow does .+ work\b/i,
  /\bwhat is .+\?/i,
];

const GENERATE_QUESTIONS_PATTERNS = [
  /\b(generate|create|write|give me|suggest|come up with).{0,20}(questions?|quiz|exam|test|assessment)\b/i,
  /\bquiz me\b/i,
  /\btest me\b/i,
  /\bquestions? (about|on|for|from)\b/i,
  /\bstudy (guide|questions?)\b/i,
  /\bhelp me (study|revise|review|prepare|practise|practice)\b/i,
  /\b(i need to|i want to) (study|revise|review|prepare) (for|on)\b/i,
];

// ---------------------------------------------------------------------------
// Public detection functions
// ---------------------------------------------------------------------------

/** Returns the base intent key (without role suffix). */
export function detectWizardIntent(message: string): string | null {
  if (LESSON_PLAN_PATTERNS.some(p => p.test(message))) return 'lesson_plan';
  if (BUILDER_PATTERNS.some(p => p.test(message))) return 'builder';
  if (FIND_READINGS_PATTERNS.some(p => p.test(message))) return 'find_readings';
  if (GENERATE_QUESTIONS_PATTERNS.some(p => p.test(message))) return 'generate_questions';
  if (EXPLAIN_PATTERNS.some(p => p.test(message))) return 'explain';
  return null;
}

/** Resolve the config key from intent + role. Falls back gracefully. */
export function resolveConfigKey(intent: string, role: WizardRole): string | null {
  // builder and lesson_plan are faculty-only — students don't author course content
  if (intent === 'builder' || intent === 'lesson_plan') {
    if (role === 'student') return null;
    return `${intent}:faculty`;
  }
  // explain, find_readings, generate_questions all have role-diverged configs
  const effectiveRole = role ?? 'faculty';
  const key = `${intent}:${effectiveRole}`;
  return WIZARD_CONFIGS[key] ? key : null;
}

/** Build the enriched message from original + collected answers. */
export function buildEnrichedMessage(
  originalMessage: string,
  configKey: string,
  answers: string[],
): string {
  const config = WIZARD_CONFIGS[configKey];
  if (!config) return originalMessage;

  const contextParts = config.questions
    .map((q, i) => (answers[i] ? `${q.contextKey}: ${answers[i]}` : null))
    .filter(Boolean);

  if (contextParts.length === 0) return originalMessage;
  return `${originalMessage}\n[Context: ${contextParts.join('. ')}]`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PromptWizardModalProps {
  isOpen: boolean;
  configKey: string;           // resolved key e.g. "find_readings:student"
  onComplete: (answers: string[]) => void;
  onSkipStep: () => void;      // skip question, still sends
  onDismiss: () => void;       // backdrop / Escape — cancel entirely
}

export function PromptWizardModal({ isOpen, configKey, onComplete, onSkipStep, onDismiss }: PromptWizardModalProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [customInput, setCustomInput] = useState('');
  const [focusedOption, setFocusedOption] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const config = WIZARD_CONFIGS[configKey];

  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setAnswers(['', '']);
      setCustomInput('');
      setFocusedOption(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setCustomInput('');
      setFocusedOption(-1);
    }
  }, [step, isOpen]);

  if (!isOpen || !config) return null;

  const currentQ = config.questions[step];
  const isLastStep = step === config.questions.length - 1;

  const advance = (answer: string) => {
    const newAnswers = [...answers];
    newAnswers[step] = answer;
    if (isLastStep) {
      onComplete(newAnswers);
    } else {
      setAnswers(newAnswers);
      setStep(step + 1);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onDismiss(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedOption(prev => Math.min(prev + 1, currentQ.options.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedOption(prev => Math.max(prev - 1, -1));
    }
    if (e.key === 'Enter' && focusedOption >= 0) {
      e.preventDefault();
      advance(currentQ.options[focusedOption]);
    }
  };

  return (
    <div className="wizard-overlay" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="wizard-backdrop" onClick={onDismiss} />
      <div className="wizard-modal" role="dialog" aria-modal="true">
        <div className="wizard-progress">
          {config.questions.map((_, i) => (
            <div key={i} className={`wizard-progress-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        <p className="wizard-question">{currentQ.question}</p>

        <div className="wizard-options">
          {currentQ.options.map((option, i) => (
            <button
              key={option}
              className={`wizard-option ${focusedOption === i ? 'focused' : ''}`}
              onClick={() => advance(option)}
              onMouseEnter={() => setFocusedOption(i)}
            >
              <span className="wizard-option-num">{i + 1}</span>
              <span>{option}</span>
            </button>
          ))}
        </div>

        <div className="wizard-custom">
          <div className="wizard-custom-input-row">
            <input
              ref={inputRef}
              type="text"
              className="wizard-custom-input"
              placeholder={currentQ.placeholder}
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && customInput.trim()) {
                  e.preventDefault();
                  advance(customInput.trim());
                }
              }}
            />
            {customInput.trim() && (
              <button className="wizard-custom-submit" onClick={() => advance(customInput.trim())}>
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="wizard-footer">
          <button className="wizard-skip-btn" onClick={onSkipStep}>
            <SkipForward size={13} />
            <span>{isLastStep ? 'Skip & send' : 'Skip'}</span>
          </button>
          <span className="wizard-hint">↑↓ navigate · Enter select · Esc cancel</span>
        </div>
      </div>
    </div>
  );
}
