function generatePicksForRace(draftType, raceId) {
    const isChilton = draftType === 'chilton';
    const submissionsForRace = (state.submissions && state.submissions.draft && state.submissions.draft[raceId]) ? state.submissions.draft[raceId] : {};
    const submittedUsers = state.users.filter(u => submissionsForRace[u.id]);
    // If no submissions, return empty
    if (submittedUsers.length === 0) return [];
    
    // Use turn order (sorted by turnOrder array)
    const turnOrder = state.turnOrder || state.users.map(u => u.id);
    const order = submittedUsers.sort((a, b) => {
        const aIndex = turnOrder.indexOf(a.id);
        const bIndex = turnOrder.indexOf(b.id);
        return aIndex - bIndex;
    });
    
    const picks = [];
    const usedDrivers = new Set();
    
    for (let round = 1; round <= 2; round++) {
        const roundOrder = round === 2 ? [...order].reverse() : order;
        roundOrder.forEach(user => {
            const rankings = (state.userRankings && state.userRankings[draftType] && state.userRankings[draftType][user.id] && state.userRankings[draftType][user.id][raceId]) ? state.userRankings[draftType][user.id][raceId] : [];
            const list = isChilton ? [...rankings].reverse() : rankings;
            for (const driverId of list) {
                if (!usedDrivers.has(driverId)) {
                    picks.push({ userId: user.id, driverId, round, pickNumber: picks.length + 1 });
                    usedDrivers.add(driverId);
                    break;
                }
            }
        });
    }
    return picks;
}
// F1 Driver Data (2025 Season - Updated November 3, 2025)
const DRIVERS = [
    // Red Bull Racing
    { id: 1, name: "Max Verstappen", team: "Red Bull" },
    { id: 2, name: "Yuki Tsunoda", team: "Red Bull" },
    // Mercedes-AMG Petronas F1 Team
    { id: 3, name: "George Russell", team: "Mercedes" },
    { id: 4, name: "Kimi Antonelli", team: "Mercedes" },
    // Scuderia Ferrari HP
    { id: 5, name: "Charles Leclerc", team: "Ferrari" },
    { id: 6, name: "Lewis Hamilton", team: "Ferrari" },
    // McLaren Formula 1 Team
    { id: 7, name: "Lando Norris", team: "McLaren" },
    { id: 8, name: "Oscar Piastri", team: "McLaren" },
    // Aston Martin Aramco F1 Team
    { id: 9, name: "Fernando Alonso", team: "Aston Martin" },
    { id: 10, name: "Lance Stroll", team: "Aston Martin" },
    // BWT Alpine F1 Team
    { id: 11, name: "Pierre Gasly", team: "Alpine" },
    { id: 12, name: "Franco Colapinto", team: "Alpine" },
    // MoneyGram Haas F1 Team
    { id: 13, name: "Esteban Ocon", team: "Haas" },
    { id: 14, name: "Oliver Bearman", team: "Haas" },
    // Stake F1 Team Kick Sauber
    { id: 15, name: "Nico Hulkenberg", team: "Sauber" },
    { id: 16, name: "Gabriel Bortoleto", team: "Sauber" },
    // Atlassian Williams Racing
    { id: 17, name: "Alex Albon", team: "Williams" },
    { id: 18, name: "Carlos Sainz", team: "Williams" },
    // Racing Bulls-Honda RBPT
    { id: 19, name: "Liam Lawson", team: "Racing Bulls" },
    { id: 20, name: "Isack Hadjar", team: "Racing Bulls" }
];

// Application State
let state = {
    users: [],
    currentUser: null, // Track current user session
    currentDraft: null,
    draftHistory: {
        grojean: {},  // Changed to object keyed by raceId
        chilton: {}
    },
    userRankings: {
        grojean: {},  // User rankings for each draft type: { userId: { raceId: [driverIds...] } }
        chilton: {}
    },
    bonusPicks: {
        pole: {},
        top5: {}
    },
    raceCalendar: [],  // Race calendar with deadlines
    races: [],
    standings: {},
    submissions: { draft: {}, bonus: {} },
    history: [],  // Undo/redo history
    turnOrder: []  // Draft turn order: array of user IDs
};

// Wait for Firebase to be ready with retries
function waitForFirebase(callback, maxWait = 4000) {
    const startTime = Date.now();
    
    function check() {
        if (checkFirebase()) {
            callback(true);
            return;
        }
        
        if (Date.now() - startTime < maxWait) {
            // Retry after 100ms
            setTimeout(check, 100);
        } else {
            // Timeout - Firebase didn't load
            callback(false);
        }
    }
    
    // Start checking
    check();
    
    // Also listen for firebaseReady event
    window.addEventListener('firebaseReady', function() {
        if (checkFirebase()) {
            callback(true);
        }
    }, { once: true });
}

// Cleanup function to remove all users
function clearAllUsers() {
    console.log('Clearing all users...', state.users.length, 'users found');
    
    // Clear all users and related data
    state.users = [];
    state.currentUser = null;
    state.bonusPicks = { pole: {}, top5: {} };
    state.userRankings = { grojean: {}, chilton: {} };
    state.draftHistory = { grojean: {}, chilton: {} };
    state.currentDraft = null;
    
    // Clear current user from localStorage
    localStorage.removeItem('currentUserId');
    
    // Force save to both Firebase and localStorage to ensure cleanup
    if (checkFirebase()) {
        console.log('Saving cleared state to Firebase...');
        saveStateToFirebase();
        // Also save to localStorage as backup
        localStorage.setItem('f1DraftState', JSON.stringify(state));
    } else {
        console.log('Saving cleared state to localStorage...');
        localStorage.setItem('f1DraftState', JSON.stringify(state));
    }
    
    // Refresh UI
    renderUsers();
    updateDraftDisplay();
    renderBonusPicks();
    console.log('✅ All users cleared! State saved.');
}

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ F1 Family Draft v3.0 loaded - Updated Nov 3 2025');
    // Initialize UI first (so tabs work even if Firebase fails)
    try {
        initializeUI();
    } catch (e) {
        console.error('Error initializing UI:', e);
    }
    
    // Wait for Firebase to load (with timeout)
    waitForFirebase(function(firebaseAvailable) {
        if (firebaseAvailable) {
            updateSyncStatus('syncing');
            try {
                if (typeof firebase !== 'undefined' && firebase.database) {
                    try { firebase.database().goOnline(); } catch (e) {}
                }
                loadState();
                // Removed one-off cleanup: do not clear users on load
            } catch (e) {
                console.error('Error loading from Firebase:', e);
                updateSyncStatus('error');
                loadStateFromLocalStorage();
            }
        } else {
            updateSyncStatus('local');
            try {
                loadStateFromLocalStorage();
            } catch (e) {
                console.error('Error loading from localStorage:', e);
            }
        }
    }, 10000); // Wait up to 10 seconds for Firebase
    
    // Initialize user detection after a short delay
    setTimeout(() => {
        try {
            if (typeof detectCurrentUser === 'function') {
                detectCurrentUser();
            }
        } catch (e) {
            console.error('Error detecting user:', e);
        }
    }, 100);
    
    // Set up event listeners
    try {
        setupEventListeners();
    } catch (e) {
        console.error('Error setting up event listeners:', e);
    }
    
    // Render content (these can fail without breaking navigation)
    try {
        if (typeof renderDrivers === 'function') renderDrivers();
    } catch (e) { console.error('Error rendering drivers:', e); }
    
    try {
        if (typeof renderUsers === 'function') renderUsers();
    } catch (e) { console.error('Error rendering users:', e); }
    
    try {
        if (typeof renderCalendar === 'function') renderCalendar();
    } catch (e) { console.error('Error rendering calendar:', e); }
    
    try {
        if (typeof updateDraftDisplay === 'function') updateDraftDisplay();
    } catch (e) { console.error('Error updating draft:', e); }
    
    try {
        if (typeof renderBonusPicks === 'function') renderBonusPicks();
    } catch (e) { console.error('Error rendering bonus picks:', e); }
    
    try {
        renderRaceResultsPage();
    } catch (e) { console.error('Error rendering race results page:', e); }
    
    try {
        if (typeof updateStandingsDisplay === 'function') updateStandingsDisplay();
    } catch (e) { console.error('Error updating standings:', e); }
    
    try {
        if (typeof updateAdminControls === 'function') updateAdminControls();
    } catch (e) { console.error('Error updating admin controls:', e); }

    // Start draft window timer to auto-lock on deadlines
    startDraftWindowTimer();
});

// Check if Firebase is available (will be set dynamically)
let USE_FIREBASE = false;

// Function to check Firebase availability
function checkFirebase() {
    // Check multiple ways to ensure Firebase is loaded
    if (typeof firebase !== 'undefined' && 
        firebase.database && 
        typeof firebase.database === 'function') {
        USE_FIREBASE = true;
        return true;
    }
    
    // Also check window.firebaseReady flag
    if (window.firebaseReady && typeof firebase !== 'undefined') {
        USE_FIREBASE = true;
        return true;
    }
    
    USE_FIREBASE = false;
    return false;
}

// Update sync status indicator
function updateSyncStatus(status) {
    const syncStatus = document.getElementById('syncStatus');
    if (!syncStatus) return;
    
    syncStatus.className = 'sync-status';
    if (status === 'synced') {
        syncStatus.textContent = '✅ Shared';
        syncStatus.classList.add('synced');
        syncStatus.title = 'Connected - Data synced with all devices';
    } else if (status === 'syncing') {
        syncStatus.textContent = '🔄 Syncing...';
        syncStatus.classList.add('syncing');
        syncStatus.title = 'Connecting to shared database...';
    } else if (status === 'error') {
        syncStatus.textContent = '⚠️ Offline';
        syncStatus.title = 'Using local data - check connection';
    } else {
        syncStatus.textContent = '🔄 Local';
        syncStatus.title = 'Using local storage (not shared)';
    }
}

// Load state from Firebase or localStorage
function loadState() {
    // Re-check Firebase each time (in case scripts loaded late)
    if (checkFirebase()) {
        // Load from Firebase (shared data)
        loadStateFromFirebase();
    } else {
        // Fallback to localStorage (local only)
        loadStateFromLocalStorage();
    }
}

function loadStateFromLocalStorage() {
    const saved = localStorage.getItem('f1DraftState');
    if (saved) {
        try {
            const loaded = JSON.parse(saved);
            state = { ...state, ...loaded };
            // Ensure all data structures exist
            if (!state.draftHistory) state.draftHistory = { grojean: {}, chilton: {} };
            if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
            if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
            if (!state.races) state.races = [];
            if (!state.raceCalendar) state.raceCalendar = [];
            if (!state.standings) state.standings = {};
            if (!state.history) state.history = [];
        } catch (e) {
            // Error loading
        }
    }
}

function loadStateFromFirebase() {
    if (!checkFirebase()) {
        loadStateFromLocalStorage();
        return;
    }
    
    const db = firebase.database();
    const stateRef = db.ref('appState');
    
    updateSyncStatus('syncing');
    
    // Load initial state
    stateRef.once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state = { ...state, ...data };
            // Ensure all data structures exist
            if (!state.draftHistory) state.draftHistory = { grojean: {}, chilton: {} };
            if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
            if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
            if (!state.races) state.races = [];
            if (!state.raceCalendar) state.raceCalendar = [];
            if (!state.standings) state.standings = {};
            if (!state.history) state.history = [];
            
            // Refresh UI after loading
            renderUsers();
            renderCalendar();
            updateDraftDisplay();
            renderBonusPicks();
            updateStandingsDisplay();
            updateSyncStatus('synced');
        } else {
            updateSyncStatus('synced');
        }
    }).catch((error) => {
        console.error('Firebase load error:', error);
        updateSyncStatus('error');
        // Fallback to localStorage if Firebase fails
        loadStateFromLocalStorage();
    });
    
    // Listen for real-time changes from other users
    stateRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            state = { ...state, ...data };
            // Ensure all data structures exist
            if (!state.draftHistory) state.draftHistory = { grojean: {}, chilton: {} };
            if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
            if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
            if (!state.races) state.races = [];
            if (!state.raceCalendar) state.raceCalendar = [];
            if (!state.standings) state.standings = {};
            if (!state.history) state.history = [];
            
            // Refresh UI when data changes
            renderUsers();
            populateCurrentUserSelect();
            detectCurrentUser();
            renderCalendar();
            updateDraftDisplay();
            renderBonusPicks();
            updateStandingsDisplay();
            updateSyncStatus('synced');
        }
    }, (error) => {
        console.error('Firebase listener error:', error);
        updateSyncStatus('error');
    });
}

// Save state to Firebase or localStorage
function saveState() {
    // Re-check Firebase each time
    if (checkFirebase()) {
        // Save to Firebase (shared data)
        saveStateToFirebase();
    } else {
        // Fallback to localStorage (local only)
        saveStateToLocalStorage();
    }
}

function saveStateToLocalStorage() {
    // Use history-aware save if available, otherwise simple save
    if (typeof saveStateWithHistory === 'function') {
        saveStateWithHistory();
    } else {
        localStorage.setItem('f1DraftState', JSON.stringify(state));
    }
}

