import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthForm } from './components/AuthForm';
import { Dashboard } from './pages/Dashboard';

function App() {
  const { token } = useAuth();
  return token ? <Dashboard /> : <AuthForm />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
