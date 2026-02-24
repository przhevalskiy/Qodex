import { useState, useEffect } from 'react';
import './Navbar.css';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
      <div className="container navbar__inner">
        <a href="#" className="navbar__logo">
          <span className="navbar__logo-mark">Sb</span>
          <span className="navbar__logo-name">Antimony AI</span>
        </a>

        <ul className="navbar__links">
          <li><a href="#what-we-build">Services</a></li>
          <li><a href="#how-it-works">Process</a></li>
          <li><a href="#case-study">Work</a></li>
          <li><a href="#who-its-for">Industries</a></li>
        </ul>

        <a href="#contact" className="btn-primary navbar__cta">
          Request a build
        </a>
      </div>
    </nav>
  );
}
