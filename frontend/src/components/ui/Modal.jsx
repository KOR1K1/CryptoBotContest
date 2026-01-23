import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// модальное окно с блокировкой скролла
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
  const scrollYRef = useRef(0);

  const sizeMaxWidths = {
    sm: '28rem',    // max-w-md
    md: '32rem',    // max-w-lg
    lg: '42rem',    // max-w-2xl
    xl: '56rem',    // max-w-4xl
    full: 'calc(100vw - 2rem)',
  };

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

  useEffect(() => {
    if (isOpen) {
      scrollYRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
      
      // Блокируем скролл страницы
      // Важно: делаем это синхронно, чтобы модалка появилась сразу в правильной позиции
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollYRef.current}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.width = '100%';
      // Убеждаемся, что body не имеет margin/padding, которые могут влиять на позиционирование
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      
      // Также блокируем скролл на html для надежности
      document.documentElement.style.overflow = 'hidden';
    } else {
      // Восстанавливаем скролл
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      document.body.style.width = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = '';
      
      // Восстанавливаем позицию скролла
      // Используем requestAnimationFrame для плавного восстановления
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollYRef.current);
      });
    }

    return () => {
      // Cleanup при размонтировании
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      document.body.style.width = '';
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.documentElement.style.overflow = '';
      if (scrollYRef.current !== undefined) {
        requestAnimationFrame(() => {
          window.scrollTo(0, scrollYRef.current);
        });
      }
    };
  }, [isOpen]);

  const handleBackdropClick = (e) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  // portal в body чтобы не зависеть от скролла родителя
  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        overflow: 'hidden',
        touchAction: 'none',
        margin: 0,
        // КРИТИЧНО: Убеждаемся, что backdrop не зависит от скролла страницы
        transform: 'none',
        // Убеждаемся, что backdrop всегда относительно viewport
        contain: 'layout style paint',
      }}
      onClick={handleBackdropClick}
      onTouchMove={(e) => {
        // Предотвращаем скролл страницы при свайпе на backdrop
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Modal Content */}
      <div
        ref={modalRef}
        className={className}
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#1f1f1f',
          border: '1px solid #2a2a2a',
          borderRadius: '0.75rem',
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          // Используем dynamic viewport height и учитываем safe area insets
          maxHeight: 'calc(100dvh - max(2rem, env(safe-area-inset-top) + env(safe-area-inset-bottom)))',
          width: '100%',
          maxWidth: sizeMaxWidths[size] || sizeMaxWidths.md,
          position: 'relative',
          // Предотвращаем "отпружинивание" на iOS
          overscrollBehavior: 'contain',
        }}
      >
        {/* Header */}
        {title && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #2a2a2a',
            flexShrink: 0,
          }}>
            <h2 id="modal-title" style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              color: '#ffffff',
              margin: 0,
              paddingRight: '0.5rem',
            }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                color: '#808080',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                minWidth: '2rem',
                minHeight: '2rem',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.backgroundColor = '#2a2a2a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#808080';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              aria-label="Закрыть модальное окно"
            >
              <svg
                style={{ width: '1.25rem', height: '1.25rem' }}
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
          </div>
        )}

        {/* Body - скроллируемый */}
        <div 
          style={{
            padding: title ? '1.25rem' : '1.5rem',
            paddingBottom: title ? 'max(1.25rem, env(safe-area-inset-bottom))' : 'max(1.5rem, env(safe-area-inset-bottom))',
            overflowY: 'auto',
            overflowX: 'hidden',
            flex: 1,
            minHeight: 0,
            // Предотвращаем "отпружинивание" на iOS
            overscrollBehavior: 'contain',
            overscrollBehaviorY: 'contain',
            WebkitOverscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            position: 'relative',
          }}
          onTouchStart={(e) => {
            // Предотвращаем прокрутку страницы при начале прокрутки внутри модалки
            e.stopPropagation();
          }}
          onTouchMove={(e) => {
            // Разрешаем прокрутку только внутри модалки
            e.stopPropagation();
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );

  // Рендерим модалку через Portal напрямую в body
  // Это гарантирует, что модалка всегда позиционируется относительно viewport,
  // а не относительно родительских элементов со скроллом
  return createPortal(modalContent, document.body);
};

export default Modal;