function saveStateToFirebase() {
    if (!checkFirebase()) return;
    
    updateSyncStatus('syncing');
    
    const db = firebase.database();
    const stateRef = db.ref('appState');
    
    // Save state to Firebase
    // Remove history before saving (don't sync history)
    const stateToSave = { ...state };
    delete stateToSave.history; // Don't sync history
    
    // Use set() to completely overwrite (not update)
    stateRef.set(stateToSave).then(() => {
        updateSyncStatus('synced');
        console.log('State saved to Firebase successfully');
    }).catch((error) => {
        // If save fails, fallback to localStorage
        console.error('Firebase save error:', error);
        updateSyncStatus('error');
        localStorage.setItem('f1DraftState', JSON.stringify(state));
    });
}

// Tab Navigation
function initializeUI() {
    // Set up tab navigation
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    if (tabButtons.length === 0) {
        return;
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const tabName = btn.dataset.tab;
            
            if (!tabName) {
                return;
            }
            
            // Remove active from all
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });
            
            // Add active to clicked button
            btn.classList.add('active');
            
            // Show target tab
            const targetTab = document.getElementById(`${tabName}-tab`);
            if (targetTab) {
                targetTab.classList.add('active');
                targetTab.style.display = 'block';
            }
            
            // Refresh content when switching tabs
            try {
                if (tabName === 'standings' && typeof updateStandingsDisplay === 'function') {
                    updateStandingsDisplay();
                } else if (tabName === 'draft' && typeof updateDraftDisplay === 'function') {
                    updateDraftDisplay();
                } else if (tabName === 'bonuses' && typeof renderBonusPicks === 'function') {
                    renderBonusPicks();
                } else if (tabName === 'calendar' && typeof renderCalendar === 'function') {
                    renderCalendar();
                    updateAdminControls(); // Update admin controls when calendar tab is shown
                } else if (tabName === 'drivers' && typeof renderDrivers === 'function') {
                    renderDrivers();
                } else if (tabName === 'users' && typeof renderUsers === 'function') {
                    renderUsers();
                }
            } catch (err) {
                // Silent fail
            }
        });
    });

    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        const isDark = localStorage.getItem('darkMode') === 'true';
        if (isDark) {
            document.body.classList.add('dark-mode');
            darkModeToggle.textContent = '☀️';
        }
        
        darkModeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.toggle('dark-mode');
            const isDarkNow = document.body.classList.contains('dark-mode');
            localStorage.setItem('darkMode', isDarkNow);
            darkModeToggle.textContent = isDarkNow ? '☀️' : '🌙';
        });
    }
    
    // Ensure initial tab is visible
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) {
        activeTab.style.display = 'block';
    }
    
    // Hide all non-active tabs
    tabContents.forEach(tab => {
        if (!tab.classList.contains('active')) {
            tab.style.display = 'none';
        }
    });
}

// Event Listeners
function setupEventListeners() {
    // Driver search
    const driverSearch = document.getElementById('driverSearch');
    const teamFilter = document.getElementById('teamFilter');
    if (driverSearch && teamFilter) {
        driverSearch.addEventListener('input', (e) => {
            filterDrivers(e.target.value, teamFilter.value);
        });
        
        teamFilter.addEventListener('change', (e) => {
            filterDrivers(driverSearch.value, e.target.value);
        });
    }

    // User management
    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', addUser);
    }
    
    // Draft controls
    const startDraftBtn = document.getElementById('startDraftBtn');
    if (startDraftBtn) {
        startDraftBtn.addEventListener('click', startDraft);
    }
    const resetDraftBtn = document.getElementById('resetDraftBtn');
    if (resetDraftBtn) {
        resetDraftBtn.addEventListener('click', resetDraft);
    }
    
    // Race results
    const saveRaceBtn = document.getElementById('saveRaceBtn');
    if (saveRaceBtn) {
        saveRaceBtn.addEventListener('click', saveRaceResults);
    }
    
    const parseRaceResultsBtn = document.getElementById('parseRaceResultsBtn');
    if (parseRaceResultsBtn) {
        parseRaceResultsBtn.addEventListener('click', parseRaceResults);
    }
    // loadRaceBtn and loadDemoBtn removed - no longer needed
    
    // Standings
    const standingsRaceFilter = document.getElementById('standingsRaceFilter');
    if (standingsRaceFilter) {
        standingsRaceFilter.addEventListener('change', updateStandings);
    }
    const exportCSVBtn = document.getElementById('exportCSVBtn');
    if (exportCSVBtn) {
        exportCSVBtn.addEventListener('click', exportToCSV);
    }
    
    // New event listeners
    const revealStandingsBtn = document.getElementById('revealStandingsBtn');
    if (revealStandingsBtn) {
        revealStandingsBtn.addEventListener('click', () => {
            if (confirm('Warning: This will reveal Season Standings. Do NOT click if you do not wish to see Standings!\n\nContinue?')) {
                localStorage.setItem('standingsVisible', 'true');
                updateStandingsDisplay();
            }
        });
    }
    
    const hideStandingsBtn = document.getElementById('hideStandingsBtn');
    if (hideStandingsBtn) {
        hideStandingsBtn.addEventListener('click', () => {
            localStorage.setItem('standingsVisible', 'false');
            updateStandingsDisplay();
        });
    }
    
    // Calendar event listeners
    const addRaceBtn = document.getElementById('addRaceBtn');
    if (addRaceBtn) {
        addRaceBtn.addEventListener('click', () => openRaceModal());
    }
    
    const saveRaceCalendarBtn = document.getElementById('saveRaceCalendarBtn');
    if (saveRaceCalendarBtn) {
        saveRaceCalendarBtn.addEventListener('click', saveRaceToCalendar);
    }
    
    const cancelRaceBtn = document.getElementById('cancelRaceBtn');
    if (cancelRaceBtn) {
        cancelRaceBtn.addEventListener('click', closeRaceModal);
    }
    
    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeRaceModal);
    }
    
    const deleteRaceBtn = document.getElementById('deleteRaceBtn');
    if (deleteRaceBtn) {
        deleteRaceBtn.addEventListener('click', () => {
            const raceId = parseInt(document.getElementById('modalTitle').dataset.raceId || '0');
            if (raceId && confirm('Delete this race from calendar?')) {
                state.raceCalendar = state.raceCalendar.filter(r => r.id !== raceId);
                saveState();
                renderCalendar();
                closeRaceModal();
            }
        });
    }
    
    // Close modal when clicking outside
    const raceModal = document.getElementById('raceModal');
    if (raceModal) {
        raceModal.addEventListener('click', (e) => {
            if (e.target === raceModal) {
                closeRaceModal();
            }
        });
    }
    
    // Draft rankings
    const submitDraftBtn = document.getElementById('submitDraftBtn');
    if (submitDraftBtn) {
        submitDraftBtn.addEventListener('click', function(e) {
            e.preventDefault();
            try {
                submitDraft();
            } catch (error) {
                console.error('Error submitting draft:', error);
                alert('Error submitting draft. Please try again.');
            }
        });
        // Also make it globally accessible via onclick as fallback
        submitDraftBtn.onclick = function(e) {
            e.preventDefault();
            submitDraft();
        };
    } else {
        console.error('Submit Draft button not found in DOM');
    }
    
    // saveRankings removed (auto-save during drag)
    const submitBonusBtn = document.getElementById('submitBonusBtn');
    if (submitBonusBtn) {
        submitBonusBtn.addEventListener('click', submitBonuses);
    }
    
    // Undo buttons
    document.querySelectorAll('#undoBtn, #undoRaceBtn').forEach(btn => {
        if (btn) btn.addEventListener('click', undoAction);
    });

    // Spoiler guard removed - race results page now admin-only
    // Header sign-in controls
    const sel = document.getElementById('currentUserSelect');
    const badge = document.getElementById('currentUserBadge');
    if (sel) {
        sel.addEventListener('change', () => {
            const val = sel.value ? parseInt(sel.value) : null;
            if (val) {
                state.currentUser = val;
                localStorage.setItem('currentUserId', val);
                updateCurrentUserBadge();
                updateAdminControls(); // Update admin controls when user changes
                renderBonusPicks();
                updateDraftDisplay();
            }
        });
    }
    if (badge) {
        badge.addEventListener('click', () => {
            if (state.currentUser) {
                if (confirm('Sign out?')) {
                    state.currentUser = null;
                    localStorage.removeItem('currentUserId');
                    updateCurrentUserBadge();
                    updateAdminControls(); // Hide admin controls when signing out
                    populateCurrentUserSelect();
                }
            }
        });
    }
}

function getLastRankingForUser(userId, draftType) {
    if (!state.userRankings || !state.userRankings[draftType] || !state.userRankings[draftType][userId]) return null;
    const byRace = state.userRankings[draftType][userId];
    const raceIds = Object.keys(byRace);
    if (raceIds.length === 0) return null;
    // Pick most recent by numeric id (ids are timestamps)
    const lastRaceId = raceIds.map(id => parseInt(id)).sort((a,b)=>b-a)[0];
    return byRace[lastRaceId];
}

function submitDraft() {
    if (!state.currentUser) {
        alert('Please sign in first using the header dropdown.');
        return;
    }
    const currentRace = getCurrentDraftRace();
    if (!currentRace) {
        alert('No open draft at the moment.');
        return;
    }
    const draftType = 'grojean'; // Always grojean now
    if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
    if (!state.userRankings[draftType]) state.userRankings[draftType] = {};
    if (!state.userRankings[draftType][state.currentUser]) state.userRankings[draftType][state.currentUser] = {};
    
    const selectedRaceId = String(currentRace.id);
    const rankingsList = document.getElementById('rankingsList');
    let rankings = [];
    
    // Get current rankings from DOM if they exist
    if (rankingsList) {
        const items = rankingsList.querySelectorAll('.ranking-item[data-driver-id]');
        rankings = Array.from(items).map(item => parseInt(item.dataset.driverId));
    }
    
    // If no rankings in DOM, use existing or default
    if (rankings.length === 0) {
        rankings = state.userRankings[draftType][state.currentUser][selectedRaceId];
        if (!rankings || rankings.length === 0) {
            const last = getLastRankingForUser(state.currentUser, draftType);
            rankings = last ? [...last] : [...DRIVERS.map(d=>d.id)];
        }
    }
    
    // Save rankings
    state.userRankings[draftType][state.currentUser][selectedRaceId] = rankings;
    
    // Mark submission for this race (engagement requirement)
    if (!state.submissions) state.submissions = { draft: {}, bonus: {} };
    if (!state.submissions.draft) state.submissions.draft = {};
    if (!state.submissions.draft[selectedRaceId]) state.submissions.draft[selectedRaceId] = {};
    state.submissions.draft[selectedRaceId][state.currentUser] = true;
    saveState();
    // Push immediately for faster sharing
    if (checkFirebase()) saveStateToFirebase();
    
    // Update banner immediately to show "Submitted!"
    updateDraftDisplay();
    
    alert('Draft submitted! Your ranking is saved for this race. You can still make changes.');
}

// Draft window helpers
function getCurrentDraftRace() {
    if (!Array.isArray(state.raceCalendar) || state.raceCalendar.length === 0) return null;
    // Current draftable race = status 'drafting'
    let drafting = state.raceCalendar.find(r => r.status === 'drafting');
    if (drafting) return drafting;
    
    // Auto-open next upcoming race if none is drafting (should always be one open)
    const upcoming = state.raceCalendar.filter(r => (r.status === 'upcoming' || !r.status) && r.status !== 'completed').sort((a,b)=>new Date(a.date)-new Date(b.date));
    if (upcoming.length > 0) {
        upcoming[0].status = 'drafting';
        saveState();
        return upcoming[0];
    }
    
    return null;
}

function computeDeadlineTimestamp(race) {
    if (!race || !race.deadlineDate) return null;
    const time = race.deadlineTime && race.deadlineTime !== '' ? race.deadlineTime : '00:00';
    const ts = new Date(`${race.deadlineDate}T${time}:00`).getTime();
    return isNaN(ts) ? null : ts;
}

function updateDraftWindowStatus() {
    // Auto-close drafting when deadline passes and open next race
    let changed = false;
    (state.raceCalendar || []).forEach(race => {
        if (race.status === 'drafting') {
            const deadline = computeDeadlineTimestamp(race);
            if (deadline && Date.now() >= deadline) {
                race.status = 'completed';
                changed = true;
                // Auto-open next upcoming race
                const upcoming = state.raceCalendar.filter(r => (r.status === 'upcoming' || !r.status) && r.id !== race.id).sort((a,b)=>new Date(a.date)-new Date(b.date));
                if (upcoming.length > 0) {
                    upcoming[0].status = 'drafting';
                    changed = true;
                }
            }
        }
    });
    if (changed) {
        saveState();
        renderCalendar();
    }
    // Always refresh banners/countdowns
    updateDraftDisplay();
    renderBonusPicks();
}

let draftWindowTimerStarted = false;
function startDraftWindowTimer() {
    if (draftWindowTimerStarted) return;
    draftWindowTimerStarted = true;
    // Check every 10 seconds for snappier countdowns
    setInterval(updateDraftWindowStatus, 10000);
}

