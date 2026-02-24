import './Hero.css';

export default function Hero() {
  return (
    <section className="hero">
      {/* Ambient glow */}
      <div className="hero__glow" aria-hidden="true" />

      <div className="container hero__inner">
        <div className="hero__badge">
          <span className="hero__badge-dot" />
          Antimony AI · Custom AI Systems
        </div>

        <h1 className="hero__headline">
          We build the intelligence<br />
          <span className="hero__headline-accent">your domain requires.</span>
        </h1>

        <p className="hero__subline">
          Antimony AI designs and delivers custom agentic systems — from knowledge
          retrieval to automated workflows — for organizations that need more than
          off-the-shelf.
        </p>

        <div className="hero__actions">
          <a href="#contact" className="btn-primary">
            Request a build
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <a href="#case-study" className="btn-secondary">
            See our work
          </a>
        </div>

        <div className="hero__stats">
          <div className="hero__stat">
            <span className="hero__stat-value">Full-stack</span>
            <span className="hero__stat-label">AI development</span>
          </div>
          <div className="hero__stat-divider" />
          <div className="hero__stat">
            <span className="hero__stat-value">End-to-end</span>
            <span className="hero__stat-label">From scoping to deploy</span>
          </div>
          <div className="hero__stat-divider" />
          <div className="hero__stat">
            <span className="hero__stat-value">Domain-tuned</span>
            <span className="hero__stat-label">Built for your context</span>
          </div>
        </div>
      </div>
    </section>
  );
}
