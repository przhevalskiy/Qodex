import './HowItWorks.css';

const steps = [
  {
    number: '01',
    title: 'Discover',
    description:
      'We learn your domain, your data, and the problem you\'re actually trying to solve. A focused engagement to understand where AI can create real leverage — and where it can\'t.',
  },
  {
    number: '02',
    title: 'Design',
    description:
      'We scope the system architecture, define what "done" looks like, and align on the stack. You get a clear technical plan before a single line of code is written.',
  },
  {
    number: '03',
    title: 'Build',
    description:
      'Full-stack development: AI integration, backend pipelines, frontend interfaces, auth, and data infrastructure. We build production-grade systems, not prototypes.',
  },
  {
    number: '04',
    title: 'Deploy',
    description:
      'We ship to your infrastructure and support the handoff. Your team gets documentation, access, and the context to operate and extend the system going forward.',
  },
];

export default function HowItWorks() {
  return (
    <section className="how-it-works section" id="how-it-works">
      <div className="container">
        <div className="how-it-works__header">
          <span className="section-label">Process</span>
          <h2 className="section-heading">How it works</h2>
          <p className="section-subheading">
            Every build follows the same disciplined process. No ambiguity, no scope creep.
          </p>
        </div>

        <div className="how-it-works__steps">
          {steps.map((step, i) => (
            <div className="step" key={step.number}>
              <div className="step__left">
                <span className="step__number">{step.number}</span>
                {i < steps.length - 1 && <div className="step__connector" />}
              </div>
              <div className="step__content">
                <h3 className="step__title">{step.title}</h3>
                <p className="step__description">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
