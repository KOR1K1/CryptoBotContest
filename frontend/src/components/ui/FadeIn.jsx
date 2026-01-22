import { useEffect, useState } from 'react';

/**
 * FadeIn Component
 * 
 * Компонент для плавного появления элементов
 * 
 * @param {React.ReactNode} children - Дочерние элементы
 * @param {number} delay - Задержка перед появлением (мс)
 * @param {string} className - Дополнительные CSS классы
 */
const FadeIn = ({ children, delay = 0, className = '' }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`fade-in ${isVisible ? 'fade-in-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

export default FadeIn;
