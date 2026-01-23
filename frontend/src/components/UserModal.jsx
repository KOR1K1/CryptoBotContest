import { useState } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from './ui/Toast';
import Modal from './ui/Modal';
import Input from './ui/Input';
import Button from './ui/Button';
import Tooltip from './ui/Tooltip';

const UserModal = ({ isOpen, onClose, onCreated }) => {
  const [username, setUsername] = useState('');
  const [initialBalance, setInitialBalance] = useState('10000');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});

  const handleClose = () => {
    if (!loading) {
      setUsername('');
      setInitialBalance('10000');
      setError('');
      setValidationErrors({});
      onClose();
    }
  };

  const validateField = (field, value) => {
    const errors = { ...validationErrors };
    
    switch (field) {
      case 'username':
        const trimmedUsername = value.trim();
        if (!trimmedUsername || trimmedUsername.length < 1) {
          errors.username = 'Имя пользователя должно быть не менее 1 символа';
        } else if (trimmedUsername.length > 50) {
          errors.username = 'Имя пользователя не должно превышать 50 символов';
        } else if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
          errors.username = 'Имя пользователя может содержать только буквы, цифры и подчеркивания';
        } else {
          delete errors.username;
        }
        break;
      
      case 'initialBalance':
        if (value && value.trim() !== '') {
          const balance = parseFloat(value);
          if (isNaN(balance) || balance < 0) {
            errors.initialBalance = 'Initial balance must be a valid number >= 0';
          } else {
            delete errors.initialBalance;
          }
        } else {
          delete errors.initialBalance;
        }
        break;
    }
    
    setValidationErrors(errors);
    return !errors[field];
  };

  const validateForm = () => {
    const fields = ['username', 'initialBalance'];
    const values = { username, initialBalance };
    
    let isValid = true;
    fields.forEach(field => {
      if (!validateField(field, values[field])) {
        isValid = false;
      }
    });
    
    return isValid && Object.keys(validationErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!validateForm()) {
      setError('Пожалуйста, исправьте ошибки валидации перед отправкой');
      return;
    }

    setLoading(true);

    try {
      await apiRequest('/users', {
        method: 'POST',
        data: {
          username: username.trim(),
          initialBalance: initialBalance && initialBalance.trim() !== ''
            ? parseFloat(initialBalance)
            : undefined,
        },
      });

      showToast('Пользователь успешно создан!', 'success');
      handleClose();
      if (onCreated) {
        onCreated();
      }
    } catch (err) {
      const errorMsg = err.message || 'Не удалось создать пользователя';
      setError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      title="Создать нового пользователя"
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Username Input */}
        <Tooltip content="Имя пользователя может содержать буквы, цифры и подчеркивания (1-50 символов)">
          <Input
            label="Имя пользователя"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError('');
              if (validationErrors.username) {
                validateField('username', e.target.value);
              }
            }}
            onBlur={(e) => validateField('username', e.target.value)}
            placeholder="Введите имя пользователя"
            required
            maxLength={50}
            disabled={loading}
            error={!!validationErrors.username}
            errorMessage={validationErrors.username}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          />
        </Tooltip>

        {/* Initial Balance Input */}
        <Tooltip content="Необязательный начальный баланс для пользователя (по умолчанию: 0)">
          <Input
            label="Начальный баланс (необязательно)"
            type="number"
            value={initialBalance}
            onChange={(e) => {
              setInitialBalance(e.target.value);
              setError('');
              if (validationErrors.initialBalance) {
                validateField('initialBalance', e.target.value);
              }
            }}
            onBlur={(e) => validateField('initialBalance', e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            disabled={loading}
            error={!!validationErrors.initialBalance}
            errorMessage={validationErrors.initialBalance}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </Tooltip>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-lg text-status-error text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={loading}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            disabled={loading || Object.keys(validationErrors).length > 0}
          >
            {loading ? 'Создание...' : 'Создать пользователя'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default UserModal;
