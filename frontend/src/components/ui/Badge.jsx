/**
 * Badge Component
 * 
 * Переиспользуемый компонент бейджа для отображения статусов и меток
 * 
 * @param {string} variant - Вариант: 'default', 'success', 'error', 'warning', 'info'
 * @param {string} size - Размер: 'sm', 'md'
 * @param {React.ReactNode} children - Содержимое бейджа
 * @param {string} className - Дополнительные CSS классы
 * @param {object} props - Остальные props для span элемента
 */
const Badge = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  ...props
}) => {
  // Базовые классы
  const baseClasses = 'inline-flex items-center justify-center font-semibold rounded-full uppercase tracking-wide';
  
  // Варианты стилей
  const variantClasses = {
    default: 'bg-bg-tertiary text-text-secondary border border-border',
    success: 'bg-status-success/20 text-status-success border border-status-success/30',
    error: 'bg-status-error/20 text-status-error border border-status-error/30',
    warning: 'bg-status-warning/20 text-status-warning border border-status-warning/30',
    info: 'bg-status-info/20 text-status-info border border-status-info/30',
  };
  
  // Размеры
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  };
  
  // Объединение всех классов
  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
  
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

export default Badge;
