import { useState } from 'react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Tooltip from '../ui/Tooltip';

const LoginForm = ({ onSubmit, loading = false, error = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});

  const validateUsername = (value) => {
    if (!value || value.trim().length === 0) {
      setErrors(prev => ({ ...prev, username: 'Имя пользователя обязательно' }));
      return false;
    }
    if (value.trim().length < 3) {
      setErrors(prev => ({ ...prev, username: 'Имя пользователя должно быть не менее 3 символов' }));
      return false;
    }
    setErrors(prev => ({ ...prev, username: null }));
    return true;
  };

  const validatePassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, password: 'Пароль обязателен' }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: null }));
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const isUsernameValid = validateUsername(username);
    const isPasswordValid = validatePassword(password);

    if (!isUsernameValid || !isPasswordValid) {
      return;
    }

    // Вызываем onSubmit callback
    if (onSubmit) {
      onSubmit(username.trim(), password);
    }
  };

  return (
    <Card variant="elevated" className="p-8">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Username Field */}
        <div className="w-full">
          <Tooltip content="Введите имя пользователя (минимум 3 символа)" position="top">
            <Input
              label="Имя пользователя"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errors.username) {
                  validateUsername(e.target.value);
                }
              }}
              onBlur={(e) => validateUsername(e.target.value)}
              placeholder="Введите имя пользователя"
              required
              disabled={loading}
              error={!!errors.username}
              errorMessage={errors.username}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              }
              aria-label="Имя пользователя"
              aria-required="true"
              aria-invalid={!!errors.username}
              aria-describedby={errors.username ? 'username-error' : undefined}
            />
          </Tooltip>
        </div>

        {/* Password Field */}
        <div className="w-full">
          <Tooltip content="Введите пароль" position="top">
            <Input
              label="Пароль"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  validatePassword(e.target.value);
                }
              }}
              onBlur={(e) => validatePassword(e.target.value)}
              placeholder="Введите пароль"
              required
              disabled={loading}
              error={!!errors.password}
              errorMessage={errors.password}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
              aria-label="Пароль"
              aria-required="true"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
          </Tooltip>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={loading}
          className="w-full"
        >
          {loading ? 'Вход...' : 'Войти'}
        </Button>
      </form>
    </Card>
  );
};

export default LoginForm;
