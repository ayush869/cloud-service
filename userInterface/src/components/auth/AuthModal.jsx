import { useState } from 'react';
import AdminAuthForm from './AdminAuthForm';
import UserAuthForm from './UserAuthForm';

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [role, setRole] = useState('user');
  const [mode, setMode] = useState('login');

  if (!isOpen) {
    return null;
  }

  const FormComponent = role === 'user' ? UserAuthForm : AdminAuthForm;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close login modal">
          x
        </button>

        <div className="auth-header">
          <p className="eyebrow">Account access</p>
          <h2 id="auth-title">{mode === 'login' ? 'Login to Recruiter AI' : 'Create your account'}</h2>
        </div>

        <div className="segmented-control" aria-label="Choose account type">
          <button className={role === 'user' ? 'active' : ''} type="button" onClick={() => setRole('user')}>
            User
          </button>
          <button className={role === 'admin' ? 'active' : ''} type="button" onClick={() => setRole('admin')}>
            Admin
          </button>
        </div>

        <div className="segmented-control muted" aria-label="Choose login or register">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>
            Login
          </button>
          <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <FormComponent mode={mode} onAuthSuccess={() => onAuthSuccess(role)} />
      </section>
    </div>
  );
}
