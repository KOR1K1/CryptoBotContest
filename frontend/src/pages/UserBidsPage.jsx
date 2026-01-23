import { useState, useEffect } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../components/ui/Toast';
import UserBidItem from '../components/features/UserBidItem';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Loading from '../components/ui/Loading';
import Tooltip from '../components/ui/Tooltip';
import EmptyState from '../components/ui/EmptyState';

const UserBidsPage = () => {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [bids, setBids] = useState([]);
  const [filteredBids, setFilteredBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadBids = async () => {
    if (!currentUserId) {
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const bidsData = await apiRequest(`/users/${currentUserId}/bids`);
      setBids(bidsData);
    } catch (error) {
      console.error('Error loading bids:', error);
      setError(error.message || 'Не удалось загрузить ставки');
      showToast(`Не удалось загрузить ставки: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Filter bids by status
  useEffect(() => {
    let filtered = [...bids];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(bid => bid.status === statusFilter);
    }

    filtered.sort((a, b) => {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    setFilteredBids(filtered);
  }, [bids, statusFilter]);

  useEffect(() => {
    loadBids();
  }, [currentUserId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Мои ставки</h1>
            <p className="text-text-secondary">Загрузка ваших ставок...</p>
          </div>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i} variant="elevated">
              <div className="p-4">
                <Loading.Skeleton variant="text" width="w-1/4" height="h-6" className="mb-2" />
                <Loading.Skeleton variant="text" width="w-1/2" height="h-4" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error State
  if (error && bids.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Мои ставки</h1>
            <p className="text-text-secondary">Что-то пошло не так</p>
          </div>
        </div>
        <Card variant="elevated" className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-status-error text-6xl">⚠️</div>
            <h2 className="text-2xl font-semibold text-text-primary">Не удалось загрузить ставки</h2>
            <p className="text-text-secondary">{error}</p>
            <Button
              variant="primary"
              onClick={loadBids}
            >
              Повторить
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">Мои ставки</h1>
          <p className="text-text-secondary">
            Найдено {filteredBids.length} {filteredBids.length === 1 ? 'ставка' : filteredBids.length < 5 ? 'ставки' : 'ставок'}
            {statusFilter !== 'all' && ` (всего ${bids.length})`}
          </p>
        </div>
        
        <Tooltip content="Обновить список ставок">
          <Button
            variant="secondary"
            onClick={loadBids}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            Обновить
          </Button>
        </Tooltip>
      </div>

      {/* Status Filter */}
      <Card variant="outlined" className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Фильтр по статусу
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              <option value="all">Все статусы</option>
              <option value="WON">Выиграно</option>
              <option value="ACTIVE">Активна</option>
              <option value="REFUNDED">Возвращено</option>
              <option value="LOST">Проиграно</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Bids List */}
      {filteredBids.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Ставки не найдены"
          message={
            statusFilter !== 'all'
              ? `Ставки со статусом "${statusFilter === 'WON' ? 'Выиграно' : statusFilter === 'ACTIVE' ? 'Активна' : statusFilter === 'REFUNDED' ? 'Возвращено' : 'Проиграно'}" не найдены. Попробуйте изменить фильтр.`
              : 'Вы еще не делали ставок. Участвуйте в аукционах, чтобы увидеть свои ставки здесь!'
          }
          action={
            statusFilter !== 'all' ? (
              <Tooltip content="Показать все ставки независимо от статуса">
                <Button
                  variant="secondary"
                  onClick={() => setStatusFilter('all')}
                >
                  Показать все ставки
                </Button>
              </Tooltip>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredBids.map((bid) => (
            <UserBidItem key={bid.id} bid={bid} />
          ))}
        </div>
      )}
    </div>
  );
};

export default UserBidsPage;
