import './WhatWeBuild.css';

const services = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 6h16M3 11h10M3 16h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        <circle cx="17" cy="16" r="3" stroke="currentColor" strokeWidth="1.6"/>
      </svg>
    ),
    title: 'RAG Knowledge Systems',
    description:
      'Proprietary knowledge bases that let your team query documents, research, and institutional data in natural language — with source attribution and zero hallucination risk on in-domain content.',
    tags: ['Pinecone', 'Embeddings', 'Vector Search'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 11c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        <path d="M11 18v-4M8 17l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="11" cy="11" r="2" stroke="currentColor" strokeWidth="1.6"/>
      </svg>
    ),
    title: 'Agentic Workflows',
    description:
      'Multi-step AI pipelines that reason, retrieve, and act without human intervention at each step. From intent classification to tool-calling to structured output — fully orchestrated.',
    tags: ['LLM Orchestration', 'Tool Calling', 'Streaming'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
        <rect x="12" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
        <rect x="3" y="12" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
        <rect x="12" y="12" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
      </svg>
    ),
    title: 'Domain-Specific Intelligence',
    description:
      'AI systems tuned to your vertical — your language, your documents, your logic. We build the prompt architecture, retrieval strategy, and context injection that makes generalist models perform like specialists.',
    tags: ['Prompt Engineering', 'Fine-tuning', 'Context Design'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M5 7l3-3 3 3M8 4v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M17 15l-3 3-3-3M14 18V9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Full-Stack AI Infrastructure',
    description:
      'From vector databases and LLM APIs to production-grade frontends and auth systems — we architect and build the entire stack. You get a finished product, not a prototype.',
    tags: ['FastAPI', 'React', 'Supabase', 'Multi-LLM'],
  },
];

export default function WhatWeBuild() {
  return (
    <section className="what-we-build section" id="what-we-build">
      <div className="container">
        <div className="what-we-build__header">
          <span className="section-label">Services</span>
          <h2 className="section-heading">What we build</h2>
          <p className="section-subheading">
            Every engagement is scoped to your problem. These are the systems we build most often.
          </p>
        </div>

        <div className="what-we-build__grid">
          {services.map((service) => (
            <div className="service-card" key={service.title}>
              <div className="service-card__icon">{service.icon}</div>
              <h3 className="service-card__title">{service.title}</h3>
              <p className="service-card__description">{service.description}</p>
              <div className="service-card__tags">
                {service.tags.map((tag) => (
                  <span className="service-card__tag" key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
