import { forwardRef, useState } from 'react';

// поле ввода с валидацией и иконками
const Input = forwardRef(({
  type = 'text',
  placeholder,
  disabled = false,
  error = false,
  errorMessage,
  leftIcon,
  rightIcon,
  label,
  helperText,
  className = '',
  onValidation,
  ...props
}, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [internalError, setInternalError] = useState(false);
  const [internalErrorMessage, setInternalErrorMessage] = useState('');

  const inputType = type === 'password' && showPassword ? 'text' : type;

  const handleBlur = (e) => {
    setIsFocused(false);
    
    if (onValidation) {
      const isValid = onValidation(e.target.value);
      if (!isValid) {
        setInternalError(true);
        setInternalErrorMessage(errorMessage || 'Invalid value');
      } else {
        setInternalError(false);
        setInternalErrorMessage('');
      }
    }
    
    if (type === 'email' && e.target.value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(e.target.value)) {
        setInternalError(true);
        setInternalErrorMessage('Please enter a valid email address');
      }
    }
    
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  const handleFocus = (e) => {
    setIsFocused(true);
    if (props.onFocus) {
      props.onFocus(e);
    }
  };

  const handleChange = (e) => {
    // Сбрасываем ошибку при изменении значения
    if (internalError) {
      setInternalError(false);
      setInternalErrorMessage('');
    }
    
    if (props.onChange) {
      props.onChange(e);
    }
  };

  const hasError = error || internalError;
  const displayErrorMessage = errorMessage || internalErrorMessage;

  const baseInputClasses = 'w-full bg-bg-secondary text-text-primary placeholder:text-text-muted border rounded-lg transition-all duration-fast focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
  
  const stateClasses = hasError
    ? 'border-status-error focus:ring-2 focus:ring-status-error focus:border-status-error'
    : isFocused
    ? 'border-accent-primary focus:ring-2 focus:ring-accent-primary focus:border-accent-primary'
    : 'border-border hover:border-accent-secondary focus:border-accent-primary';
  
  const paddingClasses = leftIcon && rightIcon
    ? 'pl-10 pr-10'
    : leftIcon
    ? 'pl-10 pr-4'
    : rightIcon || type === 'password'
    ? 'pl-4 pr-10'
    : 'px-4';
  
  const inputClasses = `${baseInputClasses} ${stateClasses} ${paddingClasses} py-2.5 sm:py-2.5 text-base min-h-[44px] sm:min-h-0 ${className}`;

  const PasswordToggle = () => {
    if (type !== 'password') return null;
    
    return (
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors duration-fast focus:outline-none"
        tabIndex={-1}
        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
      >
        {showPassword ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-text-secondary mb-2">
          {label}
          {props.required && <span className="text-status-error ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            {leftIcon}
          </div>
        )}

        <input
          ref={ref}
          type={inputType}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClasses}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onChange={handleChange}
          aria-invalid={hasError}
          aria-describedby={
            hasError && displayErrorMessage
              ? `${props.id || 'input'}-error`
              : helperText
              ? `${props.id || 'input'}-helper`
              : undefined
          }
          {...props}
        />

        {type === 'password' ? (
          <PasswordToggle />
        ) : rightIcon ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            {rightIcon}
          </div>
        ) : null}
      </div>

      {(helperText || (hasError && displayErrorMessage)) && (
        <div
          id={
            hasError && displayErrorMessage
              ? `${props.id || 'input'}-error`
              : `${props.id || 'input'}-helper`
          }
          className={`mt-1.5 text-sm ${
            hasError ? 'text-status-error' : 'text-text-muted'
          }`}
        >
          {hasError && displayErrorMessage ? displayErrorMessage : helperText}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
