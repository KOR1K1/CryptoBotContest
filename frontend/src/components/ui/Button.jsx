import { forwardRef } from 'react';

const Button = forwardRef(({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  leftIcon,
  rightIcon,
  className = '',
  ...props
}, ref) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-fast focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0a] disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variantClasses = {
    primary: 'bg-accent-primary text-white hover:bg-accent-hover focus:ring-accent-primary active:bg-accent-hover shadow-md hover:shadow-lg',
    secondary: 'bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover focus:ring-accent-primary active:bg-bg-hover',
    ghost: 'bg-transparent text-text-primary hover:bg-bg-hover focus:ring-accent-primary active:bg-bg-hover',
    danger: 'bg-status-error text-white hover:bg-red-600 focus:ring-status-error active:bg-red-700 shadow-md hover:shadow-lg',
  };
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm gap-1.5 min-h-[36px] sm:min-h-0',
    md: 'px-4 py-2.5 text-base gap-2 min-h-[44px] sm:min-h-0',
    lg: 'px-6 py-3 text-lg gap-2.5 min-h-[48px] sm:min-h-0',
  };
  
  const loadingClasses = loading ? 'cursor-wait' : '';
  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${loadingClasses} ${className}`;
  
  const Spinner = () => {
    const spinnerSize = {
      sm: 'h-3 w-3',
      md: 'h-4 w-4',
      lg: 'h-5 w-5',
    };
    
    return (
      <svg
        className={`animate-spin ${spinnerSize[size]}`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    );
  };
  
  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {!loading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      {children && <span>{children}</span>}
      {!loading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
