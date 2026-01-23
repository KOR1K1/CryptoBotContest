import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../components/ui/Toast';
import RegisterForm from '../components/forms/RegisterForm';
import Button from '../components/ui/Button';
import Tooltip from '../components/ui/Tooltip';

const RegisterPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { register } = useAuth();

  const handleSubmit = async (username, password, email, initialBalance) => {
    setError(null);
    setLoading(true);

    try {
      const result = await register(username, password, email, initialBalance);

      if (result.success) {
        showToast('Регистрация выполнена успешно!', 'success');
        // Redirect to auctions page after successful registration
        navigate('/auctions', { replace: true });
      } else {
        setError(result.error || 'Ошибка регистрации. Попробуйте еще раз.');
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
          <h1 className="text-3xl font-bold text-text-primary">Создать аккаунт</h1>
          <p className="text-text-secondary">Зарегистрируйтесь, чтобы начать участвовать в аукционах</p>
        </div>

        {/* Register Form */}
        <RegisterForm
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />

        {/* Login Link */}
        <div className="text-center">
          <p className="text-text-muted text-sm">
            Уже есть аккаунт?{' '}
            <Link
              to="/login"
              className="text-accent-primary hover:text-accent-hover font-medium transition-colors duration-fast"
            >
              Войдите здесь
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

export default RegisterPage;
