export default function Header({ onLoginClick }) {
  return (
    <header className="site-header">
      <a className="brand" href="#home" aria-label="Recruiter AI Service home">
        <span className="brand-mark">RA</span>
        <span>Recruiter AI</span>
      </a>

      <nav className="main-nav" aria-label="Primary navigation">
        <a href="#services">Services</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
        <button className="nav-login" type="button" onClick={onLoginClick}>
          Login
        </button>
      </nav>
    </header>
  );
}
