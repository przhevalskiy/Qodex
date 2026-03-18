import { SampleQuestion } from '../types/sampleQuestions';

// Sample questions organized by intent — each main entry maps to a specific
// response mode, and sub-questions are ready-to-send example prompts.
export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    // → Explainer intent
    main: "Explain a concept in plain terms",
    subQuestions: [
      { text: "Explain carbon pricing mechanisms in simple terms" },
      { text: "Break down how project finance works for renewable energy" },
      { text: "What is additionality and why does it matter for carbon credits?" },
      { text: "Simplify scope 1, 2, and 3 emissions for a non-technical audience" }
    ]
  },
  {
    // → Summary intent
    main: "Summarize & synthesize my sources",
    subQuestions: [
      { text: "Summarize the key findings across my uploaded documents" },
      { text: "What are the main themes in my syllabi?" },
      { text: "Give me a high-level overview of climate adaptation frameworks in my sources" },
      { text: "What gaps exist in my current course materials?" }
    ]
  },
  {
    // → Case Analysis intent
    main: "Show me a real-world case study",
    subQuestions: [
      { text: "Frame this document as a case study with stakeholders and outcomes" },
      { text: "What are the key challenges in this renewable energy scenario?" },
      { text: "Analyze how this climate policy was implemented in practice" },
      { text: "What lessons can be drawn from this case for future projects?" }
    ]
  },
  {
    // → Assessment intent
    main: "Generate assessment questions",
    subQuestions: [
      { text: "Create Bloom's Taxonomy questions from my uploaded materials" },
      { text: "Build a quiz on carbon markets and climate finance" },
      { text: "Generate discussion questions for a graduate seminar" },
      { text: "Design analytical essay prompts based on my course readings" }
    ]
  },
  {
    // → Lesson Plan intent
    main: "Design a lesson plan or teaching resource",
    subQuestions: [
      { text: "Create a lesson plan on climate adaptation for graduate students" },
      { text: "Design classroom activities around carbon pricing mechanisms" },
      { text: "Build a discussion guide for a renewable energy case" },
      { text: "Suggest learning objectives and assessments for an ESG course module" }
    ]
  },
  {
    // → Critique intent
    main: "Critique this research or argument",
    subQuestions: [
      { text: "What are the methodological strengths and weaknesses of this paper?" },
      { text: "Identify gaps and biases in this climate policy analysis" },
      { text: "What counterarguments exist to the claims in my sources?" },
      { text: "How should a reader calibrate confidence in these findings?" }
    ]
  },
  {
    // → Builder intent
    main: "Build a full document from scratch",
    subQuestions: [
      { text: "Build a full case study on renewable energy project finance modeled after my sources" },
      { text: "Draft a complete syllabus for a graduate climate finance course" },
      { text: "Write a policy proposal on carbon credit reform from scratch" },
      { text: "Create a full report on ESG integration frameworks based on my documents" }
    ]
  },
];
