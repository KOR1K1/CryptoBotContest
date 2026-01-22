import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Loading from './ui/Loading';

/**
 * ProtectedRoute Component
 * 
 * Защищенный маршрут, который требует аутентификации
 * Перенаправляет на /login, если пользователь не авторизован
 * 
 * @param {React.ReactNode} children - Дочерние компоненты для рендеринга
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // Показываем загрузку, пока проверяем аутентификацию
  if (loading) {
    return <Loading.FullPageLoader message="Loading..." />;
  }

  // Если не авторизован, перенаправляем на login с сохранением intended URL
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;
