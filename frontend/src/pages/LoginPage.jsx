import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../components/ui/Toast';
import LoginForm from '../components/forms/LoginForm';
import Button from '../components/ui/Button';
import Tooltip from '../components/ui/Tooltip';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { login } = useAuth();

  const handleSubmit = async (username, password) => {
    setError(null);
    setLoading(true);

    try {
      const result = await login(username, password);

      if (result.success) {
        showToast('Вход выполнен успешно!', 'success');
        // Redirect to intended page or default to /auctions
        const from = location.state?.from?.pathname || '/auctions';
        navigate(from, { replace: true });
      } else {
        setError(result.error || 'Ошибка входа. Проверьте свои учетные данные.');
      }
    } catch (err) {
      setError('Произошла неожиданная ошибка. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-text-primary">С возвращением</h1>
          <p className="text-text-secondary">Войдите в свой аккаунт, чтобы продолжить</p>
        </div>

        {/* Login Form */}
        <LoginForm
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />

        {/* Register Link */}
        <div className="text-center">
          <p className="text-text-muted text-sm">
            Нет аккаунта?{' '}
            <Link
              to="/register"
              className="text-accent-primary hover:text-accent-hover font-medium transition-colors duration-fast"
            >
              Зарегистрируйтесь здесь
            </Link>
          </p>
        </div>

        {/* Back to Home Link (optional) */}
        <div className="text-center">
          <Tooltip content="Вернуться на главную страницу">
            <Link to="/">
              <Button variant="ghost" size="sm">
                ← На главную
              </Button>
            </Link>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
