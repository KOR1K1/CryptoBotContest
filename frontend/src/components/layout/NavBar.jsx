import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';

/**
 * NavBar Component
 * 
 * Навигационное меню с горизонтальной навигацией и мобильной версией
 * Использует React Router для навигации
 */
const NavBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Определяем текущую страницу на основе location.pathname
  const getCurrentPage = () => {
    if (location.pathname.startsWith('/auctions/')) return 'auction-detail';
    if (location.pathname === '/auctions') return 'auctions';
    if (location.pathname === '/inventory') return 'inventory';
    if (location.pathname === '/bids') return 'user-bids';
    if (location.pathname === '/bot-simulator') return 'bot-simulator';
    return '';
  };

  const currentPage = getCurrentPage();

  const pages = [
    { 
      id: 'auctions', 
      label: 'Auctions',
      path: '/auctions',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    { 
      id: 'inventory', 
      label: 'Inventory',
      path: '/inventory',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    { 
      id: 'user-bids', 
      label: 'My Bids',
      path: '/bids',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
    },
    { 
      id: 'bot-simulator', 
      label: 'Bot Simulator',
      path: '/bot-simulator',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ];

  const handlePageChange = (path) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  const isPageActive = (page) => {
    if (page.id === 'auctions') {
      return location.pathname === '/auctions' || location.pathname.startsWith('/auctions/');
    }
    return location.pathname === page.path;
  };

  return (
    <nav className="mb-6">
      {/* Desktop Navigation */}
      <div className="hidden md:flex items-center gap-2">
        {pages.map((page) => {
          const isActive = isPageActive(page);
          return (
            <Tooltip key={page.id} content={page.label} position="bottom">
              <Button
                variant={isActive ? 'primary' : 'ghost'}
                size="md"
                onClick={() => handlePageChange(page.path)}
                leftIcon={page.icon}
                className={isActive ? '' : 'text-text-secondary'}
              >
                {page.label}
              </Button>
            </Tooltip>
          );
        })}
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden">
        {/* Mobile Menu Button */}
        <Button
          variant="secondary"
          size="md"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          leftIcon={
            isMobileMenuOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )
          }
          className="w-full justify-between"
        >
          {pages.find(p => isPageActive(p))?.label || 'Menu'}
        </Button>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="mt-2 bg-bg-card border border-border rounded-lg overflow-hidden shadow-lg">
            {pages.map((page) => {
              const isActive = isPageActive(page);
              return (
                <button
                  key={page.id}
                  onClick={() => handlePageChange(page.path)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-fast ${
                    isActive
                      ? 'bg-accent-primary/20 text-text-primary border-l-4 border-accent-primary'
                      : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <span className={isActive ? 'text-accent-primary' : 'text-text-muted'}>
                    {page.icon}
                  </span>
                  <span className="font-medium">{page.label}</span>
                  {isActive && (
                    <svg className="w-4 h-4 ml-auto text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
};

export default NavBar;
