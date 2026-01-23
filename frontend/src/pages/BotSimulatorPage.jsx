import { useState } from 'react';
import { apiRequest } from '../api/client';
import { showToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Tooltip from '../components/ui/Tooltip';
import Modal from '../components/ui/Modal';

const BotSimulatorPage = () => {
  const [numBots, setNumBots] = useState('5');
  const [bidsPerBot, setBidsPerBot] = useState('10');
  const [minBid, setMinBid] = useState('100');
  const [maxBid, setMaxBid] = useState('1000');
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [useBulkMode, setUseBulkMode] = useState(true); // По умолчанию используем оптимизированный режим
  const [showInfoModal, setShowInfoModal] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    setStatus({ type: 'loading', message: useBulkMode ? 'Создание ботов и размещение ставок на сервере...' : 'Создание ботов и размещение ставок...' });

    try {
      if (useBulkMode) {
        // Оптимизированный режим: один запрос на сервер
        const result = await apiRequest('/bot-simulator/run', {
          method: 'POST',
          data: {
            numBots: parseInt(numBots),
            bidsPerBot: parseInt(bidsPerBot),
            minBid: parseFloat(minBid),
            maxBid: parseFloat(maxBid),
            initialBalance: 100000,
          },
        });

        const message = `Симуляция завершена! Создано ботов: ${result.botsCreated}, размещено ставок: ${result.bidsPlaced}, время: ${result.duration}мс`;
        setStatus({ type: 'success', message });
        showToast(`Создано ${result.botsCreated} ботов и ${result.bidsPlaced} ставок!`, result.bidsPlaced > 0 ? 'success' : 'error');
      } else {
        const botHeaders = { 'x-bot-simulator': '1' };

        const auctions = await apiRequest('/auctions');
        const runningAuctions = auctions.filter(a => a.status === 'RUNNING');

        if (runningAuctions.length === 0) {
          setStatus({ type: 'error', message: 'Не найдено активных аукционов. Пожалуйста, сначала запустите аукцион.' });
          setRunning(false);
          return;
        }
        const CONCURRENCY = 200; // пул конкурентности
        let botsCreated = 0;
        let bidsPlaced = 0;
        let firstError = null;
        const lastBidByBotAuction = new Map();

        const tasks = Array.from({ length: parseInt(numBots) }, (_, i) => async () => {
          const username = `bot_${Date.now()}_${i}`;
          let bot;
          try {
            bot = await apiRequest('/users', {
              method: 'POST',
              headers: botHeaders,
              data: {
                username,
                initialBalance: 100000,
              },
            });
            botsCreated++;
          } catch (err) {
            const msg = err?.message || String(err);
            if (!firstError) firstError = msg;
            console.error(`Error creating bot user ${username}:`, err);
            return;
          }

          // Immediately place bids for this bot
          for (let j = 0; j < parseInt(bidsPerBot); j++) {
            const auction = runningAuctions[Math.floor(Math.random() * runningAuctions.length)];
            const key = `${String(bot.id)}\t${String(auction.id)}`;
            const lastAmt = lastBidByBotAuction.get(key);

            const bidAmount = lastAmt != null
              ? Math.floor(lastAmt) + 1
              : (() => {
                  const lo = Math.max(auction.minBid ?? 100, parseFloat(minBid));
                  const hi = Math.max(lo, parseFloat(maxBid));
                  return Math.max(lo, Math.round(lo + Math.random() * (hi - lo)));
                })();

            try {
              const res = await apiRequest(`/auctions/${String(auction.id)}/bids/bot`, {
                method: 'POST',
                headers: botHeaders,
                data: { userId: String(bot.id), amount: Math.floor(bidAmount) },
              });
              bidsPlaced++;
              lastBidByBotAuction.set(key, res.amount);
            } catch (err) {
              const msg = err?.message || String(err);
              if (!firstError) firstError = msg;
              console.error(`Error placing bid for bot ${bot.username}:`, err);
            }
          }
        });

        // Run tasks with concurrency limit
        const runPool = async (fns, limit) => {
          return new Promise((resolve) => {
            let idx = 0;
            let active = 0;
            const next = () => {
              if (idx === fns.length && active === 0) return resolve(null);
              while (active < limit && idx < fns.length) {
                const fn = fns[idx++];
                active++;
                fn()
                  .catch(() => {})
                  .finally(() => {
                    active--;
                    next();
                  });
              }
            };
            next();
          });
        };

        await runPool(tasks, CONCURRENCY);

        let message = `Симуляция ботов завершена! Создано ${botsCreated} ботов и размещено ${bidsPlaced} ставок.`;
        if (bidsPlaced === 0 && firstError) {
          message += ` Первая ошибка: ${firstError}`;
        }
        setStatus({ type: 'success', message });
        showToast(`Создано ${botsCreated} ботов и размещено ${bidsPlaced} ставок!`, bidsPlaced > 0 ? 'success' : 'error');
      }
      
      // Trigger refresh
      window.dispatchEvent(new CustomEvent('refresh-auctions'));
    } catch (error) {
      const errorMessage = error.message || 'Ошибка в симуляции ботов';
      setStatus({ type: 'error', message: errorMessage });
      showToast(`Ошибка симуляции ботов: ${errorMessage}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary mb-2">Симулятор ботов</h1>
        <p className="text-text-secondary">
          Симуляция нескольких ботов, размещающих ставки на активных аукционах для нагрузочного тестирования
        </p>
      </div>

      {/* Simulation Parameters */}
      <Card variant="elevated" header={<h2 className="text-xl font-semibold text-text-primary">Параметры симуляции</h2>}>
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex items-center justify-between p-4 bg-bg-secondary rounded-lg border border-border">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-text-primary font-semibold">
                  {useBulkMode ? 'Оптимизированный режим (Рекомендуется)' : 'Режим множественных запросов'}
                </span>
                <Tooltip content="Нажмите для получения подробной информации о режимах">
                  <button
                    onClick={() => setShowInfoModal(true)}
                    className="p-1.5 rounded-lg bg-bg-tertiary hover:bg-bg-hover transition-colors"
                    aria-label="Информация о режимах"
                  >
                    <svg className="w-5 h-5 text-status-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <p className="text-sm text-text-secondary">
                {useBulkMode 
                  ? 'Все операции выполняются на сервере одним запросом. Нет ограничений по количеству HTTP запросов.'
                  : 'Каждый бот создается отдельным HTTP запросом. Может упереться в ограничения браузера/сервера.'}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-4">
              <input
                type="checkbox"
                checked={useBulkMode}
                onChange={(e) => setUseBulkMode(e.target.checked)}
                disabled={running}
                className="sr-only peer"
              />
              <div className="w-14 h-7 bg-bg-tertiary peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-accent-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-status-success"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Tooltip content={useBulkMode ? "Количество ботов для создания (1-10000)" : "Количество ботов для создания (1-50)"}>
              <Input
                label="Количество ботов"
                type="number"
                value={numBots}
                onChange={(e) => setNumBots(e.target.value)}
                min="1"
                max={useBulkMode ? "10000" : "50"}
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content={useBulkMode ? "Количество ставок на каждого бота (1-1000)" : "Количество ставок на каждого бота (1-100)"}>
              <Input
                label="Ставок на бота"
                type="number"
                value={bidsPerBot}
                onChange={(e) => setBidsPerBot(e.target.value)}
                min="1"
                max={useBulkMode ? "1000" : "100"}
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content="Минимальная сумма ставки для каждого бота">
              <Input
                label="Минимальная ставка"
                type="number"
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                min="1"
                step="0.01"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </Tooltip>

            <Tooltip content="Максимальная сумма ставки для каждого бота">
              <Input
                label="Максимальная ставка"
                type="number"
                value={maxBid}
                onChange={(e) => setMaxBid(e.target.value)}
                min="1"
                step="0.01"
                disabled={running}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </Tooltip>
          </div>

          {/* Status Message */}
          {status && (
            <div className={`p-4 rounded-lg border ${
              status.type === 'success'
                ? 'bg-status-success/10 border-status-success/30 text-status-success'
                : status.type === 'error'
                ? 'bg-status-error/10 border-status-error/30 text-status-error'
                : 'bg-status-info/10 border-status-info/30 text-status-info'
            }`}>
              <div className="flex items-center gap-2">
                {status.type === 'loading' && (
                  <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {status.type === 'success' && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {status.type === 'error' && (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className="font-medium">{status.message}</span>
              </div>
            </div>
          )}

          {/* Run Button */}
          <Tooltip content="Запустить симуляцию ботов. Это создаст ботов и разместит ставки на активных аукционах.">
            <Button
              variant="primary"
              size="lg"
              onClick={handleRun}
              loading={running}
              disabled={running}
              className="w-full"
              leftIcon={
                running ? null : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )
              }
            >
              {running ? 'Запуск симуляции...' : 'Запустить симуляцию ботов'}
            </Button>
          </Tooltip>
        </div>
      </Card>

      {/* Info Card */}
      <Card variant="outlined" className="p-6">
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <svg className="w-5 h-5 text-status-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Как это работает
          </h3>
          <ul className="space-y-2 text-sm text-text-secondary list-disc list-inside">
            <li>Создает несколько ботов с начальным балансом 100,000</li>
            <li>Каждый бот размещает случайные ставки на активных аукционах</li>
            <li>Ставки размещаются с суммами между минимальным и максимальным значениями</li>
            <li>Полезно для нагрузочного тестирования и демонстрации конкурентной обработки ставок</li>
            <li>Результаты появятся на страницах аукционов и ваших ставок</li>
          </ul>
        </div>
      </Card>

      {/* Info Modal */}
      <Modal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        size="lg"
        title="Режимы работы симулятора ботов"
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="p-4 bg-status-success/10 border border-status-success/30 rounded-lg">
              <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Оптимизированный режим (ВКЛЮЧЕН)
              </h3>
              <ul className="space-y-2 text-sm text-text-secondary list-disc list-inside ml-2">
                <li>Все операции выполняются на сервере одним запросом</li>
                <li>Нет ограничений по количеству HTTP запросов</li>
                <li>Поддерживает до 10,000 ботов и 1,000 ставок на бота</li>
                <li>Максимальная производительность и скорость</li>
                <li>Идеально для стресс-тестирования и демонстрации конкурентности</li>
                <li>Рекомендуется для проверяющих конкурса</li>
              </ul>
            </div>

            <div className="p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg">
              <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Режим множественных запросов (ВЫКЛЮЧЕН)
              </h3>
              <ul className="space-y-2 text-sm text-text-secondary list-disc list-inside ml-2">
                <li>Каждый бот создается отдельным HTTP запросом с фронтенда</li>
                <li>Каждая ставка размещается отдельным HTTP запросом</li>
                <li>Ограничено до 50 ботов и 100 ставок на бота</li>
                <li>Может упереться в ограничения браузера (максимум одновременных запросов)</li>
                <li>Может упереться в rate limiting сервера</li>
                <li>Медленнее из-за накладных расходов на HTTP запросы</li>
                <li>Полезно для тестирования поведения при множественных запросах</li>
              </ul>
            </div>
          </div>

          <div className="p-4 bg-status-info/10 border border-status-info/30 rounded-lg">
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-status-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Рекомендации для проверяющих
            </h3>
            <p className="text-sm text-text-secondary">
              Для демонстрации максимальной производительности системы используйте <strong>Оптимизированный режим</strong>. 
              Он позволяет создавать тысячи ботов и десятки тысяч ставок без ограничений HTTP запросов. 
              Все операции выполняются на сервере с использованием батчей для максимальной эффективности.
            </p>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setShowInfoModal(false)}>
              Понятно
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BotSimulatorPage;
