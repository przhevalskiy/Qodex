import './CaseStudy.css';

const stack = [
  'FastAPI', 'React', 'TypeScript', 'Pinecone',
  'Supabase', 'OpenAI', 'Claude', 'Mistral', 'Cohere',
];

const outcomes = [
  {
    metric: 'Multi-LLM',
    label: 'OpenAI, Claude, Mistral, Cohere — switchable per query',
  },
  {
    metric: 'RAG',
    label: 'Semantic search across all uploaded documents',
  },
  {
    metric: 'Full-stack',
    label: 'Auth, storage, streaming, and PDF export — production-ready',
  },
];

export default function CaseStudy() {
  return (
    <section className="case-study section" id="case-study">
      <div className="container">
        <span className="section-label">Work</span>

        <div className="case-study__inner">
          <div className="case-study__left">
            <div className="case-study__product-badge">
              <span className="case-study__product-name">Qodex</span>
              <span className="case-study__product-type">Knowledge Chat Platform</span>
            </div>

            <h2 className="section-heading case-study__heading">
              Built for graduate-level<br />academic intelligence.
            </h2>

            <p className="case-study__description">
              Faculty and students at graduate institutions needed a way to query large volumes
              of research, syllabi, and course materials across multiple AI providers —
              without leaving their workflow or uploading to general-purpose tools.
            </p>
            <p className="case-study__description">
              We designed and built Qodex: a multi-provider RAG chat application with document
              management, semantic vector search, real-time streaming responses, conversation
              history, and PDF export — deployed as a production web application with full
              authentication and per-user data isolation.
            </p>

            <div className="case-study__outcomes">
              {outcomes.map((o) => (
                <div className="case-study__outcome" key={o.metric}>
                  <span className="case-study__outcome-metric">{o.metric}</span>
                  <span className="case-study__outcome-label">{o.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="case-study__right">
            <div className="case-study__card">
              <div className="case-study__card-header">
                <span className="case-study__card-label">Stack</span>
              </div>
              <div className="case-study__stack">
                {stack.map((item) => (
                  <span className="case-study__stack-item" key={item}>{item}</span>
                ))}
              </div>

              <div className="case-study__card-divider" />

              <div className="case-study__card-header">
                <span className="case-study__card-label">Sector</span>
              </div>
              <p className="case-study__sector">Graduate Academic Institutions</p>

              <div className="case-study__card-divider" />

              <div className="case-study__card-header">
                <span className="case-study__card-label">Scope</span>
              </div>
              <p className="case-study__sector">Discovery → Design → Build → Deploy</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
