import { useState, useRef, useEffect } from 'react';

/**
 * Tooltip Component
 * 
 * Переиспользуемый компонент подсказки с позиционированием и анимацией
 * 
 * @param {React.ReactNode} children - Элемент, на который навешивается tooltip
 * @param {string} content - Текст подсказки
 * @param {string} position - Позиция: 'top', 'bottom', 'left', 'right'
 * @param {number} delay - Задержка показа в миллисекундах
 * @param {string} className - Дополнительные CSS классы
 */
const Tooltip = ({
  children,
  content,
  position = 'top',
  delay = 300,
  className = '',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const timeoutRef = useRef(null);

  // Вычисление позиции tooltip
  const calculatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = triggerRect.top + scrollY - tooltipRect.height - 8;
        left = triggerRect.left + scrollX + (triggerRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + 8;
        left = triggerRect.left + scrollX + (triggerRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'left':
        top = triggerRect.top + scrollY + (triggerRect.height / 2) - (tooltipRect.height / 2);
        left = triggerRect.left + scrollX - tooltipRect.width - 8;
        break;
      case 'right':
        top = triggerRect.top + scrollY + (triggerRect.height / 2) - (tooltipRect.height / 2);
        left = triggerRect.right + scrollX + 8;
        break;
    }

    // Корректировка позиции, чтобы tooltip не выходил за границы экрана
    const padding = 8;
    if (left < padding) left = padding;
    if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipRect.height > window.innerHeight + scrollY - padding) {
      top = window.innerHeight + scrollY - tooltipRect.height - padding;
    }

    setTooltipPosition({ top, left });
  };

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Небольшая задержка для расчета позиции после показа
      setTimeout(calculatePosition, 10);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  // Обновление позиции при скролле
  useEffect(() => {
    if (isVisible) {
      const handleScroll = () => {
        calculatePosition();
      };
      
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [isVisible, position]);

  // Стрелка для tooltip
  const Arrow = () => {
    const arrowClasses = {
      top: 'bottom-[-4px] left-1/2 -translate-x-1/2 border-t-bg-card border-l-transparent border-r-transparent border-b-transparent',
      bottom: 'top-[-4px] left-1/2 -translate-x-1/2 border-b-bg-card border-l-transparent border-r-transparent border-t-transparent',
      left: 'right-[-4px] top-1/2 -translate-y-1/2 border-l-bg-card border-t-transparent border-b-transparent border-r-transparent',
      right: 'left-[-4px] top-1/2 -translate-y-1/2 border-r-bg-card border-t-transparent border-b-transparent border-l-transparent',
    };

    return (
      <div
        className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
      />
    );
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-block"
      >
        {children}
      </div>
      
      {isVisible && content && (
        <div
          ref={tooltipRef}
          className={`fixed z-50 px-3 py-2 text-sm font-medium text-text-primary bg-bg-card border border-border rounded-lg shadow-xl pointer-events-none transition-opacity duration-fast ${className}`}
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
          }}
          role="tooltip"
        >
          {content}
          <Arrow />
        </div>
      )}
    </>
  );
};

export default Tooltip;
