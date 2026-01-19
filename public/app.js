// State management
let currentUserId = null;
let currentAuctionId = null;
let cachedData = {
    auctions: null,
    auctionDetail: {},
    inventory: null,
    userBids: null,
};

// API helper
async function apiRequest(endpoint, options = {}) {
    const url = `http://localhost:3000${endpoint}`;
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.json();
}

// Auto refresh interval
let autoRefreshInterval = null;
let isUpdating = false; // Prevent multiple simultaneous updates

// WebSocket connection for real-time updates
let socket = null;
let socketConnected = false;

function initWebSocket() {
    try {
        // Load socket.io-client from CDN if not already loaded
        if (typeof io === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
            script.onload = () => connectWebSocket();
            document.head.appendChild(script);
        } else {
            connectWebSocket();
        }
    } catch (error) {
        console.error('Error initializing WebSocket:', error);
    }
}

function connectWebSocket() {
    if (socket) {
        socket.disconnect();
    }

    socket = io('http://localhost:3000/auctions', {
        transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
        socketConnected = true;
        console.log('WebSocket connected');
        
        // Subscribe to current auction if viewing one
        if (currentAuctionId) {
            socket.emit('subscribe', { auctionId: currentAuctionId });
        }
    });

    socket.on('disconnect', () => {
        socketConnected = false;
        console.log('WebSocket disconnected');
    });

    // Listen for bid updates
    socket.on('bid_update', (data) => {
        console.log('Bid update received:', data);
        if (data.auctionId === currentAuctionId) {
            // Refresh auction detail silently
            loadAuctionDetail(currentAuctionId, true);
        }
        // Always refresh auctions list
        loadAuctions(true);
    });

    // Listen for auction updates
    socket.on('auction_update', (data) => {
        console.log('Auction update received:', data);
        if (data.auctionId === currentAuctionId) {
            loadAuctionDetail(currentAuctionId, true);
        }
        loadAuctions(true);
    });

    // Listen for round closed events
    socket.on('round_closed', (data) => {
        console.log('Round closed:', data);
        if (data.auctionId === currentAuctionId) {
            loadAuctionDetail(currentAuctionId, true);
        }
        loadAuctions(true);
    });

    // Listen for auctions list updates
    socket.on('auctions_list_update', () => {
        loadAuctions(true);
    });
}

// Utility: Deep comparison for objects
function deepEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (!obj1 || !obj2) return false;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return obj1 === obj2;
    
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) return false;
    
    return keys1.every(key => deepEqual(obj1[key], obj2[key]));
}

// Utility: Update DOM element only if content changed
function updateElementIfChanged(elementId, newContent, preserveScroll = false) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    let scrollPosition = null;
    if (preserveScroll) {
        scrollPosition = element.scrollTop || window.scrollY;
    }
    
    const currentContent = element.innerHTML.trim();
    const newContentStr = typeof newContent === 'string' ? newContent : newContent.trim();
    
    if (currentContent !== newContentStr) {
        element.innerHTML = newContent;
        
        if (preserveScroll && scrollPosition !== null) {
            // Use requestAnimationFrame to restore scroll after DOM update
            requestAnimationFrame(() => {
                if (element.scrollTop !== undefined) {
                    element.scrollTop = scrollPosition;
                } else {
                    window.scrollTo(0, scrollPosition);
                }
            });
        }
    }
}

// Navigation
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(`${pageId}-page`).classList.add('active');
}

// User management
async function loadUsers() {
    const userSelect = document.getElementById('userSelect');
    if (!userSelect) return;

    try {
        const users = await apiRequest('/users');
        userSelect.innerHTML = '<option value="">Select a user...</option>';
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = `${user.username} (Balance: ${user.balance.toFixed(2)})`;
            userSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading users:', error);
        userSelect.innerHTML = '<option value="">Error loading users</option>';
    }
}

function selectUser() {
    const select = document.getElementById('userSelect');
    currentUserId = select.value;
    
    if (currentUserId) {
        document.getElementById('selectedUser').textContent = select.options[select.selectedIndex].text;
        loadUserBalance();
        loadInventory();
        loadUserBids();
    } else {
        document.getElementById('selectedUser').textContent = 'None';
    }
}

