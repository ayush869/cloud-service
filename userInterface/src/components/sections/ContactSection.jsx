export default function ContactSection() {
  return (
    <section className="contact-section section-shell" id="contact">
      <div className="section-heading">
        <p className="eyebrow">Contact</p>
        <h2>Ready to build your AI hiring workflow?</h2>
      </div>
      <form className="contact-form">
        <label>
          Name
          <input type="text" placeholder="Your name" />
        </label>
        <label>
          Email
          <input type="email" placeholder="you@example.com" />
        </label>
        <label>
          Message
          <textarea rows="4" placeholder="Tell us about your hiring needs" />
        </label>
        <button className="primary-button" type="button">
          Send Message
        </button>
      </form>
    </section>
  );
}
