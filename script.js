function generatePicksForRace(draftType, raceId) {
    // Validate race ID and normalize to string
    const raceIdStr = String(raceId);
    if (!validateRaceId(raceId, 'generatePicksForRace')) {
        console.warn(`Race ID ${raceIdStr} not in calendar for draft generation`);
        return [];
    }
    
    const isChilton = draftType === 'chilton';
    const submissionsForRace = (state.submissions && state.submissions.draft && state.submissions.draft[raceIdStr]) ? state.submissions.draft[raceIdStr] : {};
    const submittedUsers = state.users.filter(u => submissionsForRace[u.id]);
    // If no submissions, return empty
    if (submittedUsers.length === 0) return [];
    
    // Use turn order (sorted by turnOrder array) - ensures fair rotation
    const turnOrder = state.turnOrder || state.users.map(u => u.id);
    // Base order (ascending by turn order position)
    const baseOrder = submittedUsers.sort((a, b) => {
        const aIndex = turnOrder.indexOf(a.id);
        const bIndex = turnOrder.indexOf(b.id);
        return aIndex - bIndex;
    });
    // For Chilton drafts, reverse user turn order so last pick in Grojean gets first in Chilton
    const order = isChilton ? [...baseOrder].reverse() : baseOrder;
    
    const picks = [];
    const usedDrivers = new Set();
    
    // Two rounds: normal order, then reverse (snake draft)
    for (let round = 1; round <= 2; round++) {
        const roundOrder = round === 2 ? [...order].reverse() : order;
        roundOrder.forEach(user => {
            const rankings = (state.userRankings && state.userRankings[draftType] && state.userRankings[draftType][user.id] && state.userRankings[draftType][user.id][raceIdStr]) ? state.userRankings[draftType][user.id][raceIdStr] : [];
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
    
    // Load initial state and set up real-time listener
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
            
            // Initialize standings if needed (all players start at 0)
            state.users.forEach(user => {
                if (!state.standings) state.standings = {};
                // Initialize per-race standings as races are completed
            });
            
            // Update standings graph if visible
            const standingsTab = document.getElementById('standings-tab');
            if (standingsTab && standingsTab.classList.contains('active')) {
                updateStandings();
            }
            // One-time standings reset AFTER cloud state is loaded, never overwriting users
            try {
                if (!localStorage.getItem('resetPointsDone')) {
                    state.standings = {};
                    saveState();
                    localStorage.setItem('resetPointsDone', 'true');
                    console.log('✅ Standings reset to 0 (post-load)');
                }
            } catch (e) {
                console.warn('Standings reset skipped:', e);
            }

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
    
    // Listen for real-time changes from other users (AUTOMATIC PIPELINE)
    // Only set up listener once (avoid duplicates)
    if (!window.firebaseListenerSetup) {
        window.firebaseListenerSetup = true;
        stateRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const oldStandings = JSON.stringify(state.standings);
                state = { ...state, ...data };
                // Ensure all data structures exist
                if (!state.draftHistory) state.draftHistory = { grojean: {}, chilton: {} };
                if (!state.userRankings) state.userRankings = { grojean: {}, chilton: {} };
                if (!state.bonusPicks) state.bonusPicks = { pole: {}, top5: {} };
                if (!state.races) state.races = [];
                if (!state.raceCalendar) state.raceCalendar = [];
                if (!state.standings) state.standings = {};
                if (!state.history) state.history = [];
                
                // Check if standings changed (race results updated) - AUTOMATIC GRAPH UPDATE
                const newStandings = JSON.stringify(state.standings);
                if (oldStandings !== newStandings) {
                    // Standings updated - refresh graph automatically
                    const standingsTab = document.getElementById('standings-tab');
                    if (standingsTab && standingsTab.classList.contains('active')) {
                        updateStandings(); // This will trigger graph update via renderStandingsGraph
                    }
                }
                
                // Refresh UI components
                renderUsers();
                populateCurrentUserSelect();
                detectCurrentUser();
                renderCalendar();
                updateDraftDisplay(); // Update draft display to show/hide Race In Progress view
                renderBonusPicks();
                updateStandingsDisplay();
                renderRaceResultsPage();
                updateSyncStatus('synced');
            }
        }, (error) => {
            console.error('Firebase listener error:', error);
            updateSyncStatus('error');
        });
    }
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
                } else if (tabName === 'logs' && typeof renderLogs === 'function') {
                    renderLogs();
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
    // Show My Drivers button (Race In Progress view)
    const showMyDriversBtn = document.getElementById('showMyDriversBtn');
    if (showMyDriversBtn) {
        showMyDriversBtn.addEventListener('click', showMyDriversForRace);
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
    
    const showResultsEditorBtn = document.getElementById('showResultsEditorBtn');
    if (showResultsEditorBtn) {
        showResultsEditorBtn.addEventListener('click', () => {
            const editor = document.getElementById('raceResultsEditor');
            if (editor) {
                editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
                if (editor.style.display === 'block') {
                    // Initialize pole dropdown when editor opens
                    const poleSelect = document.getElementById('poleResult');
                    if (poleSelect) {
                        poleSelect.innerHTML = '<option value="">Select Pole Position</option>' + 
                            DRIVERS.map(d => `<option value="${d.id}">${d.name} (${d.team})</option>`).join('');
                    }
                }
            }
        });
    }
    
    // Rename save button to publish button
    const publishRaceResultsBtn = document.getElementById('publishRaceResultsBtn');
    if (publishRaceResultsBtn) {
        publishRaceResultsBtn.addEventListener('click', saveRaceResults);
    }
    
    // Spoiler alert buttons
    const showRaceResultsBtn = document.getElementById('showRaceResultsBtn');
    if (showRaceResultsBtn) {
        showRaceResultsBtn.addEventListener('click', () => {
            const spoiler = document.getElementById('raceResultsSpoiler');
            const display = document.getElementById('raceResultsDisplay');
            const raceId = spoiler ? spoiler.dataset.raceId : null;
            
            if (raceId && display) {
                const race = state.races.find(r => String(r.id) === String(raceId));
                if (race) {
                    displayRaceResultsForPlayers(race);
                    if (spoiler) spoiler.style.display = 'none';
                    display.style.display = 'block';
                }
            }
        });
    }
    
    const hideRaceResultsBtn = document.getElementById('hideRaceResultsBtn');
    if (hideRaceResultsBtn) {
        hideRaceResultsBtn.addEventListener('click', () => {
            const spoiler = document.getElementById('raceResultsSpoiler');
            const display = document.getElementById('raceResultsDisplay');
            if (spoiler) spoiler.style.display = 'block';
            if (display) display.style.display = 'none';
        });
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
    const editSeasonPointsBtn = document.getElementById('editSeasonPointsBtn');
    if (editSeasonPointsBtn) {
        editSeasonPointsBtn.addEventListener('click', () => {
            if (!isAdmin()) return;
            const modal = document.getElementById('seasonAdjustModal');
            const list = document.getElementById('seasonAdjustList');
            if (!modal || !list) return;
            list.innerHTML = '';
            const adjustments = state.seasonAdjustments || {};
            state.users.forEach(user => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.gap = '10px';
                row.style.margin = '6px 0';
                row.innerHTML = `<div style="min-width:160px;">${user.avatar} ${user.username}</div><input type="number" id="seasonAdj-${user.id}" value="${parseInt(adjustments[user.id] || 0, 10)}" style="width:120px;padding:8px;border:1px solid var(--border-color);border-radius:6px;" />`;
                list.appendChild(row);
            });
            modal.style.display = 'block';
        });
    }
    const seasonAdjustClose = document.getElementById('seasonAdjustClose');
    if (seasonAdjustClose) {
        seasonAdjustClose.addEventListener('click', () => {
            const modal = document.getElementById('seasonAdjustModal');
            if (modal) modal.style.display = 'none';
        });
    }
    const seasonAdjustSave = document.getElementById('seasonAdjustSave');
    if (seasonAdjustSave) {
        seasonAdjustSave.addEventListener('click', () => {
            if (!isAdmin()) return;
            if (!state.seasonAdjustments) state.seasonAdjustments = {};
            state.users.forEach(user => {
                const el = document.getElementById(`seasonAdj-${user.id}`);
                if (el) {
                    const val = parseInt(el.value, 10) || 0;
                    state.seasonAdjustments[user.id] = val;
                }
            });
            saveState();
            updateStandings();
            const modal = document.getElementById('seasonAdjustModal');
            if (modal) modal.style.display = 'none';
        });
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
// Validate race ID exists in calendar (runtime check)
function validateRaceId(raceId, context = '') {
    if (!raceId) {
        console.error(`[Race ID Validation] Race ID is null or undefined${context ? ` (${context})` : ''}`);
        return false;
    }
    const raceIdStr = String(raceId);
    const exists = (state.raceCalendar || []).some(r => String(r.id) === raceIdStr);
    if (!exists) {
        const errorMsg = `[Race ID Validation] Race ID ${raceIdStr} not found in calendar${context ? ` (${context})` : ''}. This may cause data inconsistencies.`;
        console.error(errorMsg);
        // In development, throw error to catch issues early
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('Available race IDs:', (state.raceCalendar || []).map(r => ({ id: r.id, name: r.name })));
        }
    }
    return exists;
}

function getCurrentDraftRace() {
    if (!Array.isArray(state.raceCalendar) || state.raceCalendar.length === 0) return null;
    // Current draftable race = status 'drafting'
    let drafting = state.raceCalendar.find(r => r.status === 'drafting');
    if (drafting) {
        validateRaceId(drafting.id, 'getCurrentDraftRace');
        return drafting;
    }
    
    // Auto-open next upcoming race if none is drafting (should always be one open)
    const upcoming = state.raceCalendar.filter(r => (r.status === 'upcoming' || !r.status) && r.status !== 'completed').sort((a,b)=>new Date(a.date || a.deadlineDate)-new Date(b.date || b.deadlineDate));
    if (upcoming.length > 0) {
        upcoming[0].status = 'drafting';
        validateRaceId(upcoming[0].id, 'getCurrentDraftRace - auto-open');
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

    if (state.users.length >= 20) {
        alert('Maximum 20 users allowed');
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
    const rankingsInterface = document.getElementById('rankingsInterface');
    const raceInProgressView = document.getElementById('raceInProgressView');
    
    // Check if there's a completed race without results posted
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const mostRecentCompleted = completedRaces.length > 0 ? completedRaces[0] : null;
    
    // Check if results are posted for the most recent completed race
    let hasResults = false;
    if (mostRecentCompleted) {
        const raceIdStr = String(mostRecentCompleted.id);
        hasResults = state.races && state.races.some(r => String(r.id) === raceIdStr);
    }
    
    // If there's a completed race without results, show "Race In Progress" view
    if (mostRecentCompleted && !hasResults) {
        // Hide normal draft interface
        if (rankingsInterface) rankingsInterface.style.display = 'none';
        if (draftBanner) draftBanner.style.display = 'none';
        
        // Show Race In Progress view
        if (raceInProgressView) {
            raceInProgressView.style.display = 'block';
            const raceNameEl = document.getElementById('raceInProgressName');
            if (raceNameEl) raceNameEl.textContent = mostRecentCompleted.name;
        }
        
        // Hide old draft status elements
        if (draftStatus) draftStatus.innerHTML = '';
        if (draftProgress) draftProgress.innerHTML = '';
        if (draftQueue) draftQueue.innerHTML = '';
        if (availableDrivers) availableDrivers.innerHTML = '';
        if (draftPicks) draftPicks.innerHTML = '';
        return;
    }
    
    // Normal draft interface - hide Race In Progress view
    if (raceInProgressView) raceInProgressView.style.display = 'none';
    if (draftBanner) draftBanner.style.display = 'block';
    
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
        if (rankingsInterface) rankingsInterface.style.display = 'none';
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

    // Show rankings list for current race
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
    
    // Get the most recently COMPLETED race (not the current "Drafting Open" one)
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const targetRace = completedRaces.length > 0 ? completedRaces[0] : null;
    
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
    
    // Populate the clean table
    const tableContainer = document.getElementById('parsedResultsTableContainer');
    const tableBody = document.getElementById('parsedResultsTableBody');
    const poleSelect = document.getElementById('poleResult');
    
    if (!tableContainer || !tableBody) {
        if (parseError) {
            parseError.style.display = 'block';
            parseError.textContent = 'Table elements not found.';
        }
        return;
    }
    
    // Clear existing table rows
    tableBody.innerHTML = '';
    
    // Populate pole dropdown
    if (poleSelect) {
        poleSelect.innerHTML = '<option value="">Select Pole Position</option>' + 
            DRIVERS.map(d => `<option value="${d.id}" ${pole === d.id ? 'selected' : ''}>${d.name} (${d.team})</option>`).join('');
    }
    
    // Sort positions and populate table
    const sortedPositions = Object.keys(results).map(p => parseInt(p)).sort((a,b) => a - b);
    
    sortedPositions.forEach(pos => {
        const driverId = results[pos];
        const driver = DRIVERS.find(d => d.id === driverId);
        const time = times[driverId] || '';
        const status = statuses[driverId] || '';
        
        if (driver) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding:8px;border:1px solid var(--border-color);text-align:center;">${pos}</td>
                <td style="padding:8px;border:1px solid var(--border-color);">${driver.name} (${driver.team})${status ? ` - ${status}` : ''}</td>
                <td style="padding:8px;border:1px solid var(--border-color);">${time}</td>
            `;
            tableBody.appendChild(row);
        }
    });
    
    // Store parsed data for publishing
    if (!window.parsedRaceData) window.parsedRaceData = {};
    window.parsedRaceData.results = results;
    window.parsedRaceData.times = times;
    window.parsedRaceData.statuses = statuses;
    
    // Show table container
    tableContainer.style.display = 'block';
    
    // Set pole position if parsed
    if (pole && poleSelect) {
        poleSelect.value = pole;
    }
    
    // Add sorting functionality to table headers
    addTableSorting();
    
    if (parseError) parseError.style.display = 'none';
}

function saveRaceResults() {
    if (!isAdmin()) {
        alert('Only admins can save race results');
        return;
    }
    
    // Get the most recently COMPLETED race (not the current "Drafting Open" one)
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const currentRace = completedRaces.length > 0 ? completedRaces[0] : null;
    
    if (!currentRace) {
        alert('No completed race found. Please complete a race session in Calendar first.');
        return;
    }

    // Get results from parsed data
    const results = {};
    const statuses = {};
    const times = {};
    
    if (window.parsedRaceData && window.parsedRaceData.results) {
        // Use parsed data from table
        Object.assign(results, window.parsedRaceData.results);
        Object.assign(statuses, window.parsedRaceData.statuses || {});
        Object.assign(times, window.parsedRaceData.times || {});
    } else {
        // Fallback: read from table rows
        const tableBody = document.getElementById('parsedResultsTableBody');
        if (tableBody) {
            const rows = tableBody.querySelectorAll('tr');
            rows.forEach((row) => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    const pos = parseInt(cells[0].textContent.trim());
                    const driverText = cells[1].textContent.trim();
                    const time = cells[2].textContent.trim();
                    
                    // Extract driver name from "Driver Name (Team) - Status"
                    const driverMatch = driverText.match(/^([^(]+)/);
                    if (driverMatch) {
                        const driverName = driverMatch[1].trim();
                        const driver = DRIVERS.find(d => d.name === driverName);
                        if (driver && !isNaN(pos)) {
                            results[pos] = driver.id;
                            times[driver.id] = time;
                            
                            // Check for status in driver text
                            if (driverText.includes('C,DNF')) {
                                statuses[driver.id] = 'C,DNF';
                            } else if (driverText.includes('NC,DNF')) {
                                statuses[driver.id] = 'NC,DNF';
                            } else if (driverText.includes('DNS')) {
                                statuses[driver.id] = 'DNS';
                            }
                        }
                    }
                }
            });
        }
    }

    if (Object.keys(results).length === 0) {
        alert('Please parse race results first.');
        return;
    }
    
    // Validate no duplicate drivers
    const driverIds = Object.values(results);
    const uniqueDrivers = new Set(driverIds);
    if (driverIds.length !== uniqueDrivers.size) {
        alert('Duplicate driver detected in results. Please fix before publishing.');
        return;
    }

    const poleSelect = document.getElementById('poleResult');
    const pole = poleSelect && poleSelect.value ? parseInt(poleSelect.value) : null;
    
    if (!pole) {
        if (!confirm('No pole position selected. Continue without pole position?')) {
            return;
        }
    }

    // Calculate or update race - use race calendar ID to prevent duplicates
    const raceId = String(currentRace.id); // Use calendar race ID as string for consistency
    const existingRaceIndex = state.races.findIndex(r => String(r.id) === raceId);
    
    const raceData = {
        name: currentRace.name,
        date: currentRace.date,
        results: results,
        statuses: statuses,
        times: times,
        pole: pole,
        id: raceId // Always use the calendar race ID
    };

    if (existingRaceIndex >= 0) {
        // Update existing race
        state.races[existingRaceIndex] = raceData;
    } else {
        // Only add if it doesn't exist
        state.races.push(raceData);
    }

    // Mark calendar entry completed; open next upcoming automatically
    // Use race ID instead of name for reliable matching
    const calRace = (state.raceCalendar || []).find(r => String(r.id) === String(currentRace.id));
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

    // Validate race ID before proceeding
    if (!validateRaceId(raceId, 'saveRaceResults')) {
        console.error(`Race ID ${raceId} not found in calendar. Cannot save results.`);
        alert('Error: Race not found in calendar. Please check the race ID.');
        return;
    }
    
    // Calculate scores - AUTOMATIC PIPELINE
    calculateRaceScores(raceData);

    // Save state immediately after scoring
    saveState();
    
    // Update UI components - AUTOMATIC REFRESH
    updateStandings(); // This will trigger graph update via renderStandingsGraph
    renderCalendar();
    updateDraftDisplay(); // Update to hide Race In Progress view and show normal draft interface
    renderBonusPicks();
    
    // Hide editor and show published results
    const raceResultsEditor = document.getElementById('raceResultsEditor');
    if (raceResultsEditor) raceResultsEditor.style.display = 'none';
    
    // Refresh the race results page to show published results
    renderRaceResultsPage();
    
    // Real-time update: If on standings tab, force graph refresh
    const standingsTab = document.getElementById('standings-tab');
    if (standingsTab && standingsTab.classList.contains('active')) {
        setTimeout(() => {
            const sortedUsers = Object.values(state.users.reduce((acc, user) => {
                acc[user.id] = {
                    id: user.id,
                    username: user.username,
                    avatar: user.avatar
                };
                return acc;
            }, {})).sort((a, b) => a.username.localeCompare(b.username));
            renderStandingsGraph(sortedUsers);
        }, 100);
    }
    
    alert(`Race results published for ${currentRace.name}! Points have been calculated and standings updated. Next race is now open for drafting!`);
}

function calculateRaceScores(race) {
    // Validate race ID
    const raceIdStr = String(race.id);
    if (!validateRaceId(race.id, 'calculateRaceScores')) {
        console.error(`Cannot calculate scores: Race ID ${raceIdStr} not in calendar`);
        return;
    }
    
    // Initialize standings for this race if needed
    if (!state.standings[raceIdStr]) {
        state.standings[raceIdStr] = {};
    }

    const raceStandings = state.standings[raceIdStr];

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
        const raceIdStr = String(race.id);
        const draftSubmitted = state.submissions && state.submissions.draft && state.submissions.draft[raceIdStr] && state.submissions.draft[raceIdStr][user.id];
        
        if (draftSubmitted) {
            const picks = generatePicksForRace('grojean', raceIdStr);
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
            const picks = generatePicksForRace('chilton', raceIdStr);
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
        const bonusesSubmitted = state.submissions && state.submissions.bonus && state.submissions.bonus[raceIdStr] && state.submissions.bonus[raceIdStr][user.id];
        const polePick = bonusesSubmitted && state.bonusPicks.pole && state.bonusPicks.pole[user.id] && state.bonusPicks.pole[user.id][raceIdStr];
        if (polePick && race.pole === polePick) {
            poleBonus = 2;
        }

        // Top 5 Bonus - New scoring system
        // 1 point per driver in top 5 + 1 bonus point for exact position match
        let top5Bonus = 0;
        const top5Picks = bonusesSubmitted && state.bonusPicks.top5 && state.bonusPicks.top5[user.id] && state.bonusPicks.top5[user.id][raceIdStr] ? state.bonusPicks.top5[user.id][raceIdStr] : [];
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
    
    // Update race filter - use calendar as single source of truth
    const raceFilter = document.getElementById('standingsRaceFilter');
    if (raceFilter) {
        // Preserve current selection while rebuilding options
        const prevSelection = raceFilter.value || filter;
        raceFilter.innerHTML = '<option value="all">All Races</option>';
        // Use calendar races instead of state.races for consistency
        const calendarRaces = (state.raceCalendar || []).sort((a, b) => new Date(a.date || a.deadlineDate) - new Date(b.date || b.deadlineDate));
        calendarRaces.forEach(race => {
            const option = document.createElement('option');
            option.value = String(race.id);
            option.textContent = race.name;
            raceFilter.appendChild(option);
        });
        // Restore selection if possible
        if (prevSelection && Array.from(raceFilter.options).some(o => o.value === prevSelection)) {
            raceFilter.value = prevSelection;
        } else {
            raceFilter.value = 'all';
        }
    }

    // Calculate totals
    const userTotals = {};
    
    state.users.forEach(user => {
        userTotals[user.id] = {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            draft: 0, // grojean + chilton
            poleBonus: 0,
            top5Bonus: 0,
            total: 0
        };
    });

    // Sum up points from all races
    if (filter === 'all') {
        // Sum all races
        Object.entries(state.standings).forEach(([raceIdStr, raceStandings]) => {
            Object.keys(raceStandings).forEach(userId => {
                if (userTotals[userId]) {
                    const points = raceStandings[userId];
                    userTotals[userId].draft += (points.grojean || 0) + (points.chilton || 0);
                    userTotals[userId].poleBonus += points.poleBonus || 0;
                    userTotals[userId].top5Bonus += points.top5Bonus || 0;
                    userTotals[userId].total += points.total || 0;
                }
            });
        });
    } else {
        // Filter by specific race
        const raceIdStr = String(filter);
        const raceStandings = state.standings[raceIdStr];
        if (raceStandings) {
            Object.keys(raceStandings).forEach(userId => {
                if (userTotals[userId]) {
                    const points = raceStandings[userId];
                    userTotals[userId].draft = (points.grojean || 0) + (points.chilton || 0);
                    userTotals[userId].poleBonus = points.poleBonus || 0;
                    userTotals[userId].top5Bonus = points.top5Bonus || 0;
                    userTotals[userId].total = points.total || 0;
                }
            });
        }
    }

    // Apply season adjustments (admin edits) to totals only for All Races view
    if (filter === 'all') {
        const adjustments = state.seasonAdjustments || {};
        Object.keys(userTotals).forEach(uid => {
            const delta = parseInt(adjustments[uid] || 0, 10) || 0;
            userTotals[uid].total += delta;
        });
    }

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
                    <th>Draft</th>
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
                        <td>${user.draft}</td>
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
    if (!graphContainer) return;
    
    // Use calendar as single source of truth - show ALL races on timeline for context
    // Runtime check: ensure calendar exists and has valid race IDs
    if (!state.raceCalendar || !Array.isArray(state.raceCalendar)) {
        console.error('[Standings Graph] Race calendar is not initialized');
        graphContainer.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px;">Race calendar not initialized. Please add races to the calendar first.</p>';
        return;
    }
    
    const allCalendarRaces = state.raceCalendar.sort((a, b) => {
        const dateA = new Date(a.date || a.deadlineDate);
        const dateB = new Date(b.date || b.deadlineDate);
        return dateA - dateB;
    });
    
    // Validate all races have IDs
    const racesWithoutIds = allCalendarRaces.filter(r => !r.id);
    if (racesWithoutIds.length > 0) {
        console.error('[Standings Graph] Found races without IDs:', racesWithoutIds.map(r => r.name));
    }
    
    if (allCalendarRaces.length === 0) {
        graphContainer.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px;">No races in calendar yet. Add races to see standings graph.</p>';
        return;
    }
    
    // Find completed races (races with standings data)
    const completedRaces = allCalendarRaces.filter(race => {
        const raceIdStr = String(race.id);
        return state.standings[raceIdStr] && Object.keys(state.standings[raceIdStr]).length > 0;
    });
    
    if (completedRaces.length === 0) {
        graphContainer.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px;">No race results published yet. Publish race results to see standings graph.</p>';
        return;
    }
    
    // Find the last completed race - lines will stop here
    const lastCompletedRace = completedRaces.length > 0 
        ? completedRaces.sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date))[0]
        : null;
    
    // Destroy existing chart if it exists
    if (window.standingsChart) {
        window.standingsChart.destroy();
        window.standingsChart = null;
    }
    
    // Clear container
    graphContainer.innerHTML = '<canvas id="standingsChartCanvas" aria-label="Cumulative points over season for all players" role="img"></canvas>';
    const canvas = document.getElementById('standingsChartCanvas');
    if (!canvas) return;
    
    // Timeline shows "Season Start" first, then ALL races from calendar
    // Season Start shows all players at 0 points
    const chartData = {
        labels: ['Season Start', ...allCalendarRaces.map(race => race.name)],
        datasets: []
    };
    
    // Find the index of the last completed race in the full timeline
    // Note: Add 1 to account for "Season Start" at index 0
    const lastCompletedIndex = lastCompletedRace 
        ? allCalendarRaces.findIndex(r => String(r.id) === String(lastCompletedRace.id)) + 1 // +1 for Season Start
        : 0; // 0 means only Season Start is shown (no races completed yet)
    
    const colors = [
        'rgb(225, 6, 0)',      // Red Bull red
        'rgb(30, 65, 255)',    // Blue
        'rgb(0, 168, 89)',     // Green
        'rgb(255, 152, 0)',    // Orange
        'rgb(156, 39, 176)',   // Purple
        'rgb(0, 188, 212)',    // Cyan
        'rgb(255, 87, 34)',    // Deep Orange
        'rgb(121, 85, 72)',    // Brown
        'rgb(96, 125, 139)',   // Blue Grey
        'rgb(233, 30, 99)'     // Pink
    ];
    
    // Use the same calculation logic as the standings table
    // For each user, calculate cumulative points race by race (matching table totals exactly)
    sortedUsers.forEach((user, userIdx) => {
        const userId = user.id; // Now guaranteed to exist from updateStandings
        const username = user.username;
        const data = [];
        let cumulativeTotal = 0;
        
        // Season Start: All players begin at 0 points
        data.push(0);
        
        // Calculate cumulative points for each race in chronological order
        // Everyone starts at 0 at "Season Start", then accumulates points race by race
        // Show ALL races on timeline, but only plot data for completed races
        // For each race: if standings exist, add those points to cumulative; otherwise keep previous total
        // This ensures: Season Start → 0; Race 1 with 10 pts → shows 10; Race 2 with 5 pts → shows 15 (cumulative)
        allCalendarRaces.forEach((race, index) => {
            const raceIdStr = String(race.id);
            // Validate race ID exists in calendar
            if (!validateRaceId(race.id, `renderStandingsGraph - race at index ${index}`)) {
                console.warn(`Skipping invalid race ID in graph: ${raceIdStr}`);
                data.push(null);
                return;
            }
            
            const raceStanding = state.standings[raceIdStr];
            
            // For completed races (with standings data), add points earned this race
            // Note: lastCompletedIndex now includes Season Start offset, so we compare with index+1
            const raceIndexInChart = index + 1; // +1 because Season Start is at index 0
            if (raceStanding && userId && raceStanding[userId] && raceIndexInChart <= lastCompletedIndex) {
                const pointsThisRace = raceStanding[userId].total || 0;
                // Add points from this race to cumulative total
                cumulativeTotal += pointsThisRace;
                // Push the cumulative total after this race
                data.push(cumulativeTotal);
            } else if (raceIndexInChart <= lastCompletedIndex) {
                // Race is before or at last completed, but no standings for this user
                // Keep previous cumulative total (stays at 0 until first race with points)
                data.push(cumulativeTotal);
            } else {
                // Future races (after last completed) - use null to break the line
                data.push(null);
            }
        });
        
        // Store race-by-race points for tooltip calculation
        // Include Season Start (0 points) at index 0, then race points
        // Note: lastCompletedIndex includes Season Start offset, so we compare with index+1
        user._racePoints = [0, ...allCalendarRaces.map((race, index) => {
            const raceIndexInChart = index + 1; // +1 because Season Start is at index 0
            if (raceIndexInChart > lastCompletedIndex) return null;
            const raceIdStr = String(race.id);
            const raceStanding = state.standings[raceIdStr];
            if (raceStanding && userId && raceStanding[userId]) {
                return raceStanding[userId].total || 0;
            }
            return 0;
        })];
        
        // Verify: The final cumulative total should match the table total
        const tableTotal = user.total;
        
        chartData.datasets.push({
            label: `${user.avatar || ''} ${username} (${tableTotal} pts)`,
            data: data,
            borderColor: colors[userIdx % colors.length],
            backgroundColor: colors[userIdx % colors.length].replace('rgb', 'rgba').replace(')', ', 0.1)'),
            borderWidth: 2.5,
            fill: false,
            tension: 0.4, // Smooth curves
            spanGaps: false, // Don't draw lines across null values (future races)
            pointRadius: function(context) {
                // Show points for all data points (including Season Start at 0)
                // Hide points for future races (null values)
                if (context.parsed.y === null) return 0;
                // Show slightly smaller point for Season Start (index 0)
                return context.dataIndex === 0 ? 3 : 4;
            },
            pointHoverRadius: function(context) {
                // Show hover effect for all data points (including Season Start)
                if (context.parsed.y === null) return 0;
                return context.dataIndex === 0 ? 5 : 6;
            },
            pointBackgroundColor: colors[userIdx % colors.length],
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointHoverBackgroundColor: colors[userIdx % colors.length],
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 3
        });
    });
    
    // Get computed CSS variables for Chart.js colors
    const getComputedColor = (varName) => {
        const style = getComputedStyle(document.documentElement);
        return style.getPropertyValue(varName).trim() || '#000000';
    };
    
    const textPrimary = getComputedColor('--text-primary');
    const textSecondary = getComputedColor('--text-secondary');
    const borderColor = getComputedColor('--border-color');
    
    // Register zoom plugin (if available)
    if (typeof ChartZoom !== 'undefined') {
        Chart.register(ChartZoom);
    } else if (typeof window.ChartZoom !== 'undefined') {
        Chart.register(window.ChartZoom);
    }
    
    // Create Chart.js line chart with zoom/pan capabilities
    const ctx = canvas.getContext('2d');
    window.standingsChart = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    bottom: window.innerWidth < 768 ? 35 : 40 // Extra padding for rotated labels, especially Season Start
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            // Add click handler for race labels to zoom to that section
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const datasetIndex = elements[0].datasetIndex;
                    const index = elements[0].index;
                    // Zoom to show 3 races around the clicked one (accounting for Season Start at index 0)
                    const start = Math.max(0, index - 1);
                    const end = Math.min(allCalendarRaces.length, index + 1); // +1 for Season Start
                    window.standingsChart.zoomScale('x', { min: start, max: end });
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Cumulative Points Over Season',
                    font: {
                        size: window.innerWidth < 768 ? 14 : 18,
                        weight: '600'
                    },
                    color: textPrimary,
                    padding: {
                        top: 10,
                        bottom: 20
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    align: 'center',
                    labels: {
                        usePointStyle: true,
                        padding: window.innerWidth < 768 ? 10 : 15,
                        font: {
                            size: window.innerWidth < 768 ? 10 : 12
                        },
                        color: textPrimary,
                        generateLabels: function(chart) {
                            const original = Chart.defaults.plugins.legend.labels.generateLabels;
                            const labels = original.call(this, chart);
                            labels.forEach((label, idx) => {
                                label.text = chartData.datasets[idx].label;
                            });
                            return labels;
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            // Return race name
                            return context[0].label;
                        },
                        label: function(context) {
                            const datasetIndex = context.datasetIndex;
                            const dataIndex = context.dataIndex;
                            const user = sortedUsers[datasetIndex];
                            const currentValue = context.parsed.y;
                            const previousValue = context.dataIndex > 0 ? context.dataset.data[context.dataIndex - 1] : 0;
                            
                            // Extract player name from label (remove points suffix)
                            const playerName = user.username || context.dataset.label.split(' (')[0].replace(/^[🏎️🏁🏆🥇🔥⚡💨🎯🚗🏴]*\s*/, '');
                            
                            // Handle Season Start (index 0) specially
                            if (dataIndex === 0) {
                                return [
                                    `Player: ${playerName}`,
                                    `Season Start`,
                                    `Points Earned: 0`,
                                    `Total Points: 0`
                                ];
                            }
                            
                            // Calculate points this race more accurately
                            let pointsThisRace = 0;
                            if (user._racePoints && user._racePoints[dataIndex] !== null && user._racePoints[dataIndex] !== undefined) {
                                pointsThisRace = user._racePoints[dataIndex];
                            } else {
                                // Fallback calculation
                                pointsThisRace = currentValue - (previousValue || 0);
                            }
                            
                            return [
                                `Player: ${playerName}`,
                                `Race: ${context[0].label}`,
                                `Points Earned This Race: ${pointsThisRace}`,
                                `Total Points: ${currentValue || 0}`
                            ];
                        }
                    }
                },
                zoom: {
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy',
                        limits: {
                            x: { min: 0, max: allCalendarRaces.length }, // +1 for Season Start
                            y: { min: 0 }
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'xy',
                        limits: {
                            x: { min: 0, max: allCalendarRaces.length }, // +1 for Season Start
                            y: { min: 0 }
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Race',
                        color: textSecondary,
                        font: {
                            size: 12,
                            weight: '500'
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.08)',
                        drawBorder: true,
                        borderColor: borderColor
                    },
                    // Add extra padding at the bottom to ensure first label (Season Start) is visible
                    offset: true,
                    ticks: {
                        color: textSecondary,
                        maxRotation: 45,
                        minRotation: 45,
                        font: {
                            size: window.innerWidth < 768 ? 8 : 10
                        },
                        padding: window.innerWidth < 768 ? 12 : 15, // Increased padding to prevent cutoff
                        callback: function(value, index) {
                            const label = this.getLabelForValue(value);
                            // Special handling for Season Start label - ensure it's always visible
                            if (index === 0 && label === 'Season Start') {
                                // On mobile, show shorter version but ensure it's visible
                                return window.innerWidth < 768 ? 'Start' : 'Season Start';
                            }
                            // Truncate long race names for readability on mobile
                            const maxLength = window.innerWidth < 768 ? 10 : 15;
                            return label.length > maxLength ? label.substring(0, maxLength - 3) + '...' : label;
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Cumulative Points',
                        color: textSecondary,
                        font: {
                            size: 12,
                            weight: '500'
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.08)',
                        drawBorder: true,
                        borderColor: borderColor
                    },
                    ticks: {
                        color: textSecondary,
                        precision: 0,
                        font: {
                            size: window.innerWidth < 768 ? 9 : 11
                        },
                        // Auto-scale for large point values (up to 1248+ points)
                        stepSize: function(context) {
                            const maxValue = context.chart.scales.y.max;
                            if (maxValue > 500) return 100;
                            if (maxValue > 200) return 50;
                            if (maxValue > 100) return 25;
                            return 10;
                        }
                    }
                }
            },
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            }
        }
    });
    
    // Set canvas height for responsive design - larger for better visibility
    const isMobile = window.innerWidth < 768;
    canvas.style.height = isMobile ? '350px' : '500px';
    canvas.style.maxHeight = isMobile ? '60vh' : '80vh';
    canvas.style.minHeight = isMobile ? '300px' : '400px';
    
    // Add zoom controls for easy navigation
    const zoomControls = document.createElement('div');
    zoomControls.className = 'zoom-controls';
    zoomControls.style.cssText = 'display: flex; gap: 10px; margin-top: 10px; justify-content: center; flex-wrap: wrap;';
    zoomControls.innerHTML = `
        <button class="btn-secondary" onclick="if(window.standingsChart){window.standingsChart.zoom(1.2);}" style="padding: 5px 15px; font-size: 12px;">🔍 Zoom In</button>
        <button class="btn-secondary" onclick="if(window.standingsChart){window.standingsChart.zoom(0.8);}" style="padding: 5px 15px; font-size: 12px;">🔍 Zoom Out</button>
        <button class="btn-secondary" onclick="if(window.standingsChart){window.standingsChart.resetZoom();}" style="padding: 5px 15px; font-size: 12px;">Reset View</button>
        <button class="btn-secondary" onclick="if(window.standingsChart){window.standingsChart.pan(20, 0, 'x');}" style="padding: 5px 15px; font-size: 12px;">← Pan Left</button>
        <button class="btn-secondary" onclick="if(window.standingsChart){window.standingsChart.pan(-20, 0, 'x');}" style="padding: 5px 15px; font-size: 12px;">Pan Right →</button>
    `;
    
    // Remove existing zoom controls if any
    const existingControls = graphContainer.querySelector('.zoom-controls');
    if (existingControls) existingControls.remove();
    
    graphContainer.appendChild(zoomControls);
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
    const raceResultsEditor = document.getElementById('raceResultsEditor');
    const raceBanner = document.getElementById('raceBanner');
    
    // Get the most recently COMPLETED race (not the current "Drafting Open" one)
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const currentRace = completedRaces.length > 0 ? completedRaces[0] : null;
    
    // Check if there are already published results for this completed race
    // Use calendar race ID to find matching race results (calendar is single source of truth)
    const latestRace = currentRace ? state.races.find(r => String(r.id) === String(currentRace.id)) : null;
    const hasPublishedResults = latestRace && currentRace && String(latestRace.id) === String(currentRace.id);
    
    // Show published results with spoiler alert
    const raceResultsDisplay = document.getElementById('raceResultsDisplay');
    const raceNoResults = document.getElementById('raceNoResults');
    const raceResultsSpoiler = document.getElementById('raceResultsSpoiler');
    
    if (latestRace) {
        // Show spoiler alert, hide results initially
        if (raceResultsSpoiler) raceResultsSpoiler.style.display = 'block';
        if (raceResultsDisplay) raceResultsDisplay.style.display = 'none';
        if (raceNoResults) raceNoResults.style.display = 'none';
        
        // Store latest race for display when spoiler is clicked
        if (raceResultsSpoiler) {
            raceResultsSpoiler.dataset.raceId = latestRace.id;
        }
    } else {
        if (raceResultsSpoiler) raceResultsSpoiler.style.display = 'none';
        if (raceResultsDisplay) raceResultsDisplay.style.display = 'none';
        if (raceNoResults) raceNoResults.style.display = 'block';
    }
    
    if (isAdmin()) {
        // Show admin controls (Results button)
        if (raceAdminOnly) raceAdminOnly.style.setProperty('display', 'block', 'important');
        if (raceNonAdmin) raceNonAdmin.style.setProperty('display', 'none', 'important');
        
        // Show banner with most recently completed race
        if (raceBanner && currentRace) {
            const editBtn = hasPublishedResults ? `<button id="editRaceResultsBtn" class="btn-secondary" style="margin-left: 10px; padding: 5px 10px;">✏️ Edit Results</button>` : '';
            raceBanner.innerHTML = `<div style="display: flex; align-items: center; flex-wrap: wrap;"><strong>${currentRace.name}</strong> — ${hasPublishedResults ? 'Results Published' : 'Enter Race Results'}${editBtn}</div>`;
            
            // Add edit button listener
            setTimeout(() => {
                const editBtnEl = document.getElementById('editRaceResultsBtn');
                if (editBtnEl) {
                    editBtnEl.addEventListener('click', () => {
                        if (raceResultsEditor) {
                            raceResultsEditor.style.display = 'block';
                            // Load existing results into editor
                            if (latestRace && String(latestRace.id) === String(currentRace.id)) {
                                loadRaceResultsIntoEditor(latestRace);
                            }
                        }
                    });
                }
            }, 100);
        } else if (raceBanner) {
            raceBanner.innerHTML = '<strong>No completed race found. Please complete a race session in Calendar first.</strong>';
        }
        
        // Hide editor by default (show when Results button clicked)
        if (raceResultsEditor) raceResultsEditor.style.display = 'none';
    } else {
        // Hide admin controls for non-admins
        if (raceAdminOnly) raceAdminOnly.style.setProperty('display', 'none', 'important');
        if (raceNonAdmin) raceNonAdmin.style.setProperty('display', 'block', 'important');
    }
    
    updateAdminControls();
}

// Display race results in table format for players
function displayRaceResultsForPlayers(race) {
    const raceResultsTitle = document.getElementById('raceResultsTitle');
    const raceResultsTable = document.getElementById('raceResultsTable');
    
    if (!raceResultsTitle || !raceResultsTable) return;
    
    // Find race in calendar for date - use race ID for reliable matching
    const raceIdStr = String(race.id);
    const calRace = (state.raceCalendar || []).find(r => String(r.id) === raceIdStr);
    const raceDate = calRace ? new Date(calRace.date || calRace.deadlineDate).toLocaleDateString() : '';
    
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
    // Use race ID (not name) for reliable matching - calendar is single source of truth
    const existingRace = state.races.find(r => String(r.id) === String(currentRace.id));
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
    // Use race ID (not name) for reliable matching - calendar is single source of truth
    const raceIdStr = String(race.id);
    const raceData = state.races.find(r => String(r.id) === raceIdStr);
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
        // Find latest race by finding most recently completed race in calendar
        const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
        const latestCalendarRace = completedRaces.length > 0 ? completedRaces[0] : null;
        const latestRace = latestCalendarRace ? state.races.find(r => String(r.id) === String(latestCalendarRace.id)) : null;
        const raceIdStr = latestRace ? String(latestRace.id) : null;
        if (latestRace && raceIdStr && state.standings[raceIdStr]) {
            const raceStandings = state.standings[raceIdStr];
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
    }
}

// Add table sorting functionality
function addTableSorting() {
    const table = document.getElementById('parsedResultsTable');
    if (!table) return;
    
    const headers = table.querySelectorAll('thead th');
    headers.forEach((header, index) => {
        // Remove existing listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        
        newHeader.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            // Determine sort direction
            const isAscending = newHeader.dataset.sort === 'asc';
            newHeader.dataset.sort = isAscending ? 'desc' : 'asc';
            
            // Clear sort indicators from all headers
            headers.forEach(h => {
                h.style.backgroundColor = '';
                const text = h.textContent.replace(' ↑', '').replace(' ↓', '');
                h.textContent = text;
            });
            
            // Add sort indicator to current header
            newHeader.style.backgroundColor = 'var(--bg-tertiary)';
            const baseText = newHeader.textContent.replace(' ↑', '').replace(' ↓', '');
            newHeader.textContent = baseText + (isAscending ? ' ↓' : ' ↑');
            
            // Sort rows
            rows.sort((a, b) => {
                const aText = a.cells[index].textContent.trim();
                const bText = b.cells[index].textContent.trim();
                
                // For position column, sort numerically
                if (index === 0) {
                    const aNum = parseInt(aText);
                    const bNum = parseInt(bText);
                    return isAscending ? bNum - aNum : aNum - bNum;
                }
                
                // For other columns, sort alphabetically
                return isAscending ? bText.localeCompare(aText) : aText.localeCompare(bText);
            });
            
            // Re-append sorted rows
            rows.forEach(row => tbody.appendChild(row));
        });
    });
}

// Show My Drivers for Race In Progress
function showMyDriversForRace() {
    if (!state.currentUser) {
        alert('Please sign in first using the header dropdown.');
        return;
    }
    if (!confirm('Spoiler Alert!\n\nProceed only if you wish to know your drivers for the current race.')) {
        return;
    }
    
    // Get the most recent completed race without results
    const completedRaces = (state.raceCalendar || []).filter(r => r.status === 'completed').sort((a,b) => new Date(b.deadlineDate || b.date) - new Date(a.deadlineDate || a.date));
    const mostRecentCompleted = completedRaces.length > 0 ? completedRaces[0] : null;
    
    if (!mostRecentCompleted) {
        alert('No race in progress found.');
        return;
    }
    
    const raceIdStr = String(mostRecentCompleted.id);
    const myDriversDisplay = document.getElementById('myDriversDisplay');
    const myDriversContent = document.getElementById('myDriversContent');
    
    if (!myDriversDisplay || !myDriversContent) return;
    
    // Get Grojean pick
    const grojeanPicks = generatePicksForRace('grojean', raceIdStr);
    const myGrojeanPick = grojeanPicks.find(p => p.userId === state.currentUser);
    const grojeanDriver = myGrojeanPick ? DRIVERS.find(d => d.id === myGrojeanPick.driverId) : null;
    
    // Get Chilton pick
    const chiltonPicks = generatePicksForRace('chilton', raceIdStr);
    const myChiltonPick = chiltonPicks.find(p => p.userId === state.currentUser);
    const chiltonDriver = myChiltonPick ? DRIVERS.find(d => d.id === myChiltonPick.driverId) : null;
    
    // Get Top 5 picks
    const top5Picks = state.bonusPicks && state.bonusPicks.top5 && state.bonusPicks.top5[state.currentUser] && state.bonusPicks.top5[state.currentUser][raceIdStr] 
        ? state.bonusPicks.top5[state.currentUser][raceIdStr] 
        : [];
    const top5Drivers = top5Picks.map(driverId => DRIVERS.find(d => d.id === driverId)).filter(d => d);
    
    // Get Pole pick
    const polePick = state.bonusPicks && state.bonusPicks.pole && state.bonusPicks.pole[state.currentUser] && state.bonusPicks.pole[state.currentUser][raceIdStr]
        ? state.bonusPicks.pole[state.currentUser][raceIdStr]
        : null;
    const poleDriver = polePick ? DRIVERS.find(d => d.id === polePick) : null;
    
    // Build display
    let html = '<div style="display: flex; flex-direction: column; gap: 15px;">';
    
    html += `<div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
        <strong>First place:</strong> ${grojeanDriver ? `${grojeanDriver.name} (${grojeanDriver.team})` : 'Not picked'}
    </div>`;
    
    html += `<div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
        <strong>Last place:</strong> ${chiltonDriver ? `${chiltonDriver.name} (${chiltonDriver.team})` : 'Not picked'}
    </div>`;
    
    html += `<div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
        <strong>Top 5:</strong> ${top5Drivers.length > 0 ? top5Drivers.map((d, i) => `${i + 1}. ${d.name} (${d.team})`).join('<br>') : 'Not picked'}
    </div>`;
    
    html += `<div style="padding: 15px; background: var(--bg-tertiary); border-radius: 8px;">
        <strong>Pole:</strong> ${poleDriver ? `${poleDriver.name} (${poleDriver.team})` : 'Not picked'}
    </div>`;
    
    html += '</div>';
    
    myDriversContent.innerHTML = html;
    myDriversDisplay.style.display = 'block';
}

// Render Logs Page
function renderLogs() {
    const logsContent = document.getElementById('logsContent');
    if (!logsContent) return;
    
    if (!state.currentUser) {
        logsContent.innerHTML = '<p class="info-text">Please sign in using the header dropdown to view your race logs.</p>';
        return;
    }
    
    const user = state.users.find(u => u.id === state.currentUser);
    if (!user) {
        logsContent.innerHTML = '<p class="info-text">User not found.</p>';
        return;
    }
    
    // Get all completed races with results (sorted chronologically)
    const racesWithResults = (state.raceCalendar || [])
        .filter(race => {
            const raceIdStr = String(race.id);
            return state.races && state.races.some(r => String(r.id) === raceIdStr);
        })
        .sort((a, b) => new Date(a.date || a.deadlineDate) - new Date(b.date || b.deadlineDate));
    
    if (racesWithResults.length === 0) {
        logsContent.innerHTML = '<p class="info-text">No race results available yet. Logs will appear here after races are completed and results are posted.</p>';
        return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 20px;">';
    
    // Render each race
    racesWithResults.forEach(race => {
        const raceIdStr = String(race.id);
        const raceData = state.races.find(r => String(r.id) === raceIdStr);
        const raceStandings = state.standings[raceIdStr];
        const userStanding = raceStandings && raceStandings[state.currentUser];
        
        // Get picks for this race
        const grojeanPicks = generatePicksForRace('grojean', raceIdStr);
        const myGrojeanPick = grojeanPicks.find(p => p.userId === state.currentUser);
        const grojeanDriver = myGrojeanPick ? DRIVERS.find(d => d.id === myGrojeanPick.driverId) : null;
        
        const chiltonPicks = generatePicksForRace('chilton', raceIdStr);
        const myChiltonPick = chiltonPicks.find(p => p.userId === state.currentUser);
        const chiltonDriver = myChiltonPick ? DRIVERS.find(d => d.id === myChiltonPick.driverId) : null;
        
        const top5Picks = state.bonusPicks && state.bonusPicks.top5 && state.bonusPicks.top5[state.currentUser] && state.bonusPicks.top5[state.currentUser][raceIdStr] 
            ? state.bonusPicks.top5[state.currentUser][raceIdStr] 
            : [];
        const top5Drivers = top5Picks.map(driverId => DRIVERS.find(d => d.id === driverId)).filter(d => d);
        
        const polePick = state.bonusPicks && state.bonusPicks.pole && state.bonusPicks.pole[state.currentUser] && state.bonusPicks.pole[state.currentUser][raceIdStr]
            ? state.bonusPicks.pole[state.currentUser][raceIdStr]
            : null;
        const poleDriver = polePick ? DRIVERS.find(d => d.id === polePick) : null;
        
        const raceDate = new Date(race.date || race.deadlineDate).toLocaleDateString();
        const points = userStanding ? userStanding.total : 0;
        
        html += `<div class="log-race-card" style="padding: 20px; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--border-color);">
            <h3 style="margin-bottom: 15px; color: var(--accent-primary);">${race.name}</h3>
            <p style="margin-bottom: 15px; color: var(--text-secondary); font-size: 0.9rem;">${raceDate}</p>
            
            <div style="margin-bottom: 20px;">
                <h4 style="margin-bottom: 10px;">Your Picks:</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                    <div style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
                        <strong>First place:</strong><br>
                        ${grojeanDriver ? `${grojeanDriver.name} (${grojeanDriver.team})` : 'Not picked'}
                    </div>
                    <div style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
                        <strong>Last place:</strong><br>
                        ${chiltonDriver ? `${chiltonDriver.name} (${chiltonDriver.team})` : 'Not picked'}
                    </div>
                    <div style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
                        <strong>Top 5:</strong><br>
                        ${top5Drivers.length > 0 ? top5Drivers.map((d, i) => `${i + 1}. ${d.name}`).join('<br>') : 'Not picked'}
                    </div>
                    <div style="padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
                        <strong>Pole:</strong><br>
                        ${poleDriver ? `${poleDriver.name} (${poleDriver.team})` : 'Not picked'}
                    </div>
                </div>
            </div>
            
            <div style="padding: 15px; background: var(--bg-tertiary); border-radius: 6px; text-align: center;">
                <strong style="font-size: 1.2rem;">Points Earned: ${points}</strong>
                ${userStanding ? `
                    <div style="margin-top: 10px; font-size: 0.9rem; color: var(--text-secondary);">
                        First place: ${userStanding.grojean || 0} | 
                        Last place: ${userStanding.chilton || 0} | 
                        Pole Bonus: ${userStanding.poleBonus || 0} | 
                        Top 5 Bonus: ${userStanding.top5Bonus || 0}
                    </div>
                ` : ''}
            </div>
        </div>`;
    });
    
    html += '</div>';
    logsContent.innerHTML = html;
}

window.showRaceResults = showRaceResults;
window.isAdmin = isAdmin;
window.makeAdmin = makeAdmin;

// Make functions globally accessible
window.deleteUser = deleteUser;
window.savePolePick = savePolePick;
window.saveTop5Pick = saveTop5Pick;
window.undoAction = undoAction;
window.editRace = openRaceModal;
window.showRaceResults = showRaceResults;
window.isAdmin = isAdmin;
window.makeAdmin = makeAdmin;
window.showMyDriversForRace = showMyDriversForRace;



