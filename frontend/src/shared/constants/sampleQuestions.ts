import { SampleQuestion } from '../types/sampleQuestions';

// Sample questions for educators with nested sub-questions
// Contextually related to climate education and syllabus design
export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    main: "Summarize key themes across my syllabi",
    subQuestions: [
      { text: "What topics appear most frequently?" },
      { text: "Compare learning objectives across courses" },
      { text: "Identify gaps in topic coverage" },
      { text: "Extract common reading assignments" }
    ]
  },
  {
    main: "Help me design a lesson plan on climate topics",
    subQuestions: [
      { text: "Create learning objectives for carbon markets" },
      { text: "Suggest classroom activities for climate adaptation" },
      { text: "Design a case study discussion on renewable energy" },
      { text: "Build an assessment rubric for sustainability projects" }
    ]
  },
  {
    main: "Find case studies on sustainable finance",
    subQuestions: [
      { text: "Real-world examples of green bond issuance" },
      { text: "ESG integration case studies for class" },
      { text: "Climate risk assessment scenarios" },
      { text: "Stakeholder analysis for energy transition" }
    ]
  },
  {
    main: "Generate assessment questions from my documents",
    subQuestions: [
      { text: "Create recall and comprehension questions" },
      { text: "Design analytical essay prompts" },
      { text: "Build a quiz on climate policy frameworks" },
      { text: "Generate discussion questions for seminars" }
    ]
  },
  {
    main: "Explain a complex climate concept for students",
    subQuestions: [
      { text: "Break down carbon pricing mechanisms" },
      { text: "Simplify climate modeling approaches" },
      { text: "Explain the Paris Agreement framework" },
      { text: "Describe scope 1, 2, and 3 emissions" }
    ]
  },
];