// Render Drivers
function renderDrivers() {
    const driversList = document.getElementById('driversList');
    const teamFilter = document.getElementById('teamFilter');
    
    // Populate team filter
    const teams = [...new Set(DRIVERS.map(d => d.team))].sort();
    teamFilter.innerHTML = '<option value="">All Teams</option>';
    teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team;
        option.textContent = team;
        teamFilter.appendChild(option);
    });

    filterDrivers('', '');
}

function filterDrivers(search, team) {
    const driversList = document.getElementById('driversList');
    driversList.innerHTML = '';

    const filtered = DRIVERS.filter(driver => {
        const matchesSearch = !search || 
            driver.name.toLowerCase().includes(search.toLowerCase()) ||
            driver.team.toLowerCase().includes(search.toLowerCase());
        const matchesTeam = !team || driver.team === team;
        return matchesSearch && matchesTeam;
    });

    filtered.forEach(driver => {
        const card = document.createElement('div');
        card.className = 'driver-card';
        card.innerHTML = `
            <h3>${driver.name}</h3>
            <div class="team">${driver.team}</div>
        `;
        driversList.appendChild(card);
    });
}

// User Management
function renderUsers() {
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';

    // Initialize turn order if empty
    if (!state.turnOrder || state.turnOrder.length === 0) {
        state.turnOrder = state.users.map(u => u.id);
    }
    
    // Ensure all users are in turn order
    state.users.forEach(user => {
        if (!state.turnOrder.includes(user.id)) {
            state.turnOrder.push(user.id);
        }
    });
    // Remove users from turn order that no longer exist
    state.turnOrder = state.turnOrder.filter(id => state.users.find(u => u.id === id));

    // Sort users by turn order
    const sortedUsers = [...state.users].sort((a, b) => {
        const aIndex = state.turnOrder.indexOf(a.id);
        const bIndex = state.turnOrder.indexOf(b.id);
        return aIndex - bIndex;
    });

    // Show turn order header
    const header = document.createElement('div');
    header.className = 'turn-order-header';
    header.innerHTML = '<h3>Draft Turn Order</h3><p style="font-size:0.9rem;color:var(--text-secondary);">Order determines draft pick sequence</p>';
    usersList.appendChild(header);

    // Create draggable list for admins
    const orderList = document.createElement('div');
    orderList.id = 'turnOrderList';
    orderList.className = isAdmin() ? 'turn-order-list draggable' : 'turn-order-list';
    
    sortedUsers.forEach((user, displayIndex) => {
        const index = state.users.findIndex(u => u.id === user.id);
        const card = document.createElement('div');
        card.className = 'user-card';
        if (isAdmin()) {
            card.draggable = true;
            card.dataset.userId = user.id;
            card.dataset.userIndex = index;
        }
        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <span class="turn-number">${displayIndex + 1}</span>
                <div class="avatar">${user.avatar}</div>
                <div class="username">${user.username}</div>
                ${user.isAdmin || index === 0 ? '<div class="admin-badge">Admin</div>' : ''}
            </div>
            <div style="display:flex;gap:5px;">
                ${isAdmin() ? `<button class="delete-btn" onclick="deleteUser(${index})" title="Delete User">×</button>` : ''}
                ${isAdmin() && !user.isAdmin ? `<button class="make-admin-btn" onclick="makeAdmin(${user.id})">Make Admin</button>` : ''}
            </div>
        `;
        
        if (isAdmin()) {
            // Drag and drop handlers
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', user.id.toString());
                card.style.opacity = '0.5';
            });
            card.addEventListener('dragend', () => {
                card.style.opacity = '1';
            });
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
                const targetId = user.id;
                if (draggedId !== targetId) {
                    const draggedIndex = state.turnOrder.indexOf(draggedId);
                    const targetIndex = state.turnOrder.indexOf(targetId);
                    state.turnOrder.splice(draggedIndex, 1);
                    state.turnOrder.splice(targetIndex, 0, draggedId);
                    saveState();
                    renderUsers();
                }
            });
        }
        
        orderList.appendChild(card);
    });
    
    usersList.appendChild(orderList);
    
    // Update draft button state
    const submitDraftBtn = document.getElementById('submitDraftBtn');
    if (submitDraftBtn) {
        submitDraftBtn.disabled = false;
    }
    populateCurrentUserSelect();
}

function addUser() {
    const usernameInput = document.getElementById('usernameInput');
    const avatarSelect = document.getElementById('avatarSelect');
    const username = usernameInput.value.trim();

    if (!username) {
        alert('Please enter a username');
        return;
    }

    if (state.users.length >= 10) {
        alert('Maximum 10 users allowed');
        return;
    }

    if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        alert('Username already taken');
        return;
    }

    const newUser = {
        username,
        avatar: avatarSelect.value,
        id: Date.now(),
        isAdmin: state.users.length === 0  // First user is admin
    };
    state.users.push(newUser);
    
    // Add to turn order
    if (!state.turnOrder) state.turnOrder = [];
    state.turnOrder.push(newUser.id);
    
    // Set as current user if first user
    if (state.users.length === 1) {
        state.currentUser = newUser.id;
        localStorage.setItem('currentUserId', newUser.id);
    }

    usernameInput.value = '';
    saveState();
    renderUsers();
    updateAdminControls(); // Update admin controls after adding user (first user becomes admin)
    renderBonusPicks();
}

function deleteUser(index) {
    if (!isAdmin()) {
        alert('Only admins can delete users');
        return;
    }

    const userToDelete = state.users[index];
    const isDeletingSelf = state.currentUser === userToDelete.id;
    const isOnlyAdmin = state.users.filter(u => u.isAdmin || state.users.indexOf(u) === 0).length === 1 && (userToDelete.isAdmin || index === 0);
    
    if (isOnlyAdmin) {
        alert('Cannot delete the last admin user. Make another user admin first.');
        return;
    }

    const confirmMsg = isDeletingSelf 
        ? `Are you sure you want to delete yourself (${userToDelete.username})? You will be signed out.`
        : `Are you sure you want to delete ${userToDelete.username}?`;
    
    if (confirm(confirmMsg)) {
        const userId = userToDelete.id;
        state.users.splice(index, 1);
        
        // Remove from turn order
        if (state.turnOrder) {
            state.turnOrder = state.turnOrder.filter(id => id !== userId);
        }
        
        // If deleting self, sign out
        if (isDeletingSelf) {
            state.currentUser = null;
            localStorage.removeItem('currentUserId');
        }
        
        // If first user was deleted, make new first user admin
        if (index === 0 && state.users.length > 0) {
            state.users[0].isAdmin = true;
        }
        
        // Clean up user data
        if (state.bonusPicks) {
            if (state.bonusPicks.pole) delete state.bonusPicks.pole[userId];
            if (state.bonusPicks.top5) delete state.bonusPicks.top5[userId];
        }
        
        // Clean up draft picks
        if (state.currentDraft) {
            state.currentDraft.picks = state.currentDraft.picks.filter(p => p.userId !== userId);
        }
        
        // Clean up standings
        Object.keys(state.standings).forEach(raceId => {
            delete state.standings[raceId][userId];
        });

        saveState();
        updateAdminControls();
        updateCurrentUserBadge();
        populateCurrentUserSelect();
        renderUsers(); // Re-render to remove deleted user from list
        renderBonusPicks();
        updateDraftDisplay();
        updateStandings();
        
        // Force UI update to ensure user is removed
        setTimeout(() => {
            renderUsers();
        }, 100);
    }
}

// Draft System
function startDraft() {
    if (state.users.length < 2) {
        alert('Need at least 2 users to start a draft');
        return;
    }

    const draftType = document.getElementById('draftType').value;
    
    // Check if draft already exists
    if (state.currentDraft && state.currentDraft.type === draftType) {
        if (!confirm('A draft is already in progress. Start a new one?')) {
            return;
        }
    }

    // Initialize draft
    const userOrder = [...state.users].sort(() => Math.random() - 0.5);
    state.currentDraft = {
        type: draftType,
        round: 1,
        pick: 1,
        userOrder: userOrder.map(u => u.id),
        currentUserIndex: 0,
        picks: [],
        availableDrivers: DRIVERS.map(d => d.id)
    };

    saveState();
    updateDraftDisplay();
}

function resetDraft() {
    if (confirm('Reset current draft? All picks will be cleared.')) {
        state.currentDraft = null;
        saveState();
        updateDraftDisplay();
    }
}

function updateDraftDisplay() {
    const draftStatus = document.getElementById('draftStatus');
    const draftInfo = document.getElementById('draftInfo');
    const draftBanner = document.getElementById('draftBanner');
    const draftProgress = document.getElementById('draftProgress');
    const draftQueue = document.getElementById('draftQueue');
    const availableDrivers = document.getElementById('availableDrivers');
    const draftPicks = document.getElementById('draftPicks');
    const currentRace = getCurrentDraftRace();
    
    // draftInfo section removed (per user request)
    if (!currentRace) {
        // No races in calendar yet - show empty state
        if (draftBanner) draftBanner.innerHTML = '<strong>No races in calendar yet.</strong>';
        if (draftStatus) draftStatus.innerHTML = '<p>Admin needs to add races to the calendar first.</p>';
        if (draftProgress) draftProgress.innerHTML = '';
        if (draftQueue) draftQueue.innerHTML = '';
        if (availableDrivers) availableDrivers.innerHTML = '';
        if (draftPicks) draftPicks.innerHTML = '';
        return;
    }

    // Banner with countdown and submission status
    if (draftBanner && currentRace) {
        const deadline = computeDeadlineTimestamp(currentRace);
        const now = Date.now();
        const ms = deadline ? Math.max(0, deadline - now) : null;
        const hours = ms !== null ? Math.floor(ms / 3600000) : '-';
        const minutes = ms !== null ? Math.floor((ms % 3600000) / 60000) : '-';
        const submitted = state.submissions && state.submissions.draft && state.submissions.draft[currentRace.id] && state.submissions.draft[currentRace.id][state.currentUser];
        draftBanner.innerHTML = `
            <div>
                <div><strong>${currentRace.name}</strong> — Drafting Open</div>
                <div>Closes in: ${hours}h ${minutes}m</div>
                <div><strong>Your draft: ${submitted ? 'Submitted ✅' : 'Not submitted ❗'}</strong></div>
            </div>
        `;
    }

    // Always render rankings list for current race
    const rankingsInterface = document.getElementById('rankingsInterface');
    if (rankingsInterface) {
        rankingsInterface.style.display = 'block';
        try { showRankingsInterface(); } catch(e) {}
    }
    
    // Hide old draft status elements
    if (draftStatus) draftStatus.innerHTML = '';
    if (draftProgress) draftProgress.innerHTML = '';
    if (draftQueue) draftQueue.innerHTML = '';
    if (availableDrivers) availableDrivers.innerHTML = '';
    if (draftPicks) draftPicks.innerHTML = '';

    // Old draft system removed - we only use rankings now
}

function renderDraftPicksForRace(draftType) {
    const draftPicks = document.getElementById('draftPicks');
    if (!draftPicks) return;
    
    const raceSelect = document.getElementById('draftRaceSelect');
    const raceId = raceSelect ? raceSelect.value : null;
    
    if (!raceId || !state.draftHistory[draftType] || !state.draftHistory[draftType][raceId]) {
        draftPicks.innerHTML = '<p>No picks for selected race yet.</p>';
        return;
    }
    
    const draft = state.draftHistory[draftType][raceId];
    draftPicks.innerHTML = '<h3>Draft Picks for Selected Race</h3>';
    
    const picksByUser = {};
    draft.picks.forEach(pick => {
        if (!picksByUser[pick.userId]) {
            picksByUser[pick.userId] = [];
        }
        picksByUser[pick.userId].push(pick);
    });
    
    state.users.forEach(user => {
        if (picksByUser[user.id]) {
            const section = document.createElement('div');
            section.className = 'picks-section';
            section.innerHTML = `<h4>${user.avatar} ${user.username}</h4>`;
            
            const picksDiv = document.createElement('div');
            picksDiv.className = 'user-picks';
            
            picksByUser[user.id].sort((a, b) => a.pickNumber - b.pickNumber).forEach(pick => {
                const driver = DRIVERS.find(d => d.id === pick.driverId);
                const pickItem = document.createElement('div');
                pickItem.className = 'pick-item';
                pickItem.innerHTML = `
                    <div><strong>${driver.name}</strong></div>
                    <div style="font-size: 0.8rem;">Round ${pick.round}, Pick ${pick.pickNumber}</div>
                `;
                picksDiv.appendChild(pickItem);
            });
            
            section.appendChild(picksDiv);
            draftPicks.appendChild(section);
        }
    });
}

function makePick(driverId) {
    if (!state.currentDraft) return;

    const draft = state.currentDraft;
    const currentUserId = draft.userOrder[draft.currentUserIndex];

    // Check if driver is available
    if (!draft.availableDrivers.includes(driverId)) {
        alert('Driver already picked!');
        return;
    }

    // Make the pick
    draft.picks.push({
        userId: currentUserId,
        driverId: driverId,
        round: draft.round,
        pickNumber: draft.pick
    });

    // Remove driver from available
    draft.availableDrivers = draft.availableDrivers.filter(id => id !== driverId);

    // Move to next pick
    draft.pick++;
    
    if (draft.pick > state.users.length) {
        // Round complete
        draft.round++;
        draft.pick = 1;
        if (draft.round > 2) {
            // Draft complete
            state.draftHistory[draft.type].push({
                picks: [...draft.picks],
                completedAt: new Date().toISOString()
            });
            state.currentDraft = null;
            alert('Draft complete!');
        } else {
            // Reverse order for snake draft
            draft.userOrder.reverse();
            draft.currentUserIndex = 0;
        }
    } else {
        draft.currentUserIndex = (draft.currentUserIndex + 1) % draft.userOrder.length;
    }

    saveState();
    updateDraftDisplay();
}

function renderDraftPicks() {
    const draftPicks = document.getElementById('draftPicks');
    if (!state.currentDraft || state.currentDraft.picks.length === 0) {
        draftPicks.innerHTML = '';
        return;
    }

    draftPicks.innerHTML = '<h3>Current Draft Picks</h3>';
    
    const picksByUser = {};
    state.currentDraft.picks.forEach(pick => {
        if (!picksByUser[pick.userId]) {
            picksByUser[pick.userId] = [];
        }
        picksByUser[pick.userId].push(pick);
    });

    state.users.forEach(user => {
        if (picksByUser[user.id]) {
            const section = document.createElement('div');
            section.className = 'picks-section';
            section.innerHTML = `<h4>${user.avatar} ${user.username}</h4>`;
            
            const picksDiv = document.createElement('div');
            picksDiv.className = 'user-picks';
            
            picksByUser[user.id].forEach(pick => {
                const driver = DRIVERS.find(d => d.id === pick.driverId);
                const pickItem = document.createElement('div');
                pickItem.className = 'pick-item';
                pickItem.innerHTML = `
                    <div><strong>${driver.name}</strong></div>
                    <div style="font-size: 0.8rem;">Round ${pick.round}, Pick ${pick.pickNumber}</div>
                `;
                picksDiv.appendChild(pickItem);
            });
            
            section.appendChild(picksDiv);
            draftPicks.appendChild(section);
        }
    });
}

// Bonus Picks
function renderBonusPicks() {
    const polePicks = document.getElementById('polePicks');
    const top5Picks = document.getElementById('top5Picks');
    const bonusBanner = document.getElementById('bonusBanner');
    if (!polePicks || !top5Picks) {
        console.error('Bonus picks containers not found');
        return;
    }
    const currentRace = getCurrentDraftRace();
    polePicks.innerHTML = '';
    top5Picks.innerHTML = '';
    if (!currentRace) {
        if (bonusBanner) bonusBanner.innerHTML = '<strong>No open draft.</strong>';
        polePicks.innerHTML = '<p>No open draft. Bonuses will open with the draft window.</p>';
        return;
    }
    
    // Ensure DRIVERS array exists and has data
    if (!DRIVERS || DRIVERS.length === 0) {
        console.error('DRIVERS array is empty or undefined');
        polePicks.innerHTML = '<p>Error: Driver list not loaded. Please refresh the page.</p>';
        return;
    }
    if (bonusBanner) {
        const deadline = computeDeadlineTimestamp(currentRace);
        const now = Date.now();
        const ms = deadline ? Math.max(0, deadline - now) : null;
        const hours = ms !== null ? Math.floor(ms / 3600000) : '-';
        const minutes = ms !== null ? Math.floor((ms % 3600000) / 60000) : '-';
        const submitted = state.submissions && state.submissions.bonus && state.submissions.bonus[currentRace.id] && state.submissions.bonus[currentRace.id][state.currentUser];
        bonusBanner.innerHTML = `
            <div>
                <div><strong>${currentRace.name}</strong> — Bonuses Open</div>
                <div>Closes in: ${hours}h ${minutes}m</div>
                <div>Your bonuses: ${submitted ? 'Submitted ✅' : 'Not submitted ❗'}</div>
            </div>
        `;
    }
    renderPolePicksCurrent(currentRace);
    renderTop5PicksCurrent(currentRace);
}

function renderPolePicksCurrent(currentRace) {
    const polePicks = document.getElementById('polePicks');
    polePicks.innerHTML = '';
    const user = state.users.find(u => u.id === state.currentUser);
    if (!user) { polePicks.innerHTML = '<p>Please sign in using the header selector.</p>'; return; }
    
    // Safely access bonusPicks with null checks
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.pole) state.bonusPicks.pole = {};
    const forUser = state.bonusPicks.pole[user.id] || {};
    let currentPick = forUser[currentRace.id] || '';
    if (!currentPick) {
        const last = Object.entries(forUser).sort((a,b)=>parseInt(b[0])-parseInt(a[0]))[0];
        if (last) currentPick = last[1];
    }
    
    // Drag from driver list to pole box
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '20px';
    
    // Driver list (left)
    const driverList = document.createElement('div');
    driverList.innerHTML = '<h4>Available Drivers</h4>';
    const availableList = document.createElement('div');
    availableList.className = 'rankings-list';
    availableList.style.minHeight = '400px';
    
    DRIVERS.forEach((driver) => {
        // Show all drivers - if one is selected, it will be shown in the drop zone
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.draggable = true;
        item.dataset.driverId = driver.id;
        item.innerHTML = `<span><strong>${driver.name}</strong> - ${driver.team}</span>`;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', driver.id.toString());
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; });
        // If this driver is the current pick, show it but make it less prominent
        if (currentPick && parseInt(currentPick) === driver.id) {
            item.style.opacity = '0.5';
            item.innerHTML += ' <span style="color:var(--text-secondary);font-size:0.8rem;">(selected)</span>';
        }
        availableList.appendChild(item);
    });
    driverList.appendChild(availableList);
    
    // Pole box (right)
    const poleBox = document.createElement('div');
    poleBox.innerHTML = '<h4>Pole Position Pick</h4>';
    const poleDropZone = document.createElement('div');
    poleDropZone.className = 'ranking-item';
    poleDropZone.style.minHeight = '100px';
    poleDropZone.style.border = '3px dashed var(--border-color)';
    poleDropZone.style.textAlign = 'center';
    poleDropZone.style.display = 'flex';
    poleDropZone.style.alignItems = 'center';
    poleDropZone.style.justifyContent = 'center';
    
    if (currentPick) {
        const driver = DRIVERS.find(d => d.id === currentPick);
        if (driver) {
            poleDropZone.innerHTML = `<div><strong>${driver.name}</strong><br>${driver.team}</div><button onclick="removePoleDriver(${user.id}, ${currentRace.id})" style="margin-top:5px;padding:5px 10px;font-size:0.8rem;">Remove</button>`;
            poleDropZone.style.border = '3px solid var(--accent-primary)';
        }
    } else {
        poleDropZone.innerHTML = '<div style="color:var(--text-secondary);">Drag a driver here</div>';
    }
    
    poleDropZone.addEventListener('dragover', (e) => e.preventDefault());
    poleDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const driverId = parseInt(e.dataTransfer.getData('text/plain'));
        savePolePick(user.id, driverId, currentRace.id);
        renderPolePicksCurrent(currentRace);
    });
    
    poleBox.appendChild(poleDropZone);
    
    container.appendChild(driverList);
    container.appendChild(poleBox);
    polePicks.appendChild(container);
}

function renderTop5PicksCurrent(currentRace) {
    const top5Picks = document.getElementById('top5Picks');
    top5Picks.innerHTML = '';
    const user = state.users.find(u => u.id === state.currentUser);
    if (!user) { top5Picks.innerHTML = '<p>Please sign in using the header selector.</p>'; return; }

    // Safely access bonusPicks with null checks
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.top5) state.bonusPicks.top5 = {};
    const forUser = state.bonusPicks.top5[user.id] || {};
    const currentTop5 = forUser[currentRace.id] || [];
    
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '20px';
    
    // Driver list (left)
    const driverList = document.createElement('div');
    driverList.innerHTML = '<h4>Available Drivers</h4>';
    const availableList = document.createElement('div');
    availableList.className = 'rankings-list';
    availableList.style.minHeight = '400px';
    
    DRIVERS.forEach((driver) => {
        // Show all drivers - selected ones are shown in the top 5 boxes
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.draggable = true;
        item.dataset.driverId = driver.id;
        item.innerHTML = `<span><strong>${driver.name}</strong> - ${driver.team}</span>`;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', driver.id.toString());
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; });
        // If this driver is already in top 5, show it but make it less prominent
        if (currentTop5.includes(driver.id)) {
            item.style.opacity = '0.5';
            item.innerHTML += ' <span style="color:var(--text-secondary);font-size:0.8rem;">(in top 5)</span>';
        }
        availableList.appendChild(item);
    });
    driverList.appendChild(availableList);
    
    // Top 5 boxes (right)
    const top5Box = document.createElement('div');
    top5Box.innerHTML = '<h4>Top 5 Picks (drag in order)</h4>';
    const top5Zones = document.createElement('div');
    
    for (let i = 1; i <= 5; i++) {
        const zone = document.createElement('div');
        zone.className = 'ranking-item';
        zone.style.minHeight = '60px';
        zone.style.marginBottom = '10px';
        zone.style.border = '3px dashed var(--border-color)';
        zone.style.textAlign = 'center';
        zone.style.display = 'flex';
        zone.style.alignItems = 'center';
        zone.style.justifyContent = 'center';
        zone.dataset.position = i;
        
        const driverId = currentTop5[i - 1];
        if (driverId) {
            const driver = DRIVERS.find(d => d.id === driverId);
            if (driver) {
                zone.innerHTML = `<div><strong>${i}.</strong> ${driver.name}<br>${driver.team}</div><button onclick="removeTop5Driver(${user.id}, ${i-1}, ${currentRace.id})" style="margin-top:5px;padding:5px 10px;font-size:0.8rem;">Remove</button>`;
                zone.style.border = '3px solid var(--accent-primary)';
            }
        } else {
            zone.innerHTML = `<div style="color:var(--text-secondary);">${i}. Drag driver here</div>`;
        }
        
        zone.addEventListener('dragover', (e) => e.preventDefault());
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            const driverId = parseInt(e.dataTransfer.getData('text/plain'));
            const pos = parseInt(zone.dataset.position) - 1;
            const newTop5 = [...currentTop5];
            // Remove from other positions if already there
            const existingIndex = newTop5.indexOf(driverId);
            if (existingIndex !== -1) newTop5.splice(existingIndex, 1);
            // Insert at position
            newTop5[pos] = driverId;
            // Remove undefined slots
            const cleaned = newTop5.filter(id => id !== undefined);
            if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
            if (!state.bonusPicks.top5) state.bonusPicks.top5 = {};
            if (!state.bonusPicks.top5[user.id]) state.bonusPicks.top5[user.id] = {};
            state.bonusPicks.top5[user.id][currentRace.id] = cleaned;
            saveState();
            renderTop5PicksCurrent(currentRace);
        });
        
        top5Zones.appendChild(zone);
    }
    
    top5Box.appendChild(top5Zones);
    
    container.appendChild(driverList);
    container.appendChild(top5Box);
    top5Picks.appendChild(container);
}

function removePoleDriver(userId, raceId) {
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.pole) state.bonusPicks.pole = {};
    if (!state.bonusPicks.pole[userId]) state.bonusPicks.pole[userId] = {};
    delete state.bonusPicks.pole[userId][raceId];
    saveState();
    renderPolePicksCurrent(state.raceCalendar.find(r => r.id === raceId));
}

window.removePoleDriver = removePoleDriver;

function savePolePick(userId, driverId, raceId) {
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.pole) state.bonusPicks.pole = {};
    if (!state.bonusPicks.pole[userId]) state.bonusPicks.pole[userId] = {};
    if (driverId) {
        state.bonusPicks.pole[userId][raceId] = parseInt(driverId);
    } else {
        delete state.bonusPicks.pole[userId][raceId];
    }
    saveState();
}

function removeTop5Driver(userId, index, raceId) {
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.top5) state.bonusPicks.top5 = {};
    if (!state.bonusPicks.top5[userId]) state.bonusPicks.top5[userId] = {};
    const currentTop5 = state.bonusPicks.top5[userId][raceId] || [];
    currentTop5.splice(index, 1);
    state.bonusPicks.top5[userId][raceId] = currentTop5;
    saveState();
    renderTop5PicksCurrent(state.raceCalendar.find(r => r.id === raceId));
}

window.removeTop5Driver = removeTop5Driver;

function saveTop5Pick(userId, index, driverId, raceId) {
    if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
    if (!state.bonusPicks.top5) state.bonusPicks.top5 = {};
    if (!state.bonusPicks.top5[userId]) {
        state.bonusPicks.top5[userId] = {};
    }
    if (!state.bonusPicks.top5[userId][raceId]) state.bonusPicks.top5[userId][raceId] = [];
    if (driverId) {
        state.bonusPicks.top5[userId][raceId][index] = parseInt(driverId);
    } else {
        state.bonusPicks.top5[userId][raceId].splice(index, 1);
    }
    // Ensure array length is 5
    state.bonusPicks.top5[userId][raceId] = state.bonusPicks.top5[userId][raceId].slice(0, 5);
    saveState();
}

function submitBonuses() {
    const currentRace = getCurrentDraftRace();
    if (!currentRace) {
        alert('No open draft/bonus window at the moment.');
        return;
    }
    if (!state.submissions) state.submissions = { draft: {}, bonus: {} };
    if (!state.submissions.bonus[currentRace.id]) state.submissions.bonus[currentRace.id] = {};
    state.submissions.bonus[currentRace.id][state.currentUser] = true;
    saveState();
    // Push immediately for faster sharing
    if (checkFirebase()) saveStateToFirebase();
    alert('Bonuses submitted for this race!');
}

// Race Results
function renderRaceForm() {
    const positionsGrid = document.getElementById('positionsGrid');
    positionsGrid.innerHTML = '';

    const poleSelect = document.getElementById('poleResult');
    poleSelect.innerHTML = '<option value="">Select Driver</option>';
    DRIVERS.forEach(d => {
        const option = document.createElement('option');
        option.value = d.id;
        option.textContent = `${d.name} (${d.team})`;
        poleSelect.appendChild(option);
    });

    // Create position inputs for positions 1-20
    for (let pos = 1; pos <= 20; pos++) {
        const positionInput = document.createElement('div');
        positionInput.className = 'position-input';
        const label = document.createElement('label');
        label.textContent = `Position ${pos}:`;
        const driverSelect = document.createElement('select');
        driverSelect.id = `pos-${pos}`;
        driverSelect.innerHTML = `
            <option value="">Select Driver</option>
            ${DRIVERS.map(d => `<option value="${d.id}">${d.name} (${d.team})</option>`).join('')}
        `;
        const flagSelect = document.createElement('select');
        flagSelect.id = `pos-flag-${pos}`;
        flagSelect.innerHTML = `
            <option value="">Finish</option>
            <option value="DNF">DNF</option>
            <option value="DNS">DNS</option>
        `;
        positionInput.appendChild(label);
        positionInput.appendChild(driverSelect);
        positionInput.appendChild(flagSelect);
        positionsGrid.appendChild(positionInput);
    }
}

// loadDemoData and loadRace functions removed - no longer needed
// Race results now automatically use current race from calendar

// Parse race results from F1 official format
function parseRaceResults() {
    const pasteText = document.getElementById('raceResultsPaste').value.trim();
    const parseError = document.getElementById('parseError');
    
    if (!pasteText) {
        if (parseError) {
            parseError.style.display = 'block';
            parseError.textContent = 'Please paste race results first.';
        }
        return;
    }
    
    const currentRace = getCurrentDraftRace();
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const targetRace = completedRaces.length > 0 ? completedRaces[0] : currentRace;
    
    if (!targetRace) {
        if (parseError) {
            parseError.style.display = 'block';
            parseError.textContent = 'No race available. Please add a race session in Calendar first.';
        }
        return;
    }
    
    const lines = pasteText.split('\n').filter(l => l.trim());
    const results = {};
    const statuses = {};
    const times = {};
    let pole = null;
    let classifiedPos = 1; // Track classified positions for NC drivers
    
    // First pass: find all classified positions
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.toLowerCase().startsWith('pole:')) return;
        
        // Match: "1	Lando Norris	1:37:58.574" or "NC	Fernando Alonso	DNF"
        const match = trimmed.match(/^(\d+|NC)\s+([A-Za-z\s]+?)(?:\s+(.+))?$/);
        if (match) {
            const posStr = match[1];
            const driverName = match[2].trim();
            const timeOrStatus = match[3] ? match[3].trim() : '';
            
            if (posStr !== 'NC') {
                const pos = parseInt(posStr);
                if (!isNaN(pos) && pos >= 1 && pos <= 20) {
                    classifiedPos = Math.max(classifiedPos, pos + 1);
                }
            }
        }
    });
    
    // Second pass: parse results
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        // Check for pole
        if (trimmed.toLowerCase().startsWith('pole:')) {
            const poleName = trimmed.substring(5).trim();
            const poleDriver = DRIVERS.find(d => 
                d.name.toLowerCase() === poleName.toLowerCase() ||
                poleName.toLowerCase().includes(d.name.toLowerCase())
            );
            if (poleDriver) {
                pole = poleDriver.id;
            }
            return;
        }
        
        // Match: "1	Lando Norris	1:37:58.574" or "NC	Fernando Alonso	DNF" or "17	Carlos Sainz	   DNF"
        const match = trimmed.match(/^(\d+|NC)\s+([A-Za-z\s]+?)(?:\s+(.+))?$/);
        if (match) {
            const posStr = match[1];
            const driverName = match[2].trim();
            const timeOrStatus = match[3] ? match[3].trim() : '';
            
            // Find driver by name (flexible matching)
            const driver = DRIVERS.find(d => {
                const dName = d.name.toLowerCase();
                const searchName = driverName.toLowerCase();
                return dName === searchName || 
                       searchName.includes(dName.split(' ')[0]) || 
                       searchName.includes(dName.split(' ')[dName.split(' ').length - 1]);
            });
            
            if (!driver) {
                console.warn(`Driver not found: ${driverName}`);
                return;
            }
            
            let position = null;
            let isClassified = true;
            
            if (posStr === 'NC') {
                // Non-Classified - assign next available position but mark as NC
                position = classifiedPos++;
                isClassified = false;
            } else {
                position = parseInt(posStr);
                if (isNaN(position) || position < 1 || position > 20) {
                    console.warn(`Invalid position: ${posStr}`);
                    return;
                }
            }
            
            // Check for DNF/DNS
            const upperStatus = timeOrStatus.toUpperCase();
            if (upperStatus.includes('DNF')) {
                if (isClassified) {
                    statuses[driver.id] = 'C,DNF'; // Classified DNF
                } else {
                    statuses[driver.id] = 'NC,DNF'; // Non-Classified DNF
                }
            } else if (upperStatus.includes('DNS')) {
                statuses[driver.id] = 'DNS';
            }
            
            results[position] = driver.id;
            times[driver.id] = timeOrStatus || '';
        }
    });
    
    if (Object.keys(results).length === 0) {
        if (parseError) {
            parseError.style.display = 'block';
            parseError.textContent = 'Could not parse results. Please check the format and try again.';
        }
        return;
    }
    
    // Fill in the form
    Object.entries(results).forEach(([pos, driverId]) => {
        const select = document.getElementById(`pos-${pos}`);
        if (select) {
            select.value = driverId;
            // Trigger change to update other selects
            select.dispatchEvent(new Event('change'));
        }
        
        // Set DNF/DNS checkboxes
        const status = statuses[driverId];
        if (status) {
            if (status.includes('DNF')) {
                const dnfCheckbox = document.getElementById(`dnf-${pos}`);
                if (dnfCheckbox) dnfCheckbox.checked = true;
            }
            if (status.includes('DNS')) {
                const dnsCheckbox = document.getElementById(`dns-${pos}`);
                if (dnsCheckbox) dnsCheckbox.checked = true;
            }
        }
    });
    
    // Set pole position
    if (pole) {
        const poleSelect = document.getElementById('poleResult');
        if (poleSelect) {
            poleSelect.value = pole;
        }
    }
    
    // Store times and classified status for saveRaceResults
    if (!window.parsedRaceData) window.parsedRaceData = {};
    window.parsedRaceData.times = times;
    window.parsedRaceData.statuses = statuses;
    
    if (parseError) parseError.style.display = 'none';
    alert(`Parsed ${Object.keys(results).length} drivers. Review and click "Save Race Results" to save.`);
}

function saveRaceResults() {
    if (!isAdmin()) {
        alert('Only admins can save race results');
        return;
    }
    
    // Get the most recently completed race, or current draft race
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const currentRace = completedRaces.length > 0 ? completedRaces[0] : getCurrentDraftRace();
    
    if (!currentRace) {
        alert('No active race. Please add a race session in Calendar.');
        return;
    }

    const results = {};
    const statuses = {};
    const times = {};
    let hasResults = false;

    for (let pos = 1; pos <= 20; pos++) {
        const driverSelect = document.getElementById(`pos-${pos}`);
        const dnfCheckbox = document.getElementById(`dnf-${pos}`);
        const dnsCheckbox = document.getElementById(`dns-${pos}`);
        
        const driverVal = driverSelect ? driverSelect.value : '';
        if (driverVal) {
            const driverId = parseInt(driverVal);
            // prevent duplicates
            if (Object.values(results).includes(driverId)) {
                alert('Duplicate driver detected in results. Please fix before saving.');
                return;
            }
            results[pos] = driverId;
            
            // Check DNF/DNS checkboxes - preserve Classified/Non-Classified from parsed data
            if (dnfCheckbox && dnfCheckbox.checked) {
                // Use parsed status if available, otherwise default to DNF
                if (window.parsedRaceData && window.parsedRaceData.statuses && window.parsedRaceData.statuses[driverId]) {
                    statuses[driverId] = window.parsedRaceData.statuses[driverId];
                } else {
                    statuses[driverId] = 'DNF'; // Default to Non-Classified if not specified
                }
            } else if (dnsCheckbox && dnsCheckbox.checked) {
                statuses[driverId] = 'DNS';
            }
            
            // Store time if available from parsed data
            if (window.parsedRaceData && window.parsedRaceData.times && window.parsedRaceData.times[driverId]) {
                times[driverId] = window.parsedRaceData.times[driverId];
            }
            
            hasResults = true;
        }
    }

    if (!hasResults) {
        alert('Please enter at least one race result');
        return;
    }

    const poleSelect = document.getElementById('poleResult');
    const pole = poleSelect && poleSelect.value ? parseInt(poleSelect.value) : null;
    
    if (!pole) {
        if (!confirm('No pole position selected. Continue without pole position?')) {
            return;
        }
    }

    // Calculate or update race
    const existingRaceIndex = state.races.findIndex(r => r.name === currentRace.name);
    const raceData = {
        name: currentRace.name,
        date: currentRace.date,
        results: results,
        statuses: statuses,
        times: times,
        pole: pole,
        id: existingRaceIndex >= 0 ? state.races[existingRaceIndex].id : Date.now()
    };

    if (existingRaceIndex >= 0) {
        state.races[existingRaceIndex] = raceData;
    } else {
        state.races.push(raceData);
    }

    // Mark calendar entry completed; open next upcoming automatically
    const calRace = (state.raceCalendar || []).find(r => r.name === currentRace.name);
    if (calRace) {
        calRace.status = 'completed';
        // Open next upcoming
        const upcoming = (state.raceCalendar || []).filter(r => (r.status === 'upcoming' || !r.status) && r.id !== calRace.id).sort((a,b)=>new Date(a.date)-new Date(b.date));
        if (upcoming.length > 0) {
            upcoming[0].status = 'drafting';
        }
    }
    
    // Auto-rotate turn order after race completes
    if (state.turnOrder && state.turnOrder.length > 1) {
        const first = state.turnOrder.shift();
        state.turnOrder.push(first);
    }

    // Calculate scores
    calculateRaceScores(raceData);

    saveState();
    updateStandings();
    renderCalendar();
    updateDraftDisplay();
    renderBonusPicks();
    renderRaceFormWithDupesPrevention(); // Refresh form
    alert(`Race results saved: ${currentRace.name}. Next race is now open for drafting!`);
}

function calculateRaceScores(race) {
    if (!state.standings[race.id]) {
        state.standings[race.id] = {};
    }

    const raceStandings = state.standings[race.id];

    state.users.forEach(user => {
        if (!raceStandings[user.id]) {
            raceStandings[user.id] = {
                grojean: 0,
                chilton: 0,
                poleBonus: 0,
                top5Bonus: 0,
                total: 0
            };
        }

        const userStanding = raceStandings[user.id];
        
        // Grojean Draft Points (only if user submitted draft for this race)
        let grojeanPoints = 0;
        const draftSubmitted = state.submissions && state.submissions.draft && state.submissions.draft[race.id] && state.submissions.draft[race.id][user.id];
        if (draftSubmitted) {
            const picks = generatePicksForRace('grojean', String(race.id));
            const userPicks = picks.filter(p => p.userId === user.id);
            userPicks.forEach(pick => {
                const finishData = getDriverFinishPosition(race.results, race.statuses || {}, pick.driverId);
                if (finishData === 'DNS') {
                    grojeanPoints += 0;
                } else if (finishData === 'NC,DNF') {
                    grojeanPoints -= 1; // Non-Classified DNF
                } else if (finishData && typeof finishData === 'object' && finishData.status === 'C,DNF') {
                    // Classified DNF - treat as finishing in that position
                    grojeanPoints += (21 - finishData.position);
                } else if (finishData && typeof finishData === 'number') {
                    grojeanPoints += (21 - finishData);
                }
            });
        }

        // Chilton Draft Points
        let chiltonPoints = 0;
        if (draftSubmitted) {
            const picks = generatePicksForRace('chilton', String(race.id));
            const userPicks = picks.filter(p => p.userId === user.id);
            userPicks.forEach(pick => {
                const finishData = getDriverFinishPosition(race.results, race.statuses || {}, pick.driverId);
                if (finishData === 'DNS') {
                    chiltonPoints += 0;
                } else if (finishData === 'NC,DNF') {
                    chiltonPoints -= 1; // Non-Classified DNF
                } else if (finishData && typeof finishData === 'object' && finishData.status === 'C,DNF') {
                    // Classified DNF - treat as finishing in that position
                    chiltonPoints += finishData.position;
                } else if (finishData && typeof finishData === 'number') {
                    chiltonPoints += finishData;
                }
            });
        }

        // Pole Bonus - 2 points if correct, 0 if wrong
        let poleBonus = 0;
        const bonusesSubmitted = state.submissions && state.submissions.bonus && state.submissions.bonus[race.id] && state.submissions.bonus[race.id][user.id];
        const polePick = bonusesSubmitted && state.bonusPicks.pole[user.id] && state.bonusPicks.pole[user.id][race.id];
        if (polePick && race.pole === polePick) {
            poleBonus = 2;
        }

        // Top 5 Bonus - New scoring system
        // 1 point per driver in top 5 + 1 bonus point for exact position match
        let top5Bonus = 0;
        const top5Picks = bonusesSubmitted && state.bonusPicks.top5[user.id] && state.bonusPicks.top5[user.id][race.id] ? state.bonusPicks.top5[user.id][race.id] : [];
        const top5Results = getTop5Results(race.results);
        
        // For each predicted driver in user's top 5
        top5Picks.forEach((predictedDriverId, predictedPosition) => {
            if (!predictedDriverId) return;
            
            // Check if this driver finished in the actual top 5 (any position)
            const actualPosition = top5Results.indexOf(predictedDriverId);
            
            if (actualPosition !== -1) {
                // Driver is in top 5 - give 1 point
                top5Bonus += 1;
                
                // Check if exact position match (predictedPosition matches actualPosition)
                if (predictedPosition === actualPosition) {
                    // Exact position match - give bonus point
                    top5Bonus += 1;
                }
            }
            // If driver not in top 5, no points (already handled by actualPosition === -1)
        });

        userStanding.grojean = grojeanPoints;
        userStanding.chilton = chiltonPoints;
        userStanding.poleBonus = poleBonus;
        userStanding.top5Bonus = top5Bonus;
        userStanding.total = grojeanPoints + chiltonPoints + poleBonus + top5Bonus;
    });

    saveState();
}

function getDriverFinishPosition(results, statuses, driverId) {
    // First check if driver finished in a valid position
    for (let pos = 1; pos <= 20; pos++) {
        if (results[pos] === driverId) {
            const status = statuses && statuses[driverId];
            // Handle Classified vs Non-Classified DNF
            if (status === 'C,DNF') {
                // Classified DNF - return position with status
                return { position: pos, status: 'C,DNF' };
            } else if (status === 'NC,DNF') {
                // Non-Classified DNF - return flag
                return 'NC,DNF';
            } else if (status === 'DNS') {
                return 'DNS';
            }
            // Normal finish
            return pos;
        }
    }
    
    // If driver has DNS/ DNF but no position assigned
    const status = statuses && statuses[driverId];
    if (status === 'NC,DNF' || status === 'DNF') return 'NC,DNF'; // Default to NC if not specified
    if (status === 'DNS') return 'DNS';
    return null;
}

function getTop5Results(results) {
    const top5 = [];
    for (let pos = 1; pos <= 5; pos++) {
        if (results[pos] && typeof results[pos] === 'number') {
            top5.push(results[pos]);
        }
    }
    return top5;
}

    // Standings
function updateStandings() {
    const filterElement = document.getElementById('standingsRaceFilter');
    const filter = filterElement ? filterElement.value : 'all';
    const standingsTable = document.getElementById('standingsTable');
    
    // Update race filter
    const raceFilter = document.getElementById('standingsRaceFilter');
    if (raceFilter) {
        raceFilter.innerHTML = '<option value="all">All Races</option>';
        state.races.forEach(race => {
            const option = document.createElement('option');
            option.value = race.id;
            option.textContent = race.name;
            raceFilter.appendChild(option);
        });
    }

    // Calculate totals
    const userTotals = {};
    
    state.users.forEach(user => {
        userTotals[user.id] = {
            username: user.username,
            avatar: user.avatar,
            grojean: 0,
            chilton: 0,
            poleBonus: 0,
            top5Bonus: 0,
            total: 0
        };
    });

    // Sum up points from all races
    Object.values(state.standings).forEach(raceStandings => {
        if (filter !== 'all') {
            const raceId = parseInt(filter);
            const currentRace = state.races.find(r => r.id === raceId);
            if (!currentRace || !state.standings[currentRace.id]) return;
            raceStandings = state.standings[currentRace.id];
        }

        Object.keys(raceStandings).forEach(userId => {
            if (userTotals[userId]) {
                const points = raceStandings[userId];
                userTotals[userId].grojean += points.grojean || 0;
                userTotals[userId].chilton += points.chilton || 0;
                userTotals[userId].poleBonus += points.poleBonus || 0;
                userTotals[userId].top5Bonus += points.top5Bonus || 0;
                userTotals[userId].total += points.total || 0;
            }
        });
    });

    // Sort by total
    const sortedUsers = Object.values(userTotals).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.username.localeCompare(b.username);
    });

    // Render table
    standingsTable.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>User</th>
                    <th>Grojean</th>
                    <th>Chilton</th>
                    <th>Pole Bonus</th>
                    <th>Top 5 Bonus</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                ${sortedUsers.map((user, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${user.avatar} ${user.username}</td>
                        <td>${user.grojean}</td>
                        <td>${user.chilton}</td>
                        <td>${user.poleBonus}</td>
                        <td>${user.top5Bonus}</td>
                        <td><strong>${user.total}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Year-end summary (if multiple races)
    const yearEndSummaryEl = document.getElementById('yearEndSummary');
    if (yearEndSummaryEl) {
        if (state.races.length > 0) {
            yearEndSummaryEl.innerHTML = `
                <h3>Season Summary</h3>
                <div class="stat-item">
                    <strong>Total Races:</strong> ${state.races.length}
                </div>
                <div class="stat-item">
                    <strong>Leader:</strong> ${sortedUsers[0] ? sortedUsers[0].avatar + ' ' + sortedUsers[0].username : 'N/A'} (${sortedUsers[0] ? sortedUsers[0].total : 0} pts)
                </div>
            `;
        } else {
            yearEndSummaryEl.innerHTML = '';
        }
    }
    
    // Render graph
    renderStandingsGraph(sortedUsers);
}

function renderStandingsGraph(sortedUsers) {
    const graphContainer = document.getElementById('standingsGraph');
    if (!graphContainer || state.races.length === 0) return;
    
    // Calculate cumulative points per race
    const raceOrder = state.races.sort((a, b) => new Date(a.date) - new Date(b.date));
    const userSeries = {};
    
    sortedUsers.forEach(user => {
        userSeries[user.username] = [];
        let cumulativeTotal = 0;
        
        raceOrder.forEach(race => {
            const raceStanding = state.standings[race.id];
            if (raceStanding && raceStanding[Object.keys(raceStanding).find(id => {
                const u = state.users.find(us => us.id == id);
                return u && u.username === user.username;
            })]) {
                const userId = state.users.find(u => u.username === user.username)?.id;
                cumulativeTotal += raceStanding[userId]?.total || 0;
            }
            userSeries[user.username].push(cumulativeTotal);
        });
    });
    
    // Simple SVG graph
    const maxPoints = Math.max(...Object.values(userSeries).flat(), 1);
    const colors = ['#e10600', '#1e41ff', '#00a859', '#ff9800', '#9c27b0', '#00bcd4', '#ff5722', '#795548', '#607d8b', '#e91e63'];
    let colorIndex = 0;
    
    let svg = `<svg viewBox="0 0 800 400" style="width: 100%; height: 400px; background: var(--bg-primary); border-radius: 8px;">
        <text x="400" y="30" text-anchor="middle" font-size="18" font-weight="600" fill="var(--text-primary)">Cumulative Points Over Season</text>
        <line x1="50" y1="350" x2="750" y2="350" stroke="var(--border-color)" stroke-width="2"/>
        <line x1="50" y1="50" x2="50" y2="350" stroke="var(--border-color)" stroke-width="2"/>
    `;
    
    // Race labels on X-axis
    raceOrder.forEach((race, idx) => {
        const x = 50 + (idx * (700 / (raceOrder.length - 1 || 1)));
        svg += `<text x="${x}" y="370" text-anchor="middle" font-size="10" fill="var(--text-secondary)">${race.name}</text>`;
    });
    
    // Draw lines for each user
    Object.keys(userSeries).forEach((username, userIdx) => {
        const series = userSeries[username];
        const color = colors[userIdx % colors.length];
        const points = series.map((point, idx) => {
            const x = 50 + (idx * (700 / (series.length - 1 || 1)));
            const y = 350 - (point / maxPoints * 300);
            return `${x},${y}`;
        }).join(' ');
        
        svg += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" opacity="0.7"/>`;
        
        // Add points
        series.forEach((point, idx) => {
            const x = 50 + (idx * (700 / (series.length - 1 || 1)));
            const y = 350 - (point / maxPoints * 300);
            svg += `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
        });
    });
    
    // Legend
    let legendY = 60;
    Object.keys(userSeries).forEach((username, userIdx) => {
        const color = colors[userIdx % colors.length];
        const user = sortedUsers.find(u => u.username === username);
        svg += `<circle cx="60" cy="${legendY}" r="6" fill="${color}"/>
                <text x="75" y="${legendY + 4}" font-size="12" fill="var(--text-primary)">${user?.avatar || ''} ${username}</text>`;
        legendY += 20;
    });
    
    svg += '</svg>';
    graphContainer.innerHTML = svg;
}

// CSV Export
function exportToCSV() {
    const userTotals = {};
    
    state.users.forEach(user => {
        userTotals[user.id] = {
            username: user.username,
            grojean: 0,
            chilton: 0,
            poleBonus: 0,
            top5Bonus: 0,
            total: 0
        };
    });

    Object.values(state.standings).forEach(raceStandings => {
        Object.keys(raceStandings).forEach(userId => {
            if (userTotals[userId]) {
                const points = raceStandings[userId];
                userTotals[userId].grojean += points.grojean || 0;
                userTotals[userId].chilton += points.chilton || 0;
                userTotals[userId].poleBonus += points.poleBonus || 0;
                userTotals[userId].top5Bonus += points.top5Bonus || 0;
                userTotals[userId].total += points.total || 0;
            }
        });
    });

    const sortedUsers = Object.values(userTotals).sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.username.localeCompare(b.username);
    });

    let csv = 'Username,Grojean Points,Chilton Points,Pole Bonus,Top 5 Bonus,Total Points\n';
    sortedUsers.forEach(user => {
        csv += `${user.username},${user.grojean},${user.chilton},${user.poleBonus},${user.top5Bonus},${user.total}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `f1-draft-standings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// ========== NEW FEATURES ==========

// Detect current user and update UI
function detectCurrentUser() {
    const savedUserId = localStorage.getItem('currentUserId');
    if (savedUserId && state.users.find(u => u.id == savedUserId)) {
        state.currentUser = parseInt(savedUserId);
    } else if (state.users.length > 0) {
        state.currentUser = state.users[0].id;
        localStorage.setItem('currentUserId', state.currentUser);
    }
    updateCurrentUserBadge();
    updateAdminControls(); // Update admin controls visibility after user detection
}

function populateCurrentUserSelect() {
    const sel = document.getElementById('currentUserSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Sign in…';
    sel.appendChild(placeholder);
    state.users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.avatar} ${u.username}`;
        if (state.currentUser === u.id) opt.selected = true;
        sel.appendChild(opt);
    });
}

function updateCurrentUserBadge() {
    const badge = document.getElementById('currentUserBadge');
    const sel = document.getElementById('currentUserSelect');
    const user = state.users.find(u => u.id === state.currentUser);
    if (badge && user) {
        badge.textContent = `${user.avatar} ${user.username}`;
        badge.style.display = 'inline-block';
        badge.title = 'Click to sign out';
        if (sel) sel.style.display = 'none';
    } else {
        if (badge) badge.style.display = 'none';
        if (sel) sel.style.display = 'inline-block';
    }
}

// Admin check
function isAdmin(userId) {
    if (!userId) userId = state.currentUser;
    if (!userId || state.users.length === 0) return false;
    const user = state.users.find(u => u.id === userId);
    return user && (user.isAdmin === true || state.users.indexOf(user) === 0); // First user is always admin
}

// Update admin controls visibility
function updateAdminControls() {
    const isAdminUser = isAdmin();
    console.log('updateAdminControls called - isAdmin:', isAdminUser, 'currentUser:', state.currentUser, 'users:', state.users.length);
    document.querySelectorAll('.admin-controls').forEach(el => {
        if (isAdminUser) {
            // Force show with !important to override CSS
            el.style.setProperty('display', 'block', 'important');
        } else {
            el.style.setProperty('display', 'none', 'important');
        }
        console.log('Admin control element:', el.id || el.className, 'display:', el.style.display);
    });
}

// Save state with history for undo
function saveStateWithHistory() {
    if (!state.history) state.history = [];
    if (state.history.length > 50) state.history.shift();
    state.history.push(JSON.parse(JSON.stringify(state)));
    localStorage.setItem('f1DraftState', JSON.stringify(state));
}

// Undo last action
function undoAction() {
    if (state.history && state.history.length > 1) {
        state.history.pop();
        const previous = state.history[state.history.length - 1];
        state = JSON.parse(JSON.stringify(previous));
        localStorage.setItem('f1DraftState', JSON.stringify(state));
        location.reload();
    }
}

// Calendar functions
function renderCalendar() {
    const calendarList = document.getElementById('calendarList');
    if (!calendarList) {
        return;
    }
    
    // Update admin controls visibility when rendering calendar
    updateAdminControls();
    
    calendarList.innerHTML = '';
    
    if (!state.raceCalendar || state.raceCalendar.length === 0) {
        calendarList.innerHTML = '<p style="padding: 20px; color: var(--text-secondary);">No races in calendar yet. Admin can add sessions using the "Add Session" button above.</p>';
        return;
    }
    
    state.raceCalendar.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(race => {
        const card = document.createElement('div');
        card.className = 'calendar-card';
        const deadline = new Date(`${race.deadlineDate}T${race.deadlineTime || '00:00'}`);
        const status = race.status || 'upcoming';
        let statusText = '';
        let statusClass = '';
        
        if (status === 'drafting') {
            statusText = '✅ Drafting Open';
            statusClass = 'upcoming';
        } else if (status === 'completed') {
            statusText = '✓ Completed';
            statusClass = 'past-deadline';
        } else {
            statusText = '⏸️ Upcoming';
            statusClass = 'past-deadline';
        }
        
        // Make completed races clickable to show results
        if (status === 'completed') {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => showRaceResults(race));
        }
        
        // Always show Edit button for admins
        const editBtn = isAdmin() ? `<button onclick="event.stopPropagation(); editRace(${race.id})" style="margin-top:10px;">✏️ Edit</button>` : '';
        
        card.innerHTML = `
            <h3>${race.name}</h3>
            <p><strong>Date:</strong> ${new Date(race.date).toLocaleDateString()}</p>
            <p><strong>Draft Deadline:</strong> ${deadline.toLocaleString()}</p>
            <p class="${statusClass}" style="${status === 'upcoming' ? 'color: #888;' : ''}">
                ${statusText}
            </p>
            ${status === 'completed' ? '<p style="font-size:0.9rem;color:var(--text-secondary);margin-top:5px;">Click to view results</p>' : ''}
            ${editBtn}
        `;
        calendarList.appendChild(card);
    });
}

// Check if drafting is allowed for a race
function canDraftForRace(raceId) {
    if (!state.raceCalendar) return true;
    const race = state.raceCalendar.find(r => r.id === raceId);
    if (!race) return true;
    const deadline = new Date(`${race.deadlineDate}T${race.deadlineTime || '00:00'}`);
    return new Date() < deadline;
}

// Show rankings interface for drag-and-drop
function showRankingsInterface() {
    const rankingsInterface = document.getElementById('rankingsInterface');
    if (!rankingsInterface) return;
    const draftType = 'grojean'; // Always grojean now
    const currentRace = getCurrentDraftRace();
    if (!currentRace) {
        rankingsInterface.style.display = 'none';
        return;
    }
    const selectedRaceId = String(currentRace.id);
    
    if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
    if (!state.userRankings[draftType]) state.userRankings[draftType] = {};
    if (!state.userRankings[draftType][state.currentUser]) {
        state.userRankings[draftType][state.currentUser] = {};
    }
    
    let rankings = state.userRankings[draftType][state.currentUser][selectedRaceId];
    if (!rankings) {
        const last = getLastRankingForUser(state.currentUser, draftType);
        rankings = last ? [...last] : [...DRIVERS.map(d=>d.id)];
        state.userRankings[draftType][state.currentUser][selectedRaceId] = rankings;
        saveState();
    }
    
    rankingsInterface.style.display = 'block';
    const rankingsList = document.getElementById('rankingsList');
    rankingsList.innerHTML = '';
    
    rankings.forEach((driverId, index) => {
        const driver = DRIVERS.find(d => d.id === driverId);
        if (!driver) return;
        
        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.draggable = true;
        item.dataset.driverId = driverId;
        item.innerHTML = `
            <span class="ranking-number">${index + 1}</span>
            <span><strong>${driver.name}</strong> - ${driver.team}</span>
        `;
        
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', driverId.toString());
            item.style.opacity = '0.5';
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            const currentId = parseInt(driverId);
            
            if (draggedId !== currentId) {
                const draggedIndex = rankings.indexOf(draggedId);
                const currentIndex = rankings.indexOf(currentId);
                
                rankings.splice(draggedIndex, 1);
                rankings.splice(currentIndex, 0, draggedId);
                
                state.userRankings[draftType][state.currentUser][selectedRaceId] = rankings;
                saveState();
                showRankingsInterface(); // Refresh
            }
            item.style.opacity = '1';
        });
        
        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
        });
        
        rankingsList.appendChild(item);
    });
}

