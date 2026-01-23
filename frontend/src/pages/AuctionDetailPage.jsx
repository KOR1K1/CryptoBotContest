import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import RoundsHistory from '../components/RoundsHistory';
import { showToast } from '../components/ui/Toast';
import BidForm from '../components/forms/BidForm';
import BidItem from '../components/features/BidItem';
import TimerDisplay from '../components/features/TimerDisplay';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Loading from '../components/ui/Loading';
import Tooltip from '../components/ui/Tooltip';
import EmptyState from '../components/ui/EmptyState';

const AuctionDetailPage = () => {
  const { id: auctionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [dashboardData, setDashboardData] = useState(null);
  const [giftInfo, setGiftInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState(null);
  const [bidSuccess, setBidSuccess] = useState(null);
  const [timeUntilRoundEnd, setTimeUntilRoundEnd] = useState(0);
  const [totalTimeRemaining, setTotalTimeRemaining] = useState(0);
  const [roundProgress, setRoundProgress] = useState(0);

  const loadDashboard = useCallback(async (forceRefresh = false) => {
    if (!auctionId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const cacheBuster = forceRefresh ? `&_t=${Date.now()}` : '';
      const url = `/auctions/${auctionId}/dashboard${currentUserId ? `?userId=${currentUserId}${cacheBuster}` : cacheBuster ? `?${cacheBuster.substring(1)}` : ''}`;
      const data = await apiRequest(url);
      setDashboardData(data);

      try {
        if (data.auction.giftId) {
          const gift = await apiRequest(`/gifts/${data.auction.giftId}`);
          setGiftInfo(gift || {});
        }
      } catch (error) {
        console.error('Error loading gift:', error);
        setGiftInfo({});
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setError(error.message || 'Не удалось загрузить аукцион');
      showToast(`Не удалось загрузить аукцион: ${error.message}`, 'error');
      setDashboardData(null);
      setGiftInfo({});
    } finally {
      setLoading(false);
    }
  }, [auctionId, currentUserId]);

  useEffect(() => {
    loadDashboard();

    // Page Visibility API: Optimize polling based on tab visibility
    let refreshInterval = null;
    
    const ACTIVE_INTERVAL = 1000; // 1 second when tab is active
    
    const startPolling = (interval) => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (!document.hidden && document.visibilityState !== 'hidden') {
        refreshInterval = setInterval(loadDashboard, interval);
      }
    };

    const stopPolling = () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        loadDashboard();
        startPolling(ACTIVE_INTERVAL);
      }
    };

    const handleWindowBlur = () => {
      stopPolling();
    };

    const handleWindowFocus = () => {
      if (!document.hidden && document.visibilityState !== 'hidden') {
        loadDashboard();
        startPolling(ACTIVE_INTERVAL);
      }
    };

    if (!document.hidden && document.visibilityState !== 'hidden') {
      startPolling(ACTIVE_INTERVAL);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    const handleRefresh = (event) => {
      const forceRefresh = event?.detail?.force === true;
      if (forceRefresh) {
        setTimeout(() => {
          loadDashboard(true);
        }, 200);
      } else {
        loadDashboard(false);
      }
    };

    const handleTopUpdate = (event) => {
      const data = event.detail;
      if (!data || data.auctionId !== auctionId) return;
      if (!data.topPositions || !Array.isArray(data.topPositions)) return;

      setDashboardData((prev) => {
        if (!prev) return prev;
        const mappedTop = data.topPositions
          .slice(0, 3)
          .map((tp) => ({
            position: tp.position,
            userId: tp.userId,
            username: tp.username || 'Unknown',
            amount: tp.amount,
            createdAt: tp.createdAt || prev.currentRound?.startedAt || new Date().toISOString(),
            roundIndex:
              typeof tp.roundIndex === 'number'
                ? tp.roundIndex
                : prev.currentRound?.roundIndex ?? prev.auction?.currentRound ?? 0,
          }));

        return {
          ...prev,
          topBids: mappedTop,
        };
      });
    };

    window.addEventListener('refresh-auction', handleRefresh);
    window.addEventListener('auction-top-update', handleTopUpdate);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('refresh-auction', handleRefresh);
      window.removeEventListener('auction-top-update', handleTopUpdate);
    };
  }, [loadDashboard, auctionId]);

  useEffect(() => {
    if (!dashboardData?.currentRound) {
      setTimeUntilRoundEnd(0);
      setTotalTimeRemaining(0);
      setRoundProgress(0);
      return;
    }

    let timerInterval = null;

    const updateTimers = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        return;
      }

      const now = Date.now();
      const startedAt = new Date(dashboardData.currentRound.startedAt).getTime();
      const endsAt = new Date(dashboardData.currentRound.endsAt).getTime();
      const roundRemaining = Math.max(0, endsAt - now);
      const totalDuration = endsAt - startedAt;
      const elapsed = now - startedAt;
      const progress = totalDuration > 0 ? Math.max(0, Math.min(100, (elapsed / totalDuration) * 100)) : 0;

      setTimeUntilRoundEnd(roundRemaining);
      setTotalTimeRemaining(dashboardData.currentRound.totalTimeRemainingMs || 0);
      setRoundProgress(progress);
    };

    const stopTimers = () => {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    };

    const startTimers = () => {
      stopTimers();
      if (!document.hidden && document.visibilityState !== 'hidden') {
        updateTimers();
        timerInterval = setInterval(updateTimers, 1000);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        stopTimers();
      } else {
        startTimers();
      }
    };

    const handleWindowBlur = () => {
      stopTimers();
    };

    const handleWindowFocus = () => {
      if (!document.hidden && document.visibilityState !== 'hidden') {
        startTimers();
      }
    };

    startTimers();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      stopTimers();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [dashboardData?.currentRound]);

  const formatDateTime = (dateString) => {
    if (!dateString) return 'Н/Д';
    return new Date(dateString).toLocaleString('ru-RU');
  };

  const handleStartAuction = async () => {
    try {
      await apiRequest(`/auctions/${auctionId}/start`, { method: 'POST' });
      showToast('Аукцион успешно запущен!', 'success');
      loadDashboard(true);
    } catch (error) {
      showToast(`Ошибка запуска аукциона: ${error.message}`, 'error');
    }
  };

  const handlePlaceBid = async (amount) => {
    if (!currentUserId) {
      setBidError('Пожалуйста, войдите в систему, чтобы разместить ставку');
      return;
    }

    setBidLoading(true);
    setBidError(null);
    setBidSuccess(null);

    try {
      await apiRequest(`/auctions/${auctionId}/bids`, {
        method: 'POST',
        data: { amount },
      });

      setBidSuccess('Ставка успешно размещена!');
      showToast('Ставка успешно размещена!', 'success');
      loadDashboard(true);
      setTimeout(() => {
        setBidSuccess(null);
      }, 3000);
    } catch (error) {
      const errorMessage = error.message || 'Не удалось разместить ставку';
      setBidError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setBidLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Tooltip content="Вернуться к списку аукционов">
            <Button variant="ghost" onClick={() => navigate('/auctions')} leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            }>
              Назад к аукционам
            </Button>
          </Tooltip>
        </div>
        <Card variant="elevated" className="p-12 text-center">
          <Loading.Spinner size="lg" />
          <p className="text-text-secondary mt-4">Загрузка деталей аукциона...</p>
        </Card>
      </div>
    );
  }

  // Error State
  if (error && !dashboardData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Tooltip content="Вернуться к списку аукционов">
            <Button variant="ghost" onClick={() => navigate('/auctions')} leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            }>
              Назад к аукционам
            </Button>
          </Tooltip>
        </div>
        <Card variant="elevated" className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-status-error text-6xl">⚠️</div>
            <h2 className="text-2xl font-semibold text-text-primary">Аукцион не найден</h2>
            <p className="text-text-secondary">{error}</p>
            <Tooltip content="Попробовать загрузить аукцион снова">
              <Button variant="primary" onClick={() => loadDashboard(true)}>
                Повторить
              </Button>
            </Tooltip>
          </div>
        </Card>
      </div>
    );
  }

  if (!dashboardData) return null;

  const { auction, currentRound, gifts, topBids, userPosition } = dashboardData;
  const currentMaxBid = topBids && topBids.length > 0 ? topBids[0].amount : null;

  const getStatusLabel = (status) => {
    if (!status) return 'Неизвестно';
    const statusStr = typeof status === 'string' ? status : String(status);
    const statusUpper = statusStr.toUpperCase().trim();
    
    const statusMap = {
      'CREATED': 'Создан',
      'RUNNING': 'Идет',
      'FINALIZING': 'Завершается',
      'COMPLETED': 'Завершен',
    };
    
    return statusMap[statusUpper] || statusStr;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Tooltip content="Вернуться к списку аукционов">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/auctions')}
            leftIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            }
          >
            Назад к аукционам
          </Button>
        </Tooltip>
        
        <Tooltip content="Обновить данные аукциона">
          <Button 
            variant="secondary" 
            onClick={() => loadDashboard(true)}
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

      {/* Gift Image & Title */}
      <Card variant="elevated" className="overflow-hidden">
        <div className="relative w-full h-64 bg-bg-secondary overflow-hidden">
          {giftInfo?.imageUrl ? (
            <img
              src={giftInfo.imageUrl}
              alt={giftInfo.title || 'Подарок аукциона'}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = 'none';
                const placeholder = e.target.parentElement.querySelector('.image-placeholder');
                if (placeholder) placeholder.style.display = 'flex';
              }}
            />
          ) : null}
          <div className="image-placeholder hidden w-full h-full items-center justify-center text-text-muted">
            <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-text-primary mb-2">
                {giftInfo?.title || 'Auction'}
              </h1>
              {giftInfo?.description && (
                <p className="text-text-secondary">
                  {giftInfo.description}
                </p>
              )}
            </div>
            <Badge 
              variant={
                auction.status === 'RUNNING' ? 'success' :
                auction.status === 'COMPLETED' ? 'info' :
                auction.status === 'FINALIZING' ? 'warning' : 'default'
              }
              size="md"
            >
              {getStatusLabel(auction?.status)}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Auction Information */}
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Информация об аукционе</h2>}>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">Время начала</span>
            <span className="text-text-primary font-medium">
              {currentRound?.startedAt ? formatDateTime(currentRound.startedAt) : 'Н/Д'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">Время окончания</span>
            <span className="text-text-primary font-medium">
              {currentRound?.endsAt ? formatDateTime(currentRound.endsAt) : 'Н/Д'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">
              {auction.status === 'COMPLETED' ? 'Последний раунд' : 'Текущий раунд'}
            </span>
            <span className="text-text-primary font-medium">
              {auction.status === 'COMPLETED' 
                ? `${auction.totalRounds ?? 0} / ${auction.totalRounds ?? 0} (Завершен)`
                : `${(auction.currentRound ?? 0) + 1} / ${auction.totalRounds ?? 0}`}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">Всего подарков</span>
            <span className="text-text-primary font-medium">{gifts?.totalGifts ?? auction.totalGifts ?? 0}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">Уже вручено</span>
            <span className="text-text-primary font-medium">{gifts?.alreadyAwarded ?? 0}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-muted">Осталось подарков</span>
            <span className={`font-semibold ${gifts?.remainingGifts === 0 && auction.status === 'COMPLETED' ? 'text-status-success' : 'text-status-success'}`}>
              {gifts?.remainingGifts ?? 0}
            </span>
          </div>
          {auction.status !== 'COMPLETED' && (
            <div className="flex items-center justify-between py-2">
              <span className="text-text-muted">Подарков в этом раунде</span>
              <Tooltip content="Максимальное количество победителей в этом раунде">
                <span className="text-status-success font-semibold text-lg">
                  {gifts?.giftsPerRound ?? 0}
                </span>
              </Tooltip>
            </div>
          )}
        </div>
      </Card>

      {/* Timer Display */}
      {currentRound && (
        <TimerDisplay
          timeUntilRoundEnd={timeUntilRoundEnd}
          totalTimeRemaining={totalTimeRemaining}
          roundProgress={roundProgress}
          minBid={auction.minBid || 0}
        />
      )}

      {/* Top 3 Participants */}
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Топ 3 участника</h2>}>
        {topBids && topBids.length > 0 ? (
          <div className="space-y-3">
            {topBids.map((bid, index) => (
              <BidItem
                key={bid.userId}
                bid={bid}
                position={index + 1}
                currentRound={auction.currentRound}
                isLeading={index === 0}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="🎯"
            title="Ставок пока нет"
            message="Станьте первым, кто сделает ставку! Ваша ставка появится здесь после участия."
            className="py-8"
          />
        )}
      </Card>

      {/* User Position */}
      {currentUserId && userPosition && userPosition.position !== null && (
        <Card 
          variant="elevated" 
          className={`border-2 ${
            userPosition.canWin 
              ? 'border-status-success bg-status-success/5' 
              : 'border-status-error bg-status-error/5'
          }`}
        >
          <div className="p-6">
            <h3 className="text-xl font-semibold text-text-primary mb-4">Ваша позиция</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Позиция</span>
                <span className="text-3xl font-bold text-text-primary">#{userPosition.position}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Ваша ставка</span>
                <span className="text-xl font-semibold text-text-primary">
                  {userPosition.amount?.toFixed(2) || '0.00'}
                </span>
              </div>
              {(() => {
                const userBidInTop = topBids?.find(b => b.userId === currentUserId);
                const isCarryOver = userBidInTop && 
                                   userBidInTop.roundIndex !== undefined && 
                                   auction.currentRound !== undefined &&
                                   userBidInTop.roundIndex < auction.currentRound;
                
                if (isCarryOver) {
                  return (
                    <div className="p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg">
                      <p className="text-sm text-status-warning">
                        Эта ставка из раунда {userBidInTop.roundIndex + 1} (перенесена в раунд {auction.currentRound + 1})
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
              <div className={`p-3 rounded-lg ${userPosition.canWin ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
                <p className="font-semibold">
                  {userPosition.canWin 
                    ? `✓ Вы можете выиграть (в топе ${gifts?.giftsPerRound ?? 0} победителей)`
                    : `✗ Вас перебили (нужно быть в топе ${gifts?.giftsPerRound ?? 0} победителей)`
                  }
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Start Auction Button */}
      {auction.status === 'CREATED' && auction.createdBy === currentUserId && (
        <Card variant="elevated">
          <div className="p-6">
            <Tooltip content="Запустить аукцион для начала приема ставок">
              <Button
                variant="primary"
                size="lg"
                onClick={handleStartAuction}
                className="w-full"
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              >
                Запустить аукцион
              </Button>
            </Tooltip>
          </div>
        </Card>
      )}

      {/* Place Bid Form */}
      {auction.status === 'RUNNING' && currentUserId && (
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-4">Разместить ставку</h2>
          <BidForm
            onSubmit={handlePlaceBid}
            minBid={auction.minBid || 0}
            currentMaxBid={currentMaxBid}
            loading={bidLoading}
            error={bidError}
            success={bidSuccess}
          />
        </div>
      )}

      {/* Rounds History */}
      <RoundsHistory auctionId={auctionId} currentRound={auction.currentRound} />
    </div>
  );
};

export default AuctionDetailPage;
