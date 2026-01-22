import Button from './Button';
import Card from './Card';

/**
 * EmptyState Component
 * 
 * Универсальный компонент для отображения пустых состояний
 * 
 * @param {string} icon - Emoji или текст иконки
 * @param {string} title - Заголовок
 * @param {string} message - Сообщение
 * @param {React.ReactNode} action - Дополнительное действие (кнопка и т.д.)
 * @param {string} className - Дополнительные CSS классы
 */
const EmptyState = ({ 
  icon = '📦', 
  title = 'Nothing Here', 
  message = 'No items found.',
  action = null,
  className = '' 
}) => {
  return (
    <Card variant="elevated" className={`p-12 text-center ${className}`}>
      <div className="space-y-4">
        <div className="text-6xl">{icon}</div>
        <h2 className="text-2xl font-semibold text-text-primary">{title}</h2>
        <p className="text-text-secondary max-w-md mx-auto">{message}</p>
        {action && (
          <div className="pt-2">
            {action}
          </div>
        )}
      </div>
    </Card>
  );
};

export default EmptyState;