function saveRankings() {
    const draftType = document.getElementById('draftType') ? document.getElementById('draftType').value : 'grojean';
    const currentRace = getCurrentDraftRace();
    if (!currentRace) {
        alert('Draft is not open yet for any race.');
        return;
    }
    const selectedRaceId = String(currentRace.id);
    
    // Rankings are saved during drag-and-drop
    document.getElementById('rankingsInterface').style.display = 'none';
    alert('Rankings saved! Click Submit Draft to finalize for this race.');
}

function calculateAutoPicks(draftType, raceId) {
    // Determine user order (random for now, could be based on previous race)
    const userOrder = [...state.users].sort(() => Math.random() - 0.5);
    const picks = [];
    const usedDrivers = new Set();
    
    // For each round (2 rounds)
    for (let round = 1; round <= 2; round++) {
        const roundOrder = round === 2 ? [...userOrder].reverse() : userOrder;
        
        roundOrder.forEach(user => {
            const userRankings = state.userRankings[draftType][user.id]?.[raceId] || [];
            const isChilton = draftType === 'chilton';
            
            // Find first available driver from user's rankings
            let picked = false;
            for (const driverId of (isChilton ? [...userRankings].reverse() : userRankings)) {
                if (!usedDrivers.has(driverId)) {
                    picks.push({
                        userId: user.id,
                        driverId: driverId,
                        round: round,
                        pickNumber: picks.length + 1
                    });
                    usedDrivers.add(driverId);
                    picked = true;
                    break;
                }
            }
            
            if (!picked) {
                // No available driver from rankings - assign first available
                for (const driver of DRIVERS) {
                    if (!usedDrivers.has(driver.id)) {
                        picks.push({
                            userId: user.id,
                            driverId: driver.id,
                            round: round,
                            pickNumber: picks.length + 1
                        });
                        usedDrivers.add(driver.id);
                        break;
                    }
                }
            }
        });
    }
    
    // Save to draft history
    if (!state.draftHistory[draftType]) state.draftHistory[draftType] = {};
    state.draftHistory[draftType][raceId] = {
        picks: picks,
        completedAt: new Date().toISOString()
    };
    
    saveState();
    updateDraftDisplay();
}

