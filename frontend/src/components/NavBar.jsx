const NavBar = ({ currentPage, onPageChange }) => {
  const pages = [
    { id: 'auctions', label: 'Auctions' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'user-bids', label: 'My Bids' },
    { id: 'bot-simulator', label: 'Bot Simulator' },
  ];

  return (
    <nav>
      {pages.map((page) => (
        <button
          key={page.id}
          className={`nav-btn ${currentPage === page.id ? 'active' : ''}`}
          onClick={() => onPageChange(page.id)}
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
};

export default NavBar;
