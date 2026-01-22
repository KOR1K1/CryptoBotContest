/**
 * Card Component
 * 
 * Переиспользуемый компонент карточки с различными вариантами и секциями
 * 
 * @param {string} variant - Вариант: 'default', 'elevated', 'outlined'
 * @param {boolean} hover - Включить hover эффекты
 * @param {React.ReactNode} children - Содержимое карточки
 * @param {React.ReactNode} header - Заголовок карточки
 * @param {React.ReactNode} footer - Футер карточки
 * @param {string} className - Дополнительные CSS классы
 * @param {object} props - Остальные props для div элемента
 */
const Card = ({
  variant = 'default',
  hover = false,
  children,
  header,
  footer,
  className = '',
  ...props
}) => {
  // Базовые классы
  const baseClasses = 'rounded-lg transition-all duration-normal';
  
  // Варианты стилей
  const variantClasses = {
    default: 'bg-bg-card border border-border',
    elevated: 'bg-bg-card border border-border shadow-lg',
    outlined: 'bg-transparent border-2 border-border',
  };
  
  // Hover эффекты
  const hoverClasses = hover
    ? 'hover:border-accent-primary hover:shadow-xl hover:-translate-y-1 cursor-pointer'
    : '';
  
  // Объединение всех классов
  const cardClasses = `${baseClasses} ${variantClasses[variant]} ${hoverClasses} ${className}`;
  
  return (
    <div className={cardClasses} {...props}>
      {/* Header */}
      {header && (
        <div className="px-6 py-4 border-b border-border">
          {header}
        </div>
      )}
      
      {/* Body */}
      <div className={header || footer ? 'px-6 py-4' : 'p-6'}>
        {children}
      </div>
      
      {/* Footer */}
      {footer && (
        <div className="px-6 py-4 border-t border-border">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;
