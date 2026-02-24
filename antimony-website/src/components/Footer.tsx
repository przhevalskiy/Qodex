import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__left">
          <div className="footer__logo">
            <span className="footer__logo-mark">Sb</span>
            <span className="footer__logo-name">Antimony AI</span>
          </div>
          <p className="footer__tagline">
            Custom agentic systems for organizations<br />that need more than off-the-shelf.
          </p>
        </div>

        <div className="footer__links">
          <div className="footer__col">
            <span className="footer__col-label">Company</span>
            <a href="#what-we-build">Services</a>
            <a href="#how-it-works">Process</a>
            <a href="#case-study">Work</a>
          </div>
          <div className="footer__col">
            <span className="footer__col-label">Contact</span>
            <a href="mailto:hello@antimonyai.com">hello@antimonyai.com</a>
          </div>
        </div>
      </div>

      <div className="container footer__bottom">
        <span>© {new Date().getFullYear()} Antimony AI. All rights reserved.</span>
        <span>Built by Antimony AI · Powered by <a href="#case-study" className="footer__product-link">Qodex</a></span>
      </div>
    </footer>
  );
}
