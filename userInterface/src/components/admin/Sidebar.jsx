const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'createJob', label: 'Create Job' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'reports', label: 'Reports' },
];

export default function Sidebar({ activeView, onNavigate, onLogout }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <span className="brand-mark">RA</span>
        <div>
          <strong>Recruiter AI</strong>
          <p>Admin Panel</p>
        </div>
      </div>

      <nav className="admin-nav" aria-label="Admin navigation">
        {navItems.map((item) => (
          <button
            className={activeView === item.id ? 'active' : ''}
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <button className="logout-button" type="button" onClick={onLogout}>
        Logout
      </button>
    </aside>
  );
}
