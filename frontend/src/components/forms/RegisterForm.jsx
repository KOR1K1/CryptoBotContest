import { useState } from 'react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Tooltip from '../ui/Tooltip';

/**
 * RegisterForm Component
 * 
 * Форма регистрации с валидацией всех полей
 * 
 * @param {function} onSubmit - Callback при отправке формы (username, password, email, initialBalance)
 * @param {boolean} loading - Состояние загрузки
 * @param {string} error - Сообщение об ошибке
 */
const RegisterForm = ({ onSubmit, loading = false, error = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [initialBalance, setInitialBalance] = useState('10000');
  const [errors, setErrors] = useState({});

  // Валидация username
  const validateUsername = (value) => {
    if (!value || value.trim().length === 0) {
      setErrors(prev => ({ ...prev, username: 'Username is required' }));
      return false;
    }
    if (value.trim().length < 3) {
      setErrors(prev => ({ ...prev, username: 'Username must be at least 3 characters' }));
      return false;
    }
    setErrors(prev => ({ ...prev, username: null }));
    return true;
  };

  // Валидация email
  const validateEmail = (value) => {
    if (!value || value.trim().length === 0) {
      // Email опционален, очищаем ошибку если пусто
      setErrors(prev => ({ ...prev, email: null }));
      return true;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      setErrors(prev => ({ ...prev, email: 'Please enter a valid email address' }));
      return false;
    }
    setErrors(prev => ({ ...prev, email: null }));
    return true;
  };

  // Валидация password
  const validatePassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, password: 'Password is required' }));
      return false;
    }
    if (value.length < 6) {
      setErrors(prev => ({ ...prev, password: 'Password must be at least 6 characters' }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: null }));
    return true;
  };

  // Валидация confirmPassword
  const validateConfirmPassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, confirmPassword: 'Please confirm your password' }));
      return false;
    }
    if (value !== password) {
      setErrors(prev => ({ ...prev, confirmPassword: 'Passwords do not match' }));
      return false;
    }
    setErrors(prev => ({ ...prev, confirmPassword: null }));
    return true;
  };

  // Валидация initialBalance
  const validateInitialBalance = (value) => {
    if (!value || value.trim().length === 0) {
      // Balance опционален, очищаем ошибку если пусто
      setErrors(prev => ({ ...prev, initialBalance: null }));
      return true;
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      setErrors(prev => ({ ...prev, initialBalance: 'Balance must be a positive number' }));
      return false;
    }
    setErrors(prev => ({ ...prev, initialBalance: null }));
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Валидация всех полей
    const isUsernameValid = validateUsername(username);
    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);
    const isConfirmPasswordValid = validateConfirmPassword(confirmPassword);
    const isInitialBalanceValid = validateInitialBalance(initialBalance);

    if (!isUsernameValid || !isEmailValid || !isPasswordValid || !isConfirmPasswordValid || !isInitialBalanceValid) {
      return;
    }

    // Вызываем onSubmit callback
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
          <Tooltip content="Choose a unique username (minimum 3 characters)" position="top">
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errors.username) {
                  validateUsername(e.target.value);
                }
              }}
              onBlur={(e) => validateUsername(e.target.value)}
              placeholder="Choose a username"
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
              aria-label="Username"
              aria-required="true"
              aria-invalid={!!errors.username}
            />
          </Tooltip>
        </div>

        {/* Email Field */}
        <div>
          <Tooltip content="Email is optional, but recommended for account recovery" position="top">
            <Input
              label="Email (optional)"
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
          <Tooltip content="Password must be at least 6 characters long" position="top">
            <Input
              label="Password"
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
              placeholder="At least 6 characters"
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
              aria-label="Password"
              aria-required="true"
              aria-invalid={!!errors.password}
            />
          </Tooltip>
        </div>

        {/* Confirm Password Field */}
        <div>
          <Tooltip content="Re-enter your password to confirm" position="top">
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword) {
                  validateConfirmPassword(e.target.value);
                }
              }}
              onBlur={(e) => validateConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              disabled={loading}
              error={!!errors.confirmPassword}
              errorMessage={errors.confirmPassword}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              aria-label="Confirm Password"
              aria-required="true"
              aria-invalid={!!errors.confirmPassword}
            />
          </Tooltip>
        </div>

        {/* Initial Balance Field */}
        <div>
          <Tooltip content="Starting balance for your account (optional, default: 10000)" position="top">
            <Input
              label="Initial Balance (optional)"
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
              aria-label="Initial Balance"
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
          {loading ? 'Registering...' : 'Register'}
        </Button>
      </form>
    </Card>
  );
};

export default RegisterForm;
