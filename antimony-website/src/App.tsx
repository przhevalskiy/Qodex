import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Hero from './sections/Hero';
import WhatWeBuild from './sections/WhatWeBuild';
import HowItWorks from './sections/HowItWorks';
import CaseStudy from './sections/CaseStudy';
import WhoItsFor from './sections/WhoItsFor';
import Contact from './sections/Contact';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <WhatWeBuild />
        <HowItWorks />
        <CaseStudy />
        <WhoItsFor />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
