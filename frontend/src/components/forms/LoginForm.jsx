import { useState } from 'react';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Tooltip from '../ui/Tooltip';

/**
 * LoginForm Component
 * 
 * Форма входа с валидацией и feedback
 * 
 * @param {function} onSubmit - Callback при отправке формы (username, password)
 * @param {boolean} loading - Состояние загрузки
 * @param {string} error - Сообщение об ошибке
 */
const LoginForm = ({ onSubmit, loading = false, error = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  // Валидация password
  const validatePassword = (value) => {
    if (!value || value.length === 0) {
      setErrors(prev => ({ ...prev, password: 'Password is required' }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: null }));
    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Валидация всех полей
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
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Username Field */}
        <div>
          <Tooltip content="Enter your username (minimum 3 characters)" position="top">
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
              placeholder="Enter your username"
              required
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
              aria-describedby={errors.username ? 'username-error' : undefined}
            />
          </Tooltip>
        </div>

        {/* Password Field */}
        <div>
          <Tooltip content="Enter your password" position="top">
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  validatePassword(e.target.value);
                }
              }}
              onBlur={(e) => validatePassword(e.target.value)}
              placeholder="Enter your password"
              required
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
          {loading ? 'Logging in...' : 'Login'}
        </Button>
      </form>
    </Card>
  );
};

export default LoginForm;
