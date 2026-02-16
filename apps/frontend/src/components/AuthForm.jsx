import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function AuthForm() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });

  const submit = async (event) => {
    event.preventDefault();
    if (isRegister) {
      await register(form);
      alert('Registered. Please login.');
      setIsRegister(false);
      return;
    }
    await login(form.email, form.password);
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 360, margin: '40px auto' }}>
      <h2>{isRegister ? 'Register' : 'Login'}</h2>
      {isRegister && (
        <input
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
        />
      )}
      <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      <input
        placeholder="Password"
        type="password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        required
      />
      <button type="submit">{isRegister ? 'Create account' : 'Login'}</button>
      <button type="button" onClick={() => setIsRegister((prev) => !prev)}>
        {isRegister ? 'Have an account? Login' : 'No account? Register'}
      </button>
    </form>
  );
}