function createUser() {
    document.getElementById('userModal').style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
    document.getElementById('newUsername').value = '';
    document.getElementById('newUserBalance').value = '10000';
}

async function submitCreateUser() {
    const username = document.getElementById('newUsername').value.trim();
    const initialBalance = parseFloat(document.getElementById('newUserBalance').value) || 0;

    if (!username) {
        alert('Please enter a username');
        return;
    }

    try {
        await apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({
                username,
                initialBalance: initialBalance > 0 ? initialBalance : undefined,
            }),
        });

        alert('User created successfully!');
        closeUserModal();
        await loadUsers();
        cachedData.inventory = null; // Clear cache
    } catch (error) {
        alert(`Error creating user: ${error.message}`);
    }
}

// Balance
async function loadUserBalance() {
    if (!currentUserId) return;

    try {
        const balance = await apiRequest(`/users/${currentUserId}/balance`);
        document.getElementById('balanceValue').textContent = balance.balance.toFixed(2);
        document.getElementById('lockedBalanceValue').textContent = balance.lockedBalance.toFixed(2);
        document.getElementById('totalBalanceValue').textContent = balance.total.toFixed(2);
    } catch (error) {
        console.error('Error loading balance:', error);
    }
}

// Auction list - Smart update
async function loadAuctions(silent = false) {
    const auctionsList = document.getElementById('auctions-list');
    if (!auctionsList) return;
    
    if (isUpdating && !silent) return;
    isUpdating = true;
    
    if (!silent) {
        const scrollPosition = auctionsList.scrollTop || window.scrollY;
    }

    try {
        const auctions = await apiRequest('/auctions');

        if (auctions.length === 0) {
            updateElementIfChanged('auctions-list', '<p class="loading">No auctions found. Create one using the buttons above.</p>', true);
            isUpdating = false;
            cachedData.auctions = [];
            return;
        }

        // Get gift info and max bids for all auctions
        const auctionsWithDetails = await Promise.all(auctions.map(async (auction) => {
            let giftInfo = {};
            try {
                giftInfo = await apiRequest(`/gifts/${auction.giftId}`);
            } catch (error) {
                console.error('Error loading gift:', error);
            }

            let maxBid = 0;
            try {
                const bids = await apiRequest(`/auctions/${auction.id}/bids`);
                if (bids.length > 0) {
                    maxBid = Math.max(...bids.map(b => b.amount));
                }
            } catch (error) {
                console.error('Error loading bids:', error);
            }

            return { ...auction, giftInfo, maxBid };
        }));

        // Check if data actually changed
        if (deepEqual(cachedData.auctions, auctionsWithDetails)) {
            isUpdating = false;
            return; // No changes, skip DOM update
        }
        
        cachedData.auctions = auctionsWithDetails;

        const html = auctionsWithDetails.map(auction => {
            const statusClass = auction.status.toLowerCase();
            const roundInfo = auction.status === 'RUNNING' 
                ? `Round ${auction.currentRound + 1}/${auction.totalRounds}`
                : auction.status;
            
            const giftImage = auction.giftInfo.imageUrl 
                ? `<img src="${auction.giftInfo.imageUrl}" alt="${auction.giftInfo.title}" class="auction-card-image" onerror="this.parentElement.innerHTML='🎁'">`
                : '<div class="auction-card-image">🎁</div>';
            
            return `
                <div class="auction-card" onclick="showAuctionDetail('${auction.id}')">
                    ${giftImage}
                    <div class="auction-card-content">
                        <h3>${auction.giftInfo.title || 'Auction'}</h3>
                        <span class="status ${statusClass}">${auction.status}</span>
                        <div class="info"><strong>Round:</strong> ${roundInfo}</div>
                        <div class="info"><strong>Total Gifts:</strong> ${auction.totalGifts}</div>
                        <div class="info"><strong>Min Bid:</strong> ${auction.minBid}</div>
                        ${auction.maxBid > 0 ? `
                            <div class="max-bid">
                                <div class="max-bid-label">Current Max Bid</div>
                                <div class="max-bid-value">${auction.maxBid.toFixed(2)}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        updateElementIfChanged('auctions-list', html, true);
    } catch (error) {
        if (!silent) {
            updateElementIfChanged('auctions-list', `<div class="error">Error loading auctions: ${error.message}</div>`, true);
        }
    } finally {
        isUpdating = false;
    }
}

// Auction detail - Smart update
async function showAuctionDetail(auctionId) {
    // Unsubscribe from previous auction
    if (socket && socketConnected && currentAuctionId) {
        socket.emit('unsubscribe', { auctionId: currentAuctionId });
    }
    
    currentAuctionId = auctionId;
    showPage('auction-detail');
    
    // Subscribe to new auction
    if (socket && socketConnected) {
        socket.emit('subscribe', { auctionId });
    }
    
    await loadAuctionDetail(auctionId);
}

async function loadAuctionDetail(auctionId, silent = false) {
    const content = document.getElementById('auction-detail-content');
    if (!content) return;
    
    if (isUpdating && !silent) return;
    isUpdating = true;
    
    const scrollPosition = content.scrollTop || window.scrollY;

    try {
        const [auction, bids, rounds] = await Promise.all([
            apiRequest(`/auctions/${auctionId}`),
            apiRequest(`/auctions/${auctionId}/bids`),
            apiRequest(`/auctions/${auctionId}/rounds`),
        ]);

        // Check if data changed
        const dataKey = `${auctionId}`;
        const newData = { auction, bids, rounds };
        if (deepEqual(cachedData.auctionDetail[dataKey], newData)) {
            isUpdating = false;
            return; // No changes
        }
        cachedData.auctionDetail[dataKey] = newData;

        // Get gift info
        let giftInfo = {};
        try {
            giftInfo = await apiRequest(`/gifts/${auction.giftId}`);
        } catch (error) {
            console.error('Error loading gift:', error);
        }

        // Get user info for all bids
        const userIds = [...new Set(bids.map(b => b.userId))];
        const userInfoMap = {};
        for (const userId of userIds) {
            try {
                const user = await apiRequest(`/users/${userId}`);
                userInfoMap[userId] = user.username;
            } catch (error) {
                userInfoMap[userId] = userId.substring(0, 8) + '...';
            }
        }

        const statusClass = auction.status.toLowerCase();
        const timeRemaining = auction.currentRoundData && !auction.currentRoundData.closed
            ? Math.max(0, new Date(auction.currentRoundData.endsAt) - Date.now())
            : 0;

        // Calculate max bid (only from ACTIVE bids)
        const activeBids = bids.filter(b => b.status === 'ACTIVE');
        const maxBid = activeBids.length > 0 ? Math.max(...activeBids.map(b => b.amount)) : 0;
        const minBidToPlace = maxBid > 0 ? Math.max(auction.minBid, maxBid + 1) : auction.minBid;

        const giftImage = giftInfo.imageUrl 
            ? `<img src="${giftInfo.imageUrl}" alt="${giftInfo.title}" style="width: 100%; max-width: 400px; height: 300px; object-fit: cover; border-radius: 12px; margin-bottom: 24px;">`
            : '';

        const html = `
            <div class="auction-detail">
                ${giftImage}
                <h2>${giftInfo.title || 'Auction'}</h2>
                ${giftInfo.description ? `<p style="color: #a5b4fc; margin-bottom: 20px;">${giftInfo.description}</p>` : ''}
                <span class="status ${statusClass}">${auction.status}</span>

                ${maxBid > 0 ? `
                    <div class="current-max-bid">
                        <div class="current-max-bid-label">Current Maximum Bid</div>
                        <div class="current-max-bid-value">${maxBid.toFixed(2)}</div>
                        <div style="font-size: 14px; color: #a5b4fc; margin-top: 8px;">You need to bid at least ${minBidToPlace.toFixed(2)} to be the highest</div>
                    </div>
                ` : ''}

                <div class="detail-section">
                    <h3>Auction Information</h3>
                    <div class="info"><strong>Status:</strong> ${auction.status}</div>
                    <div class="info"><strong>Current Round:</strong> ${auction.currentRound + 1} / ${auction.totalRounds}</div>
                    <div class="info"><strong>Total Gifts:</strong> ${auction.totalGifts}</div>
                    <div class="info"><strong>Minimum Bid:</strong> ${auction.minBid}</div>
                    ${auction.currentRoundData ? `
                        <div class="info"><strong>Round Ends:</strong> ${new Date(auction.currentRoundData.endsAt).toLocaleString()}</div>
                        <div class="info"><strong>Time Remaining:</strong> <span id="timeRemaining">${formatTime(timeRemaining)}</span></div>
                    ` : ''}
                </div>

                ${auction.status === 'CREATED' ? `
                    <div class="detail-section">
                        <button onclick="startAuction('${auctionId}')" class="btn-primary">Start Auction</button>
                    </div>
                ` : ''}
                ${auction.status === 'RUNNING' && currentUserId ? `
                    <div class="detail-section">
                        <h3>Place Bid</h3>
                        ${maxBid > 0 ? `<div style="color: #a5b4fc; margin-bottom: 16px; font-size: 14px;">Current maximum bid: <strong style="color: #93c5fd;">${maxBid.toFixed(2)}</strong>. You need to bid at least <strong style="color: #93c5fd;">${minBidToPlace.toFixed(2)}</strong> to be the highest.</div>` : ''}
                        <div class="bid-form">
                            <div class="form-group">
                                <label>Bid Amount</label>
                                <input type="number" id="bidAmount" min="${minBidToPlace}" value="${minBidToPlace}" step="10">
                            </div>
                            <button onclick="placeBid('${auctionId}')" class="btn-primary">Place Bid</button>
                        </div>
                        <div id="bid-result"></div>
                    </div>
                ` : ''}

                <div class="detail-section">
                    <h3>All Bids (${bids.length})</h3>
                    <div class="bids-list">
                        ${bids.length === 0 
                            ? '<p>No bids yet</p>'
                            : bids
                                .sort((a, b) => b.amount - a.amount)
                                .map(bid => {
                                    const username = userInfoMap[bid.userId] || bid.userId.substring(0, 8) + '...';
                                    return `
                                        <div class="bid-item">
                                            <div>
                                                <div class="bid-amount">${bid.amount.toFixed(2)}</div>
                                                <div style="font-size: 13px; color: #a5b4fc; margin-top: 4px;">
                                                    ${username}
                                                    ${bid.userId === currentUserId ? ' <span style="color: #4ade80;">(You)</span>' : ''}
                                                </div>
                                                <div style="font-size: 12px; color: #818cf8; margin-top: 2px;">Round ${bid.roundIndex + 1}</div>
                                            </div>
                                            <span class="bid-status ${bid.status}">${bid.status}</span>
                                        </div>
                                    `;
                                }).join('')
                        }
                    </div>
                </div>

                <div class="detail-section">
                    <h3>Rounds (${rounds.length})</h3>
                    <div class="rounds-list">
                        ${rounds.map(round => {
                            const winnersList = round.winners && round.winners.length > 0
                                ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(147, 197, 253, 0.1);">
                                    <div style="font-weight: 600; color: #93c5fd; margin-bottom: 8px;">Winners (${round.winners.length}):</div>
                                    ${round.winners.map(winner => `
                                        <div style="padding: 8px; background: rgba(59, 130, 246, 0.1); border-radius: 8px; margin-bottom: 6px;">
                                            <div style="font-weight: 600; color: #93c5fd;">${winner.username}</div>
                                            <div style="font-size: 13px; color: #a5b4fc;">Won for ${winner.bidAmount.toFixed(2)} • ${new Date(winner.wonAt).toLocaleString()}</div>
                                        </div>
                                    `).join('')}
                                   </div>`
                                : round.closed ? `<div style="margin-top: 12px; color: #a5b4fc; font-size: 14px;">No winners in this round</div>` : '';
                            
                            return `
                                <div class="round-item ${round.closed ? 'closed' : ''}">
                                    <h4>Round ${round.roundIndex + 1}</h4>
                                    <div class="info"><strong>Started:</strong> ${new Date(round.startedAt).toLocaleString()}</div>
                                    <div class="info"><strong>Ends:</strong> ${new Date(round.endsAt).toLocaleString()}</div>
                                    <div class="info"><strong>Status:</strong> ${round.closed ? 'Closed' : 'Active'}</div>
                                    ${round.closed ? `<div class="info"><strong>Winners Count:</strong> ${round.winnersCount}</div>` : ''}
                                    ${winnersList}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        updateElementIfChanged('auction-detail-content', html, true);

        // Start countdown if round is active
        if (timeRemaining > 0) {
            startCountdown(auction.currentRoundData.endsAt);
        }
    } catch (error) {
        if (!silent) {
            updateElementIfChanged('auction-detail-content', `<div class="error">Error loading auction: ${error.message}</div>`, true);
        }
    } finally {
        isUpdating = false;
    }
}

// Countdown timer
let countdownInterval = null;

function startCountdown(endsAt) {
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownInterval = setInterval(() => {
        const timeRemaining = Math.max(0, new Date(endsAt) - Date.now());
        const timeRemainingEl = document.getElementById('timeRemaining');
        if (timeRemainingEl) {
            timeRemainingEl.textContent = formatTime(timeRemaining);
        }
        if (timeRemaining <= 0) {
            clearInterval(countdownInterval);
            // Reload auction detail after round ends
            if (currentAuctionId) {
                setTimeout(() => loadAuctionDetail(currentAuctionId, true), 1000);
            }
        }
    }, 1000);
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Place bid
async function placeBid(auctionId) {
    const bidAmount = parseFloat(document.getElementById('bidAmount').value);
    const resultDiv = document.getElementById('bid-result');

    if (!currentUserId) {
        resultDiv.innerHTML = '<div class="error">Please select a user first</div>';
        return;
    }

    if (!bidAmount || bidAmount <= 0) {
        resultDiv.innerHTML = '<div class="error">Please enter a valid bid amount</div>';
        return;
    }

    resultDiv.innerHTML = '<div class="loading">Placing bid...</div>';

    try {
        await apiRequest(`/auctions/${auctionId}/bids`, {
            method: 'POST',
            body: JSON.stringify({
                userId: currentUserId,
                amount: bidAmount,
            }),
        });

        resultDiv.innerHTML = '<div class="success">Bid placed successfully!</div>';
        cachedData.auctionDetail[auctionId] = null; // Clear cache
        cachedData.auctions = null; // Clear cache
        await Promise.all([
            loadAuctionDetail(auctionId, true),
            loadAuctions(true),
            loadUserBalance(),
        ]);
        
        setTimeout(() => {
            resultDiv.innerHTML = '';
        }, 3000);
    } catch (error) {
        resultDiv.innerHTML = `<div class="error">Error placing bid: ${error.message}</div>`;
    }
}

// Start auction
async function startAuction(auctionId) {
    try {
        await apiRequest(`/auctions/${auctionId}/start`, {
            method: 'POST',
        });
        alert('Auction started successfully!');
        cachedData.auctionDetail[auctionId] = null; // Clear cache
        cachedData.auctions = null; // Clear cache
        await loadAuctionDetail(auctionId, true);
    } catch (error) {
        alert(`Error starting auction: ${error.message}`);
    }
}

// Gifts
async function loadGiftsForSelect() {
    const selectElements = ['newAuctionGiftId', 'addGiftGiftId'];
    
    try {
        const gifts = await apiRequest('/gifts');
        
        selectElements.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select a gift...</option>';
            gifts.forEach(gift => {
                const option = document.createElement('option');
                option.value = gift.id;
                option.textContent = gift.title;
                if (gift.id === currentValue) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        });
    } catch (error) {
        console.error('Error loading gifts:', error);
    }
}

function createGift() {
    loadGiftsForSelect();
    document.getElementById('giftModal').style.display = 'flex';
}

function closeGiftModal() {
    document.getElementById('giftModal').style.display = 'none';
    document.getElementById('newGiftTitle').value = '';
    document.getElementById('newGiftDescription').value = '';
    document.getElementById('newGiftImageUrl').value = '';
    document.getElementById('newGiftBasePrice').value = '100';
    document.getElementById('newGiftTotalSupply').value = '1';
}

async function submitCreateGift() {
    const title = document.getElementById('newGiftTitle').value.trim();
    const description = document.getElementById('newGiftDescription').value.trim();
    const imageUrl = document.getElementById('newGiftImageUrl').value.trim();
    const basePrice = parseFloat(document.getElementById('newGiftBasePrice').value);
    const totalSupply = parseInt(document.getElementById('newGiftTotalSupply').value);

    if (!title) {
        alert('Please enter a title');
        return;
    }

    try {
        await apiRequest('/gifts', {
            method: 'POST',
            body: JSON.stringify({
                title,
                description: description || undefined,
                imageUrl: imageUrl || undefined,
                basePrice,
                totalSupply,
            }),
        });

        alert('Gift created successfully!');
        closeGiftModal();
        await loadGiftsForSelect();
    } catch (error) {
        alert(`Error creating gift: ${error.message}`);
    }
}

// Auctions
function createAuction() {
    loadGiftsForSelect();
    document.getElementById('auctionModal').style.display = 'flex';
}

function closeAuctionModal() {
    document.getElementById('auctionModal').style.display = 'none';
    document.getElementById('newAuctionGiftId').value = '';
    document.getElementById('newAuctionTotalGifts').value = '2';
    document.getElementById('newAuctionTotalRounds').value = '3';
    document.getElementById('newAuctionRoundDuration').value = '60';
    document.getElementById('newAuctionMinBid').value = '100';
}

async function submitCreateAuction() {
    const giftId = document.getElementById('newAuctionGiftId').value;
    const totalGifts = parseInt(document.getElementById('newAuctionTotalGifts').value);
    const totalRounds = parseInt(document.getElementById('newAuctionTotalRounds').value);
    const roundDurationSeconds = parseInt(document.getElementById('newAuctionRoundDuration').value);
    const minBid = parseFloat(document.getElementById('newAuctionMinBid').value);

    if (!giftId) {
        alert('Please select a gift');
        return;
    }

    try {
        const auction = await apiRequest('/auctions', {
            method: 'POST',
            body: JSON.stringify({
                giftId,
                totalGifts,
                totalRounds,
                roundDurationMs: roundDurationSeconds * 1000,
                minBid,
            }),
        });

        alert(`Auction created successfully! ID: ${auction.id.substring(0, 8)}...`);
        closeAuctionModal();
        cachedData.auctions = null; // Clear cache
        await loadAuctions(true);
    } catch (error) {
        alert(`Error creating auction: ${error.message}`);
    }
}

// Inventory - Smart update
async function loadInventory(silent = false) {
    const inventoryList = document.getElementById('inventory-list');
    if (!inventoryList) return;

    if (!currentUserId) {
        updateElementIfChanged('inventory-list', '<p class="loading">Please select a user to view inventory</p>', true);
        return;
    }

    if (isUpdating && !silent) return;
    isUpdating = true;

    try {
        const inventory = await apiRequest(`/users/${currentUserId}/inventory`);

        // Check if data changed
        if (deepEqual(cachedData.inventory, inventory)) {
            isUpdating = false;
            return; // No changes
        }
        cachedData.inventory = inventory;

        if (inventory.length === 0) {
            const html = `
                <div style="text-align: center; padding: 40px;">
                    <p style="color: #a5b4fc; margin-bottom: 20px;">No gifts in inventory yet. Win an auction to get gifts!</p>
                    <button onclick="showAddGiftModal()" class="btn-secondary" style="margin-top: 12px;">Add Gift to Inventory (Demo)</button>
                </div>
            `;
            updateElementIfChanged('inventory-list', html, true);
            isUpdating = false;
            return;
        }

        const html = `
            <div style="margin-bottom: 16px;">
                <button onclick="showAddGiftModal()" class="btn-secondary">Add Gift to Inventory (Demo)</button>
            </div>
            <div class="inventory-grid">
                ${inventory.map(item => {
                    const giftImage = item.giftImageUrl 
                        ? `<img src="${item.giftImageUrl}" alt="${item.giftTitle}" class="inventory-item-image" onerror="this.parentElement.innerHTML='🎁'">`
                        : '<div class="inventory-item-image">🎁</div>';
                    
                    return `
                        <div class="inventory-item">
                            ${giftImage}
                            <div class="inventory-item-content">
                                <h3>${item.giftTitle}</h3>
                                ${item.giftDescription ? `<div class="description">${item.giftDescription}</div>` : ''}
                                <div class="bid-info">
                                    <div class="bid-info-label">Won for</div>
                                    <div class="bid-info-value">${item.bidAmount.toFixed(2)}</div>
                                </div>
                                <div style="font-size: 12px; color: #a5b4fc; margin-top: 8px;">Round ${item.roundIndex + 1} • ${new Date(item.wonAt).toLocaleDateString()}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        updateElementIfChanged('inventory-list', html, true);
    } catch (error) {
        if (!silent) {
            updateElementIfChanged('inventory-list', `<div class="error">Error loading inventory: ${error.message}</div>`, true);
        }
    } finally {
        isUpdating = false;
    }
}

function showAddGiftModal() {
    loadGiftsForSelect();
    document.getElementById('addGiftModal').style.display = 'flex';
}

function closeAddGiftModal() {
    document.getElementById('addGiftModal').style.display = 'none';
    document.getElementById('addGiftGiftId').value = '';
    document.getElementById('addGiftBidAmount').value = '100';
}

async function submitAddGift() {
    const giftId = document.getElementById('addGiftGiftId').value;
    const bidAmount = parseFloat(document.getElementById('addGiftBidAmount').value);

    if (!giftId) {
        alert('Please select a gift');
        return;
    }

    if (!currentUserId) {
        alert('Please select a user first');
        return;
    }

    try {
        await apiRequest(`/users/${currentUserId}/inventory/add`, {
            method: 'POST',
            body: JSON.stringify({
                giftId,
                bidAmount: bidAmount || 100,
            }),
        });

        alert('Gift added to inventory successfully!');
        closeAddGiftModal();
        cachedData.inventory = null; // Clear cache
        await loadInventory(true);
    } catch (error) {
        alert(`Error adding gift: ${error.message}`);
    }
}

// User bids
async function loadUserBids(silent = false) {
    const userBidsList = document.getElementById('user-bids-list');
    if (!userBidsList) return;

    if (!currentUserId) {
        updateElementIfChanged('user-bids-list', '<p class="loading">Please select a user to view bids</p>', true);
        return;
    }

    if (isUpdating && !silent) return;
    isUpdating = true;

    try {
        const bids = await apiRequest(`/users/${currentUserId}/bids`);

        // Check if data changed
        if (deepEqual(cachedData.userBids, bids)) {
            isUpdating = false;
            return;
        }
        cachedData.userBids = bids;

        if (bids.length === 0) {
            updateElementIfChanged('user-bids-list', '<p class="loading">No bids yet. Place a bid on an auction!</p>', true);
            isUpdating = false;
            return;
        }

        const html = bids.map(bid => {
            const statusClass = bid.status.toLowerCase();
            return `
                <div class="bid-item">
                    <div>
                        <div class="bid-amount">${bid.amount.toFixed(2)}</div>
                        <div style="font-size: 13px; color: #a5b4fc; margin-top: 4px;">Auction: ${bid.auctionId.substring(0, 8)}...</div>
                        <div style="font-size: 12px; color: #818cf8; margin-top: 2px;">Round ${bid.roundIndex + 1}</div>
                    </div>
                    <span class="bid-status ${statusClass}">${bid.status}</span>
                </div>
            `;
        }).join('');
        
        updateElementIfChanged('user-bids-list', html, true);
    } catch (error) {
        if (!silent) {
            updateElementIfChanged('user-bids-list', `<div class="error">Error loading bids: ${error.message}</div>`, true);
        }
    } finally {
        isUpdating = false;
    }
}

// Bot simulation
async function runBotSimulation() {
    const numBots = parseInt(document.getElementById('numBots').value) || 5;
    const bidsPerBot = parseInt(document.getElementById('bidsPerBot').value) || 10;
    const minBid = parseFloat(document.getElementById('minBidAmount').value) || 100;
    const maxBid = parseFloat(document.getElementById('maxBidAmount').value) || 1000;

    // Get all auctions
    const auctions = await apiRequest('/auctions');
    const runningAuctions = auctions.filter(a => a.status === 'RUNNING');

    if (runningAuctions.length === 0) {
        alert('No running auctions found. Please start an auction first.');
        return;
    }

    const statusDiv = document.getElementById('bot-status');
    statusDiv.innerHTML = '<div class="loading">Creating bots and placing bids...</div>';

    try {
        // Create bots
        const botUsers = [];
        for (let i = 0; i < numBots; i++) {
            const username = `bot_${Date.now()}_${i}`;
            const user = await apiRequest('/users', {
                method: 'POST',
                body: JSON.stringify({
                    username,
                    initialBalance: 100000,
                }),
            });
            botUsers.push(user);
        }

        statusDiv.innerHTML = `<div class="success">Created ${numBots} bots. Placing bids...</div>`;

        // Place bids randomly
        let bidsPlaced = 0;
        for (const bot of botUsers) {
            for (let i = 0; i < bidsPerBot; i++) {
                const auction = runningAuctions[Math.floor(Math.random() * runningAuctions.length)];
                const bidAmount = minBid + Math.random() * (maxBid - minBid);

                try {
                    // Use /bids/bot endpoint for bot simulation (has higher rate limits)
                    await apiRequest(`/auctions/${auction.id}/bids/bot`, {
                        method: 'POST',
                        body: JSON.stringify({
                            userId: bot.id,
                            amount: bidAmount,
                        }),
                    });
                    bidsPlaced++;
                } catch (error) {
                    console.error(`Error placing bid for bot ${bot.username}:`, error);
                }

                // Small delay between bids
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        statusDiv.innerHTML = `<div class="success">Bot simulation complete! Created ${numBots} bots and placed ${bidsPlaced} bids.</div>`;
        
        // Refresh data
        cachedData.auctions = null;
        cachedData.auctionDetail = {};
        await Promise.all([
            loadAuctions(true),
            loadUsers(),
        ]);
        
        if (currentAuctionId) {
            await loadAuctionDetail(currentAuctionId, true);
        }
    } catch (error) {
        statusDiv.innerHTML = `<div class="error">Error in bot simulation: ${error.message}</div>`;
    }
}

// Auto refresh with smart updates (fallback if WebSocket fails)
function startAutoRefresh() {
    // Clear existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    // Refresh every 10 seconds as fallback (WebSocket handles real-time updates)
    // Only refresh if WebSocket is not connected
    autoRefreshInterval = setInterval(() => {
        if (socketConnected) return; // Skip if WebSocket is connected
        
        if (isUpdating) return; // Skip if already updating
        
        const activePage = document.querySelector('.page.active');
        if (!activePage) return;

        const pageId = activePage.id;
        
        // Silent refresh - only updates if data actually changed
        if (pageId === 'auctions-page') {
            loadAuctions(true); // Silent mode
        } else if (pageId === 'auction-detail-page' && currentAuctionId) {
            loadAuctionDetail(currentAuctionId, true); // Silent mode
        } else if (pageId === 'inventory-page' && currentUserId) {
            loadInventory(true); // Silent mode
        } else if (pageId === 'user-bids-page' && currentUserId) {
            loadUserBids(true); // Silent mode
        }
        
        // Always refresh balance if user is selected (lightweight)
        if (currentUserId) {
            loadUserBalance();
        }
    }, 10000); // 10 seconds fallback polling
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    loadAuctions();
    initWebSocket(); // Initialize WebSocket connection
    startAutoRefresh(); // Keep polling as fallback, but WebSocket will handle most updates
});

// Export functions to window
window.showPage = showPage;
window.selectUser = selectUser;
window.createUser = createUser;
window.closeUserModal = closeUserModal;
window.submitCreateUser = submitCreateUser;
window.showAuctionDetail = showAuctionDetail;
window.placeBid = placeBid;
window.startAuction = startAuction;
window.createGift = createGift;
window.closeGiftModal = closeGiftModal;
window.submitCreateGift = submitCreateGift;
window.createAuction = createAuction;
window.closeAuctionModal = closeAuctionModal;
window.submitCreateAuction = submitCreateAuction;
window.loadInventory = loadInventory;
window.showAddGiftModal = showAddGiftModal;
window.closeAddGiftModal = closeAddGiftModal;
window.submitAddGift = submitAddGift;
window.loadUserBids = loadUserBids;
window.runBotSimulation = runBotSimulation;
