import { useLocation } from 'react-router-dom';
import FadeIn from '../ui/FadeIn';

/**
 * PageLayout Component
 * 
 * Обертка для всех страниц с консистентными отступами, максимальной шириной и плавными переходами
 * 
 * @param {React.ReactNode} children - Содержимое страницы
 * @param {string} className - Дополнительные CSS классы
 * @param {object} props - Остальные props для div элемента
 */
const PageLayout = ({
  children,
  className = '',
  ...props
}) => {
  const location = useLocation();

  return (
    <FadeIn key={location.pathname} delay={0}>
      <div
        className={`max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 ${className}`}
        {...props}
      >
        {children}
      </div>
    </FadeIn>
  );
};

export default PageLayout;
