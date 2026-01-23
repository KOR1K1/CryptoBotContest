const Badge = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-semibold rounded-full uppercase tracking-wide';
  
  const variantClasses = {
    default: 'bg-bg-tertiary text-text-secondary border border-border',
    success: 'bg-status-success/20 text-status-success border border-status-success/30',
    error: 'bg-status-error/20 text-status-error border border-status-error/30',
    warning: 'bg-status-warning/20 text-status-warning border border-status-warning/30',
    info: 'bg-status-info/20 text-status-info border border-status-info/30',
  };
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  };
  
  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
  
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
};

export default Badge;
