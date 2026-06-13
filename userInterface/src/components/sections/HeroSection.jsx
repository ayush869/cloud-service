import heroImage from '../../assets/hero.png';

export default function HeroSection({ onLoginClick }) {
  return (
    <section className="hero-section section-shell" id="home">
      <div className="hero-copy">
        <p className="eyebrow">AI recruitment platform</p>
        <h1>Recruit faster with an AI assistant built for hiring teams.</h1>
        <p className="hero-text">
          Recruiter AI Service helps companies screen profiles, shortlist stronger candidates,
          automate interview steps, and keep hiring decisions organized from one page.
        </p>
        <div className="hero-actions">
          <a className="primary-button" href="#services">
            Explore Services
          </a>
          <button className="secondary-button" type="button" onClick={onLoginClick}>
            Login / Register
          </button>
        </div>
      </div>

      <div className="hero-visual" aria-label="Recruitment AI workflow preview">
        <img src={heroImage} alt="Layered AI workflow illustration" />
        <div className="workflow-card top-card">
          <span>87%</span>
          <p>profile match</p>
        </div>
        <div className="workflow-card bottom-card">
          <span>24h</span>
          <p>shortlist ready</p>
        </div>
      </div>
    </section>
  );
}
