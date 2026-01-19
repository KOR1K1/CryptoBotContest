const NavBar = ({ currentPage, onPageChange }) => {
  const pages = [
    { id: 'auctions', label: 'Auctions', icon: '🎁' },
    { id: 'inventory', label: 'Inventory', icon: '📦' },
    { id: 'user-bids', label: 'My Bids', icon: '💰' },
    { id: 'bot-simulator', label: 'Bot Simulator', icon: '🤖' },
  ];

  return (
    <nav style={{
      display: 'flex',
      gap: '12px',
      marginBottom: '24px',
      flexWrap: 'wrap',
      background: 'rgba(30, 41, 59, 0.6)',
      padding: '12px',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.1)',
    }}>
      {pages.map((page) => (
        <button
          key={page.id}
          className={`nav-btn ${currentPage === page.id ? 'active' : ''}`}
          onClick={() => onPageChange(page.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            borderRadius: '10px',
            transition: 'all var(--transition-normal)',
          }}
        >
          <span style={{ fontSize: '18px' }}>{page.icon}</span>
          <span>{page.label}</span>
        </button>
      ))}
    </nav>
  );
};

export default NavBar;
