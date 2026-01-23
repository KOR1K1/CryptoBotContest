const Card = ({
  variant = 'default',
  hover = false,
  children,
  header,
  footer,
  className = '',
  ...props
}) => {
  const baseClasses = 'rounded-lg transition-all duration-normal';
  
  const variantClasses = {
    default: 'bg-bg-card border border-border',
    elevated: 'bg-bg-card border border-border shadow-lg',
    outlined: 'bg-transparent border-2 border-border',
  };
  
  const hoverClasses = hover
    ? 'hover:border-accent-primary hover:shadow-xl hover:-translate-y-1 cursor-pointer'
    : '';
  
  const cardClasses = `${baseClasses} ${variantClasses[variant]} ${hoverClasses} ${className}`;
  
  return (
    <div className={cardClasses} {...props}>
      {header && (
        <div className="px-6 py-4 border-b border-border">
          {header}
        </div>
      )}
      
      <div className={header || footer ? 'px-6 py-4' : 'p-6'}>
        {children}
      </div>
      
      {footer && (
        <div className="px-6 py-4 border-t border-border">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;
