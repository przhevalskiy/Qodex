import './WhoItsFor.css';

const verticals = [
  {
    title: 'Education & Research',
    description:
      'Universities, research labs, and academic publishers that need to make large document archives queryable — syllabi, papers, lecture notes, institutional knowledge.',
    example: 'e.g., Qodex for graduate programs',
  },
  {
    title: 'Financial Services',
    description:
      'Asset managers, banks, and advisory firms navigating dense regulatory filings, market research, and internal compliance documentation at scale.',
    example: 'e.g., RAG over SEC filings, fund prospectuses',
  },
  {
    title: 'Legal & Compliance',
    description:
      'Law firms and compliance teams that need to surface relevant precedent, contract language, and regulatory guidance from proprietary document libraries — fast.',
    example: 'e.g., Contract review and clause extraction',
  },
  {
    title: 'Enterprise Knowledge',
    description:
      'Organizations with years of internal documentation, SOPs, and institutional knowledge that lives in files no one can find — until now.',
    example: 'e.g., Internal knowledge base for operations teams',
  },
];

export default function WhoItsFor() {
  return (
    <section className="who-its-for section" id="who-its-for">
      <div className="container">
        <div className="who-its-for__header">
          <span className="section-label">Industries</span>
          <h2 className="section-heading">Who it's for</h2>
          <p className="section-subheading">
            We work with organizations where domain knowledge is a competitive asset and generic AI falls short.
          </p>
        </div>

        <div className="who-its-for__grid">
          {verticals.map((v) => (
            <div className="vertical-card" key={v.title}>
              <h3 className="vertical-card__title">{v.title}</h3>
              <p className="vertical-card__description">{v.description}</p>
              <span className="vertical-card__example">{v.example}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
