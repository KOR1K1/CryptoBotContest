import { useEffect, useState } from 'react';

let toastId = 0;
const toasts = [];
const listeners = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener([...toasts]));
};

export const showToast = (message, type = 'info', duration = 3000) => {
  const id = toastId++;
  const toast = { id, message, type, duration };
  toasts.push(toast);
  notifyListeners();

  if (duration > 0) {
    setTimeout(() => {
      const index = toasts.findIndex(t => t.id === id);
      if (index !== -1) {
        toasts.splice(index, 1);
        notifyListeners();
      }
    }, duration);
  }
};

export const removeToast = (id) => {
  const index = toasts.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.splice(index, 1);
    notifyListeners();
  }
};

const ToastContainer = () => {
  const [toastList, setToastList] = useState([]);

  useEffect(() => {
    const listener = (newToasts) => {
      setToastList(newToasts);
    };
    listeners.push(listener);
    notifyListeners();

    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'info':
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getTypeClasses = (type) => {
    switch (type) {
      case 'success':
        return 'bg-status-success/20 text-status-success border-status-success/30';
      case 'error':
        return 'bg-status-error/20 text-status-error border-status-error/30';
      case 'warning':
        return 'bg-status-warning/20 text-status-warning border-status-warning/30';
      case 'info':
      default:
        return 'bg-status-info/20 text-status-info border-status-info/30';
    }
  };

  return (
    <div 
      className="fixed top-2 right-2 sm:top-5 sm:right-5 left-2 sm:left-auto z-50 flex flex-col gap-2 sm:gap-3 pointer-events-none max-w-sm sm:max-w-sm w-auto sm:w-full"
      style={{
        top: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))',
        right: 'max(0.5rem, env(safe-area-inset-right, 0.5rem))',
        left: 'max(0.5rem, env(safe-area-inset-left, 0.5rem))',
      }}
    >
      {toastList.map(toast => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg border backdrop-blur-sm bg-bg-card/95 shadow-xl animate-slide-in-right ${getTypeClasses(toast.type)}`}
          role="alert"
          aria-live="polite"
        >
          <div className="shrink-0 mt-0.5">
            <div className="w-4 h-4 sm:w-5 sm:h-5">
              {getIcon(toast.type)}
            </div>
          </div>

          <div className="flex-1 text-xs sm:text-sm font-medium wrap-break-word">
            {toast.message}
          </div>

          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary rounded p-0.5"
            aria-label="Закрыть уведомление"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
