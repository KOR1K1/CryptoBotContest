import { useEffect, useRef } from 'react';

/**
 * Modal Component
 * 
 * Переиспользуемый компонент модального окна с backdrop, анимациями и управлением клавиатурой
 * 
 * @param {boolean} isOpen - Открыто ли модальное окно
 * @param {function} onClose - Callback для закрытия
 * @param {string} size - Размер: 'sm', 'md', 'lg', 'xl', 'full'
 * @param {React.ReactNode} children - Содержимое модального окна
 * @param {string} title - Заголовок модального окна
 * @param {boolean} closeOnBackdropClick - Закрывать ли при клике на backdrop
 * @param {boolean} closeOnEscape - Закрывать ли при нажатии ESC
 * @param {string} className - Дополнительные CSS классы
 */
const Modal = ({
  isOpen,
  onClose,
  size = 'md',
  children,
  title,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  className = '',
}) => {
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Размеры модального окна
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-2 sm:mx-4',
  };

  // Обработка ESC
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Блокировка скролла body при открытом модальном окне
  useEffect(() => {
    if (isOpen) {
      // Сохраняем текущий активный элемент
      previousActiveElement.current = document.activeElement;
      
      // Блокируем скролл
      document.body.style.overflow = 'hidden';
      
      // Фокусируемся на модальном окне
      if (modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        }
      }
    } else {
      // Восстанавливаем скролл
      document.body.style.overflow = '';
      
      // Возвращаем фокус на предыдущий элемент
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Обработка клика на backdrop
  const handleBackdropClick = (e) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto safe-area-inset"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0.5rem)',
        paddingBottom: 'env(safe-area-inset-bottom, 0.5rem)',
        paddingLeft: 'env(safe-area-inset-left, 0.5rem)',
        paddingRight: 'env(safe-area-inset-right, 0.5rem)',
      }}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-normal"
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div
        ref={modalRef}
        className={`relative z-10 w-full ${sizeClasses[size]} bg-bg-card border border-border rounded-xl shadow-xl transform transition-all duration-normal my-auto max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - фиксированный */}
        {title && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0">
            <h2 id="modal-title" className="text-lg sm:text-xl font-semibold text-text-primary pr-2">
              {title}
            </h2>
            {closeOnBackdropClick && (
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-primary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary rounded-lg p-1 shrink-0"
                aria-label="Close modal"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body - скроллируемый */}
        <div className={`${title ? 'px-4 sm:px-6 py-4' : 'p-4 sm:p-6'} overflow-y-auto flex-1 min-h-0`}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
