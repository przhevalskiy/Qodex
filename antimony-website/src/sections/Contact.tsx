import { useState } from 'react';
import './Contact.css';

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    org: '',
    email: '',
    message: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // mailto fallback — replace with a form backend when ready
    const subject = encodeURIComponent(`Build request from ${form.name} — ${form.org}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nOrganization: ${form.org}\nEmail: ${form.email}\n\n${form.message}`
    );
    window.location.href = `mailto:hello@antimonyai.com?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  return (
    <section className="contact section" id="contact">
      <div className="container contact__inner">
        <div className="contact__left">
          <span className="section-label">Contact</span>
          <h2 className="section-heading">Ready to build?</h2>
          <p className="section-subheading">
            Tell us about your problem. We'll tell you whether we can solve it and what it would take.
          </p>

          <div className="contact__info">
            <a href="mailto:hello@antimonyai.com" className="contact__email">
              hello@antimonyai.com
            </a>
            <p className="contact__response-time">
              We typically respond within one business day.
            </p>
          </div>
        </div>

        <div className="contact__right">
          {submitted ? (
            <div className="contact__success">
              <div className="contact__success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3>Request sent</h3>
              <p>We'll be in touch shortly.</p>
            </div>
          ) : (
            <form className="contact__form" onSubmit={handleSubmit}>
              <div className="contact__row">
                <div className="contact__field">
                  <label className="contact__label">Your name</label>
                  <input
                    className="contact__input"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Alex Johnson"
                    required
                  />
                </div>
                <div className="contact__field">
                  <label className="contact__label">Organization</label>
                  <input
                    className="contact__input"
                    type="text"
                    name="org"
                    value={form.org}
                    onChange={handleChange}
                    placeholder="Columbia Business School"
                    required
                  />
                </div>
              </div>

              <div className="contact__field">
                <label className="contact__label">Email</label>
                <input
                  className="contact__input"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@organization.com"
                  required
                />
              </div>

              <div className="contact__field">
                <label className="contact__label">What do you need built?</label>
                <textarea
                  className="contact__textarea"
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  placeholder="Describe the problem you're solving, the data you're working with, and what you've already tried..."
                  rows={5}
                  required
                />
              </div>

              <button type="submit" className="btn-primary contact__submit">
                Send request
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
