// спиннер загрузки
export const Spinner = ({ size = 'md', color = 'accent-primary', className = '' }) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };
  
  const colorClasses = {
    'accent-primary': 'text-accent-primary',
    'status-success': 'text-status-success',
    'status-error': 'text-status-error',
    'status-warning': 'text-status-warning',
    'status-info': 'text-status-info',
    'text-primary': 'text-text-primary',
  };
  
  return (
    <svg
      className={`animate-spin ${sizeClasses[size]} ${colorClasses[color] || colorClasses['accent-primary']} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      style={{
        animation: 'spin 1s linear infinite',
      }}
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

// скелетон для плейсхолдера
export const Skeleton = ({ 
  variant = 'text', 
  width = 'w-full', 
  height = 'h-4',
  className = '' 
}) => {
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };
  
  return (
    <div
      className={`${width} ${height} ${variantClasses[variant]} bg-bg-tertiary ${className}`}
      aria-busy="true"
      aria-label="Загрузка..."
      style={{
        background: 'linear-gradient(90deg, #2a2a2a 25%, #1a1a1a 50%, #2a2a2a 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s linear infinite',
      }}
    />
  );
};

// полноэкранный лоадер
export const FullPageLoader = ({ message = 'Loading...' }) => {
  return (
    <div className="fixed inset-0 bg-bg-primary/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        {message && (
          <p className="text-text-secondary text-sm font-medium">{message}</p>
        )}
      </div>
    </div>
  );
};

const Loading = {
  Spinner,
  Skeleton,
  FullPageLoader,
};

export default Loading;
