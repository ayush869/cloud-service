export default function UserAuthForm({ mode, onAuthSuccess }) {
  return (
    <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
      {mode === 'register' && (
        <label>
          Full Name
          <input type="text" placeholder="Candidate or recruiter name" />
        </label>
      )}
      <label>
        Email
        <input type="email" placeholder="user@example.com" />
      </label>
      <label>
        Password
        <input type="password" placeholder="Enter password" />
      </label>
      {mode === 'register' && (
        <label>
          Company
          <input type="text" placeholder="Company name" />
        </label>
      )}
      <button className="primary-button full-width" type="button" onClick={onAuthSuccess}>
        {mode === 'login' ? 'Login as User' : 'Register User'}
      </button>
    </form>
  );
}