// Race Calendar Modal Functions
function openRaceModal(raceId = null) {
    const modal = document.getElementById('raceModal');
    const modalTitle = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('deleteRaceBtn');
    
    if (raceId) {
        const race = state.raceCalendar.find(r => r.id === raceId);
        if (race) {
            document.getElementById('modalRaceName').value = race.name;
            document.getElementById('modalRaceDate').value = race.date;
            document.getElementById('modalDeadlineDate').value = race.deadlineDate;
            document.getElementById('modalDeadlineTime').value = race.deadlineTime || '00:00';
            document.getElementById('modalRaceStatus').value = race.status || 'upcoming';
            modalTitle.textContent = 'Edit Race';
            // Set dataset for delete/save handlers
            modalTitle.dataset.raceId = String(race.id);
            if (deleteBtn) deleteBtn.style.display = 'block';
        }
    } else {
        modalTitle.textContent = 'Add Session';
        delete modalTitle.dataset.raceId;
        document.getElementById('modalRaceName').value = '';
        document.getElementById('modalRaceDate').value = '';
        document.getElementById('modalDeadlineDate').value = '';
        document.getElementById('modalDeadlineTime').value = '00:00';
        document.getElementById('modalRaceStatus').value = 'upcoming';
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
    
    modal.style.display = 'block';
}

function closeRaceModal() {
    document.getElementById('raceModal').style.display = 'none';
}

function saveRaceToCalendar() {
    const name = document.getElementById('modalRaceName').value.trim();
    const date = document.getElementById('modalRaceDate').value;
    const deadlineDate = document.getElementById('modalDeadlineDate').value;
    const deadlineTime = document.getElementById('modalDeadlineTime').value;
    const status = document.getElementById('modalRaceStatus').value;
    
    if (!name || !date || !deadlineDate) {
        alert('Please fill in all required fields (Race Name, Race Date, and Draft Deadline Date)');
        return;
    }
    
    // Ensure raceCalendar exists
    if (!state.raceCalendar) {
        state.raceCalendar = [];
    }
    
    const existingRace = state.raceCalendar.find(r => r.id === parseInt(document.getElementById('modalTitle').dataset.raceId || '0'));
    
    const raceData = {
        id: existingRace ? existingRace.id : Date.now(),
        name: name,
        date: date,
        deadlineDate: deadlineDate,
        deadlineTime: deadlineTime || '00:00',
        status: status || 'upcoming'
    };
    
    if (existingRace) {
        const index = state.raceCalendar.indexOf(existingRace);
        state.raceCalendar[index] = raceData;
    } else {
        state.raceCalendar.push(raceData);
    }

    // Enforce single open draft session
    if (raceData.status === 'drafting') {
        (state.raceCalendar || []).forEach(r => {
            if (r.id !== raceData.id && r.status === 'drafting') r.status = 'upcoming';
        });
    } else if (raceData.status === 'upcoming') {
        // If setting to upcoming, ensure no other draft is open (but if none open, auto-open this one)
        const hasOpenDraft = (state.raceCalendar || []).some(r => r.status === 'drafting');
        if (!hasOpenDraft) {
            // No draft is open - auto-open this one (first race or next race)
            raceData.status = 'drafting';
        }
    }
    
    saveState();
    renderCalendar();
    updateDraftDisplay();
    renderBonusPicks();
    closeRaceModal();
}

// Render Race Results Page (admin-only for editing)
function renderRaceResultsPage() {
    const raceAdminOnly = document.getElementById('raceAdminOnly');
    const raceNonAdmin = document.getElementById('raceNonAdmin');
    const raceResultsForm = document.getElementById('raceResultsForm');
    const racePasteSection = document.getElementById('racePasteSection');
    const raceBanner = document.getElementById('raceBanner');
    
    // Get current race (most recently closed/completed)
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const currentRace = completedRaces.length > 0 ? completedRaces[0] : getCurrentDraftRace();
    
    if (isAdmin()) {
        // Show admin controls
        if (raceAdminOnly) raceAdminOnly.style.setProperty('display', 'block', 'important');
        if (raceNonAdmin) raceNonAdmin.style.setProperty('display', 'none', 'important');
        
        // Show banner with current race
        if (raceBanner && currentRace) {
            raceBanner.innerHTML = `<div><strong>${currentRace.name}</strong> — Enter Race Results</div>`;
        } else if (raceBanner) {
            raceBanner.innerHTML = '<strong>No active race. Please add a race session in Calendar.</strong>';
        }
        
        // Show paste section and form
        if (racePasteSection) racePasteSection.style.display = 'block';
        if (raceResultsForm) raceResultsForm.style.display = 'block';
        renderRaceFormWithDupesPrevention();
    } else {
        // Hide admin controls for non-admins
        if (raceAdminOnly) raceAdminOnly.style.setProperty('display', 'none', 'important');
        if (raceNonAdmin) raceNonAdmin.style.setProperty('display', 'block', 'important');
        
        // Show latest race results for viewing
        const latestRace = state.races.sort((a,b) => (b.id || 0) - (a.id || 0))[0];
        const raceResultsDisplay = document.getElementById('raceResultsDisplay');
        const raceNoResults = document.getElementById('raceNoResults');
        
        if (latestRace) {
            if (raceResultsDisplay) raceResultsDisplay.style.display = 'block';
            if (raceNoResults) raceNoResults.style.display = 'none';
            displayRaceResultsForPlayers(latestRace);
        } else {
            if (raceResultsDisplay) raceResultsDisplay.style.display = 'none';
            if (raceNoResults) raceNoResults.style.display = 'block';
        }
    }
    
    updateAdminControls();
}

// Display race results in table format for players
function displayRaceResultsForPlayers(race) {
    const raceResultsTitle = document.getElementById('raceResultsTitle');
    const raceResultsTable = document.getElementById('raceResultsTable');
    
    if (!raceResultsTitle || !raceResultsTable) return;
    
    // Find race in calendar for date
    const calRace = (state.raceCalendar || []).find(r => r.name === race.name);
    const raceDate = calRace ? new Date(calRace.date).toLocaleDateString() : '';
    
    raceResultsTitle.textContent = `${race.name}${raceDate ? ` - ${raceDate}` : ''}`;
    
    // Build table
    let tableHtml = '<table class="race-results-table" style="width:100%;margin-top:15px;border-collapse:collapse;">';
    tableHtml += '<thead><tr><th style="padding:8px;border:1px solid var(--border-color);">Pos.</th><th style="padding:8px;border:1px solid var(--border-color);">Driver</th><th style="padding:8px;border:1px solid var(--border-color);">Time/Gap</th></tr></thead><tbody>';
    
    // Sort positions
    const positions = Object.keys(race.results || {}).map(p => parseInt(p)).sort((a,b) => a - b);
    
    positions.forEach(pos => {
        const driverId = race.results[pos];
        const driver = DRIVERS.find(d => d.id === driverId);
        const status = race.statuses && race.statuses[driverId];
        const time = race.times && race.times[driverId] || '';
        
        if (driver) {
            tableHtml += `<tr><td style="padding:8px;border:1px solid var(--border-color);text-align:center;">${pos}</td>`;
            tableHtml += `<td style="padding:8px;border:1px solid var(--border-color);">${driver.name} (${driver.team})${status ? ` - ${status}` : ''}</td>`;
            tableHtml += `<td style="padding:8px;border:1px solid var(--border-color);">${time}</td></tr>`;
        }
    });
    
    tableHtml += '</tbody></table>';
    
    // Add pole position
    if (race.pole) {
        const poleDriver = DRIVERS.find(d => d.id === race.pole);
        if (poleDriver) {
            tableHtml += `<div style="margin-top:20px;padding:15px;background:var(--bg-tertiary);border-radius:8px;"><strong>Pole Position:</strong> ${poleDriver.name} (${poleDriver.team})</div>`;
        }
    }
    
    raceResultsTable.innerHTML = tableHtml;
}

// Update race results with duplicate prevention
function renderRaceFormWithDupesPrevention() {
    const positionsGrid = document.getElementById('positionsGrid');
    const raceBanner = document.getElementById('raceBanner');
    if (!positionsGrid) return;
    
    // Get current race
    const currentRace = getCurrentDraftRace();
    if (!currentRace) {
        if (raceBanner) raceBanner.innerHTML = '<strong>No active race. Please add a race session in Calendar.</strong>';
        positionsGrid.innerHTML = '<p>No race available for results entry.</p>';
        return;
    }
    
    // Show race banner
    if (raceBanner) {
        raceBanner.innerHTML = `<div><strong>${currentRace.name}</strong> — Enter Race Results</div>`;
    }
    
    positionsGrid.innerHTML = '';
    const selectedDrivers = new Set();
    
    // Load existing race data if available
    const existingRace = state.races.find(r => r.name === currentRace.name);
    const existingResults = existingRace ? existingRace.results : {};
    const existingStatuses = existingRace ? existingRace.statuses : {};
    
    // Create position inputs with checkboxes for DNF/DNS
    for (let pos = 1; pos <= 20; pos++) {
        const positionInput = document.createElement('div');
        positionInput.className = 'position-input';
        positionInput.style.display = 'grid';
        positionInput.style.gridTemplateColumns = '100px 1fr auto auto';
        positionInput.style.gap = '10px';
        positionInput.style.alignItems = 'center';
        positionInput.style.marginBottom = '10px';
        
        const label = document.createElement('label');
        label.textContent = `Position ${pos}:`;
        label.style.fontWeight = 'bold';
        
        const select = document.createElement('select');
        select.id = `pos-${pos}`;
        select.style.width = '100%';
        
        // Add empty option
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Select Driver';
        select.appendChild(emptyOption);
        
        // Add drivers (filtered)
        DRIVERS.forEach(driver => {
            if (!selectedDrivers.has(driver.id)) {
                const option = document.createElement('option');
                option.value = driver.id;
                option.textContent = `${driver.name} (${driver.team})`;
                select.appendChild(option);
            }
        });
        
        // Set existing value if available
        if (existingResults[pos]) {
            select.value = existingResults[pos];
            selectedDrivers.add(existingResults[pos]);
        }
        
        // DNF checkbox
        const dnfCheckbox = document.createElement('input');
        dnfCheckbox.type = 'checkbox';
        dnfCheckbox.id = `dnf-${pos}`;
        dnfCheckbox.value = 'DNF';
        if (existingStatuses[existingResults[pos]] === 'DNF') {
            dnfCheckbox.checked = true;
        }
        
        const dnfLabel = document.createElement('label');
        dnfLabel.htmlFor = `dnf-${pos}`;
        dnfLabel.textContent = 'DNF';
        dnfLabel.style.marginLeft = '5px';
        
        const dnfContainer = document.createElement('div');
        dnfContainer.appendChild(dnfCheckbox);
        dnfContainer.appendChild(dnfLabel);
        
        // DNS checkbox
        const dnsCheckbox = document.createElement('input');
        dnsCheckbox.type = 'checkbox';
        dnsCheckbox.id = `dns-${pos}`;
        dnsCheckbox.value = 'DNS';
        if (existingStatuses[existingResults[pos]] === 'DNS') {
            dnsCheckbox.checked = true;
        }
        
        const dnsLabel = document.createElement('label');
        dnsLabel.htmlFor = `dns-${pos}`;
        dnsLabel.textContent = 'DNS';
        dnsLabel.style.marginLeft = '5px';
        
        const dnsContainer = document.createElement('div');
        dnsContainer.appendChild(dnsCheckbox);
        dnsContainer.appendChild(dnsLabel);
        
        // Ensure only one checkbox can be checked
        dnfCheckbox.addEventListener('change', () => {
            if (dnfCheckbox.checked) {
                dnsCheckbox.checked = false;
            }
        });
        dnsCheckbox.addEventListener('change', () => {
            if (dnsCheckbox.checked) {
                dnfCheckbox.checked = false;
            }
        });
        
        // On driver change, update other selects
        select.addEventListener('change', () => {
            const value = select.value;
            selectedDrivers.clear();
            
            // Rebuild selected drivers set
            for (let p = 1; p <= 20; p++) {
                const s = document.getElementById(`pos-${p}`);
                if (s && s.value) {
                    selectedDrivers.add(parseInt(s.value));
                }
            }
            
            // Update all selects
            for (let p = 1; p <= 20; p++) {
                const s = document.getElementById(`pos-${p}`);
                if (s && p !== pos) {
                    const currentValue = s.value;
                    s.innerHTML = '';
                    s.appendChild(new Option('Select Driver', ''));
                    
                    DRIVERS.forEach(driver => {
                        if (!selectedDrivers.has(driver.id) || driver.id == currentValue) {
                            const opt = new Option(`${driver.name} (${driver.team})`, driver.id);
                            s.appendChild(opt);
                        }
                    });
                    
                    if (currentValue) s.value = currentValue;
                }
            }
        });
        
        positionInput.appendChild(label);
        positionInput.appendChild(select);
        positionInput.appendChild(dnfContainer);
        positionInput.appendChild(dnsContainer);
        positionsGrid.appendChild(positionInput);
    }
    
    // Populate pole position select
    const poleSelect = document.getElementById('poleResult');
    if (poleSelect) {
        poleSelect.innerHTML = '<option value="">Select Pole Position Driver</option>';
        DRIVERS.forEach(driver => {
            const option = document.createElement('option');
            option.value = driver.id;
            option.textContent = `${driver.name} (${driver.team})`;
            if (existingRace && existingRace.pole === driver.id) {
                option.selected = true;
            }
            poleSelect.appendChild(option);
        });
    }
}

// Show race results modal when clicking completed race
function showRaceResults(race) {
    const raceData = state.races.find(r => r.name === race.name);
    if (!raceData) {
        alert('Race results not found for this race.');
        return;
    }
    
    // Get draft results for this race
    const grojeanPicks = generatePicksForRace('grojean', String(race.id));
    const chiltonPicks = generatePicksForRace('chilton', String(race.id));
    
    // Calculate points per user
    const userPoints = {};
    state.users.forEach(user => {
        const raceStandings = state.standings[race.id] && state.standings[race.id][user.id];
        userPoints[user.id] = raceStandings ? raceStandings.total || 0 : 0;
    });
    
    // Sort by turn order then by points
    const turnOrder = state.turnOrder || state.users.map(u => u.id);
    const sortedUsers = state.users.sort((a, b) => {
        const aIndex = turnOrder.indexOf(a.id);
        const bIndex = turnOrder.indexOf(b.id);
        return aIndex - bIndex;
    });
    
    let html = `<div class="race-results-modal" style="max-width:600px;margin:20px auto;padding:20px;background:var(--bg-secondary);border-radius:8px;">`;
    html += `<h2>${race.name} - Results</h2>`;
    
    // Race Results (driver positions) - Table format
    html += `<h3>Race Results</h3>`;
    html += `<table class="race-results-table" style="width:100%;margin-top:15px;border-collapse:collapse;">`;
    html += `<thead><tr><th style="padding:8px;border:1px solid var(--border-color);">Pos.</th><th style="padding:8px;border:1px solid var(--border-color);">Driver</th><th style="padding:8px;border:1px solid var(--border-color);">Time/Gap</th></tr></thead><tbody>`;
    
    // Sort positions
    const positions = Object.keys(raceData.results || {}).map(p => parseInt(p)).sort((a,b) => a - b);
    
    positions.forEach(pos => {
        const driverId = raceData.results[pos];
        const driver = DRIVERS.find(d => d.id === driverId);
        const status = raceData.statuses && raceData.statuses[driverId];
        const time = raceData.times && raceData.times[driverId] || '';
        
        if (driver) {
            html += `<tr><td style="padding:8px;border:1px solid var(--border-color);text-align:center;">${pos}</td>`;
            html += `<td style="padding:8px;border:1px solid var(--border-color);">${driver.name} (${driver.team})${status ? ` - ${status}` : ''}</td>`;
            html += `<td style="padding:8px;border:1px solid var(--border-color);">${time}</td></tr>`;
        }
    });
    
    html += `</tbody></table>`;
    
    // Pole Position
    if (raceData.pole) {
        const poleDriver = DRIVERS.find(d => d.id === raceData.pole);
        if (poleDriver) {
            html += `<div style="margin-top:20px;padding:15px;background:var(--bg-tertiary);border-radius:8px;"><strong>Pole Position:</strong> ${poleDriver.name} (${poleDriver.team})</div>`;
        }
    }
    
    // Draft Results (points per player in turn order)
    html += `<h3 style="margin-top:20px;">Draft Results</h3><div class="draft-results-list">`;
    sortedUsers.forEach((user, index) => {
        const points = userPoints[user.id] || 0;
        html += `<div class="draft-result-item"><strong>${index + 1}.</strong> ${user.avatar} ${user.username} - ${points} points</div>`;
    });
    html += `</div></div>`;
    
    // Show in modal or alert
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:700px;">
            <div class="modal-header">
                <h3>${race.name} Results</h3>
                <button class="modal-close" onclick="this.closest('.modal').style.display='none'">&times;</button>
            </div>
            <div class="modal-body">${html}</div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Make user admin
function makeAdmin(userId) {
    // Only current admins can grant admin
    if (!isAdmin(state.currentUser)) {
        alert('Only admins can make other users admins.');
        return;
    }
    const user = state.users.find(u => u.id === userId);
    if (user) {
        user.isAdmin = true;
        saveState();
        renderUsers();
        updateAdminControls();
    }
}

// Update standings display with hidden option (fixed duplicate)
function updateStandingsDisplay() {
    // Show latest race standings (no spoiler)
    const latestRaceStandings = document.getElementById('latestRaceStandings');
    if (latestRaceStandings) {
        const latestRace = state.races.sort((a,b) => (b.id || 0) - (a.id || 0))[0];
        if (latestRace && state.standings[latestRace.id]) {
            const raceStandings = state.standings[latestRace.id];
            const sortedUsers = Object.entries(raceStandings)
                .map(([userId, points]) => {
                    const user = state.users.find(u => u.id == userId);
                    return { user, points: points.total || 0 };
                })
                .filter(item => item.user)
                .sort((a, b) => b.points - a.points);
            
            let html = `<h3>${latestRace.name} - Race Results</h3><div class="race-standings-list">`;
            sortedUsers.forEach((item, index) => {
                html += `<div class="standings-item"><strong>${index + 1}.</strong> ${item.user.avatar} ${item.user.username} - ${item.points} points</div>`;
            });
            html += '</div>';
            latestRaceStandings.innerHTML = html;
        } else {
            latestRaceStandings.innerHTML = '<p>No race results available yet.</p>';
        }
    }
    
    // Season standings (behind spoiler)
    const hiddenDiv = document.getElementById('standingsHidden');
    const visibleDiv = document.getElementById('standingsVisible');
    
    if (hiddenDiv && visibleDiv) {
        const isVisible = localStorage.getItem('standingsVisible') === 'true';
        hiddenDiv.style.display = isVisible ? 'none' : 'block';
        visibleDiv.style.display = isVisible ? 'block' : 'none';
        
        if (isVisible) {
            updateStandings();
        }
    } else {
        // Fallback to old updateStandings if new UI not available
        const standingsTable = document.getElementById('standingsTable');
        if (standingsTable) {
            updateStandings();
        }
    }
}

// Make functions globally accessible
window.deleteUser = deleteUser;
window.savePolePick = savePolePick;
window.saveTop5Pick = saveTop5Pick;
window.undoAction = undoAction;
window.editRace = openRaceModal;
window.showRaceResults = showRaceResults;
window.isAdmin = isAdmin;
window.makeAdmin = makeAdmin;



