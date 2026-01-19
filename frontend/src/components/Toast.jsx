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

  setTimeout(() => {
    const index = toasts.findIndex(t => t.id === id);
    if (index !== -1) {
      toasts.splice(index, 1);
      notifyListeners();
    }
  }, duration);
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

  return (
    <div className="toast-container">
      {toastList.map(toast => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <div style={{ flex: 1 }}>
            {toast.message}
          </div>
          <button
            onClick={() => {
              const index = toasts.findIndex(t => t.id === toast.id);
              if (index !== -1) {
                toasts.splice(index, 1);
                notifyListeners();
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '20px',
              padding: 0,
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
