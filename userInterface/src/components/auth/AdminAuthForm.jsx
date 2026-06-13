export default function AdminAuthForm({ mode, onAuthSuccess }) {
  return (
    <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
      {mode === 'register' && (
        <label>
          Admin Name
          <input type="text" placeholder="Admin name" />
        </label>
      )}
      <label>
        Admin Email
        <input type="email" placeholder="admin@example.com" />
      </label>
      <label>
        Password
        <input type="password" placeholder="Enter password" />
      </label>
      {mode === 'register' && (
        <label>
          Access Code
          <input type="text" placeholder="Internal admin code" />
        </label>
      )}
      <button className="primary-button full-width" type="button" onClick={onAuthSuccess}>
        {mode === 'login' ? 'Login as Admin' : 'Register Admin'}
      </button>
    </form>
  );
}
