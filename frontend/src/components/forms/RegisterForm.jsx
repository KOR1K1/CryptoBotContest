import { useState } from 'react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Tooltip from '../ui/Tooltip';

const RegisterForm = ({ onSubmit, loading = false, error = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [initialBalance, setInitialBalance] = useState('10000');
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

  const validateEmail = (value) => {
    if (!value || value.trim().length === 0) {
      // Email опционален, очищаем ошибку если пусто
      setErrors(prev => ({ ...prev, email: null }));
      return true;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      setErrors(prev => ({ ...prev, email: 'Введите корректный email адрес' }));
      return false;
    }
    setErrors(prev => ({ ...prev, email: null }));
    return true;
  };

  const validatePassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, password: 'Пароль обязателен' }));
      return false;
    }
    if (value.length < 6) {
      setErrors(prev => ({ ...prev, password: 'Пароль должен быть не менее 6 символов' }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: null }));
    return true;
  };

  const validateConfirmPassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, confirmPassword: 'Подтвердите пароль' }));
      return false;
    }
    if (value !== password) {
      setErrors(prev => ({ ...prev, confirmPassword: 'Пароли не совпадают' }));
      return false;
    }
    setErrors(prev => ({ ...prev, confirmPassword: null }));
    return true;
  };

  const validateInitialBalance = (value) => {
    if (!value || value.trim().length === 0) {
      // Balance опционален, очищаем ошибку если пусто
      setErrors(prev => ({ ...prev, initialBalance: null }));
      return true;
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      setErrors(prev => ({ ...prev, initialBalance: 'Баланс должен быть положительным числом' }));
      return false;
    }
    setErrors(prev => ({ ...prev, initialBalance: null }));
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const isUsernameValid = validateUsername(username);
    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);
    const isConfirmPasswordValid = validateConfirmPassword(confirmPassword);
    const isInitialBalanceValid = validateInitialBalance(initialBalance);

    if (!isUsernameValid || !isEmailValid || !isPasswordValid || !isConfirmPasswordValid || !isInitialBalanceValid) {
      return;
    }

    if (onSubmit) {
      onSubmit(
        username.trim(),
        password,
        email.trim() || undefined,
        initialBalance ? parseFloat(initialBalance) : undefined
      );
    }
  };

  return (
    <Card variant="elevated" className="p-8">
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Username Field */}
        <div>
          <Tooltip content="Выберите уникальное имя пользователя (минимум 3 символа)" position="top">
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
              placeholder="Выберите имя пользователя"
              required
              minLength={3}
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
            />
          </Tooltip>
        </div>

        {/* Email Field */}
        <div>
          <Tooltip content="Email опционален, но рекомендуется для восстановления аккаунта" position="top">
            <Input
              label="Email (необязательно)"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) {
                  validateEmail(e.target.value);
                }
              }}
              onBlur={(e) => validateEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={loading}
              error={!!errors.email}
              errorMessage={errors.email}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              }
              aria-label="Email"
              aria-invalid={!!errors.email}
            />
          </Tooltip>
        </div>

        {/* Password Field */}
        <div>
          <Tooltip content="Пароль должен быть не менее 6 символов" position="top">
            <Input
              label="Пароль"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  validatePassword(e.target.value);
                }
                // Перепроверяем confirmPassword если оно уже заполнено
                if (confirmPassword) {
                  validateConfirmPassword(confirmPassword);
                }
              }}
              onBlur={(e) => validatePassword(e.target.value)}
              placeholder="Не менее 6 символов"
              required
              minLength={6}
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
            />
          </Tooltip>
        </div>

        {/* Confirm Password Field */}
        <div>
          <Tooltip content="Повторите пароль для подтверждения" position="top">
            <Input
              label="Подтвердите пароль"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword) {
                  validateConfirmPassword(e.target.value);
                }
              }}
              onBlur={(e) => validateConfirmPassword(e.target.value)}
              placeholder="Подтвердите пароль"
              required
              disabled={loading}
              error={!!errors.confirmPassword}
              errorMessage={errors.confirmPassword}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              aria-label="Подтвердите пароль"
              aria-required="true"
              aria-invalid={!!errors.confirmPassword}
            />
          </Tooltip>
        </div>

        {/* Initial Balance Field */}
        <div>
          <Tooltip content="Начальный баланс для вашего аккаунта (необязательно, по умолчанию: 10000)" position="top">
            <Input
              label="Начальный баланс (необязательно)"
              type="number"
              value={initialBalance}
              onChange={(e) => {
                setInitialBalance(e.target.value);
                if (errors.initialBalance) {
                  validateInitialBalance(e.target.value);
                }
              }}
              onBlur={(e) => validateInitialBalance(e.target.value)}
              placeholder="10000"
              min="0"
              disabled={loading}
              error={!!errors.initialBalance}
              errorMessage={errors.initialBalance}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              aria-label="Начальный баланс"
              aria-invalid={!!errors.initialBalance}
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
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </Button>
      </form>
    </Card>
  );
};

export default RegisterForm;
