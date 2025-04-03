// WebSocket connection handling
let ws;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000; // 2 seconds

// Add a response cache to store response bodies for previously viewed logs
const responseCache = new Map();

// Add this at the top of your script.js file
const responseBodyCache = new Map();

// Add this at the top of your script.js file
const logDataStore = new Map(); // Store full log data including response bodies

// Intercept mode variables
let interceptEnabled = false;
let breakpointEnabled = false;
let interceptedRequests = [];
const breakpoints = new Map(); // store breakpoint conditions

// Add this at the top with other state variables
let mockStates = new Map(); // Store the state of mocks before intercept mode
let isInitialMockStateCapture = true; // Flag to track initial state capture

// Fetch server info and update UI
function fetchServerInfo() {
    fetch('/info')
        .then(response => response.json())
        .then(data => {
            // Update target URL
            const targetUrlInput = document.getElementById('targetUrl');
            if (targetUrlInput) {
                targetUrlInput.value = data.target;
            }
            
            // Update port display
            const portDisplay = document.getElementById('portDisplay');
            if (portDisplay) {
                portDisplay.textContent = data.port;
            }
            
            // Update start time
            const startTimeElement = document.getElementById('startTime');
            if (startTimeElement) {
                const startTime = new Date(data.proxyStartTime);
                startTimeElement.textContent = startTime.toLocaleString();
            }
            
            // Update target example
            const targetExample = document.getElementById('targetUrlExample');
            if (targetExample) {
                targetExample.textContent = `${data.target}/your-endpoint`;
            }
        })
        .catch(error => {
            console.error('Error fetching server info:', error);
        });
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        const statusBadge = document.getElementById('proxyStatus');
        if (statusBadge) {
            statusBadge.textContent = 'Connected';
            statusBadge.classList.remove('inactive');
            statusBadge.classList.add('active');
        }
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        
        // Fetch server info when connection is established
        fetchServerInfo();
        
        // Manually log the WebSocket connected message to the UI
        const logContainer = document.getElementById('logContainer');
        if (logContainer) {
            // Format timestamp
            const timestamp = new Date();
            const timeString = timestamp.toLocaleTimeString();
            
            // Create log entry for WebSocket connected
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry success';
            logEntry.innerHTML = `
                <span class="log-time">${timeString}</span>
                <span class="log-method">SYSTEM</span>
                <span class="log-url">WebSocket connected</span>
                <span class="log-status">200</span>
            `;
            
            // Insert at the top of the container
            if (logContainer.firstChild) {
                logContainer.insertBefore(logEntry, logContainer.firstChild);
            } else {
                logContainer.appendChild(logEntry);
            }
            
            // Remove placeholder if it exists
            const placeholder = logContainer.querySelector('.log-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        const statusBadge = document.getElementById('proxyStatus');
        if (statusBadge) {
            statusBadge.textContent = 'Disconnected';
            statusBadge.classList.remove('active');
            statusBadge.classList.add('inactive');
        }
        
        // Try to reconnect if we haven't exceeded max attempts
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Reconnecting... Attempt ${reconnectAttempts}`);
            setTimeout(connectWebSocket, reconnectDelay);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            // Check if this is an intercepted request
            if (data.interceptionId) {
                handleInterceptedRequest(data);
                return;
            }
            
            // Store the complete log data using a unique key
            const logKey = `${data.method}:${data.url}:${data.timestamp}`;
            logDataStore.set(logKey, data);
            
            // Add log entry to the log container
            const logContainer = document.getElementById('logContainer');
            if (logContainer) {
                // Format timestamp
                const timestamp = new Date(data.timestamp);
                const timeString = timestamp.toLocaleTimeString();
                
                // Create log entry with proper formatting
                const logEntry = document.createElement('div');
                
                // Special handling for SYSTEM messages
                if (data.method === 'SYSTEM') {
                    // Use success class for system messages to maintain green styling
                    logEntry.className = 'log-entry success';
                    logEntry.innerHTML = `
                        <span class="log-time">${timeString}</span>
                        <span class="log-method">${data.method}</span>
                        <span class="log-url">${data.url}</span>
                        <span class="log-status">${data.status || ''}</span>
                    `;
                } else {
                    // Regular request logs with inline mocked indicator
                    logEntry.className = `log-entry ${data.status >= 400 ? 'error' : 'success'}`;
                    
                    // Use unique class name to avoid style conflicts
                    const mockedText = data.mocked ? ' <span class="log-mocked-inline">MOCKED</span>' : '';
                    
                    logEntry.innerHTML = `
                        <span class="log-time">${timeString}</span>
                        <span class="log-method">${data.method}</span>
                        <span class="log-url">${data.url}${mockedText}</span>
                        <span class="log-status">${data.status}</span>
                    `;
                }
                
                // Store the log key as a data attribute for use when clicked
                logEntry.dataset.logKey = logKey;
                
                // Add click event listener to show details
                logEntry.addEventListener('click', function() {
                    // Get the stored log data using the key
                    const storedLogData = logDataStore.get(this.dataset.logKey);
                    if (storedLogData) {
                        showLogDetails(storedLogData);
                    }
                });
                
                // Insert at the top of the container for newest first
                if (logContainer.firstChild) {
                    logContainer.insertBefore(logEntry, logContainer.firstChild);
                } else {
                    logContainer.appendChild(logEntry);
                }
                
                // Remove placeholder if it exists
                const placeholder = logContainer.querySelector('.log-placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };
}

// Setup target URL update functionality
function setupTargetUrlUpdate() {
    const saveTargetButton = document.getElementById('saveTarget');
    const targetUrlInput = document.getElementById('targetUrl');
    
    if (saveTargetButton && targetUrlInput) {
        saveTargetButton.addEventListener('click', () => {
            const newTarget = targetUrlInput.value.trim();
            if (!newTarget) {
                alert('Please enter a valid target URL');
                return;
            }
            
            // Update target URL on the server
            fetch('/update-target', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ target: newTarget })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Target URL updated successfully');
                    // Refresh server info
                    fetchServerInfo();
                } else {
                    alert(`Error updating target URL: ${data.error}`);
                }
            })
            .catch(error => {
                console.error('Error updating target URL:', error);
                alert('Failed to update target URL. Check console for details.');
            });
        });
    }
}

// Handle clear logs button
function setupClearLogs() {
    const clearLogsBtn = document.getElementById('clearLogs');
    if (!clearLogsBtn) return;
    
    clearLogsBtn.addEventListener('click', () => {
        const logContainer = document.getElementById('logContainer');
        if (logContainer) {
            // Clear all logs
            logContainer.innerHTML = '<div class="log-placeholder">No logs yet...</div>';
        }
    });
}

// Setup log search functionality
function setupLogSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        const logEntries = document.querySelectorAll('.log-entry');
        
        logEntries.forEach(entry => {
            const logText = entry.textContent.toLowerCase();
            if (logText.includes(searchTerm)) {
                entry.style.display = '';
            } else {
                entry.style.display = 'none';
            }
        });
    });
}

// Setup log details modal functionality
function setupLogDetailsModal() {
    const logDetailsModal = document.getElementById('logDetailsModal');
    const closeLogDetailsBtn = document.getElementById('closeLogDetails');
    
    if (!logDetailsModal || !closeLogDetailsBtn) return;
    
    // Hide modal when close button is clicked
    closeLogDetailsBtn.addEventListener('click', () => {
        logDetailsModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === logDetailsModal) {
            logDetailsModal.style.display = 'none';
        }
    });
}

// Show log details in modal
function showLogDetails(logData) {
    const logDetailsModal = document.getElementById('logDetailsModal');
    const detailTime = document.getElementById('logDetailTime');
    const detailMethod = document.getElementById('logDetailMethod');
    const detailUrl = document.getElementById('logDetailUrl');
    const detailStatus = document.getElementById('logDetailStatus');
    const detailBody = document.getElementById('logDetailBody');
    
    if (!logDetailsModal) return;
    
    // Fill in the log details
    if (detailTime) detailTime.textContent = new Date(logData.timestamp).toLocaleString();
    if (detailMethod) detailMethod.textContent = logData.method;
    if (detailUrl) detailUrl.textContent = logData.url;
    if (detailStatus) detailStatus.textContent = logData.status;
    
    // Display response body if available
    if (detailBody) {
        if (logData.method === 'SYSTEM') {
            detailBody.textContent = 'No response body for system messages';
        } else if (logData.responseBody) {
            // Response body is already captured as text in the log
            detailBody.textContent = logData.responseBody;
        } else {
            detailBody.textContent = 'Response body not available. You may need to restart the proxy server with the updated code.';
        }
    }
    
    // Show the modal
    logDetailsModal.style.display = 'flex';
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Setup UI components
    setupTargetUrlUpdate();
    setupClearLogs();
    setupMocksModal();
    setupGuideToggle();
    setupLogSearch();
    setupLogDetailsModal();
    setupInterceptUI();
    
    // Connect to WebSocket for real-time logs
    connectWebSocket();
    setupMockToggleHandlers();
});

// Setup guide toggle functionality
function setupGuideToggle() {
    const hideGuideButton = document.getElementById('hideGuide');
    const showGuideButton = document.getElementById('showGuide');
    const usageGuide = document.querySelector('.usage-guide');
    
    if (hideGuideButton && usageGuide && showGuideButton) {
        hideGuideButton.addEventListener('click', () => {
            usageGuide.style.display = 'none';
            showGuideButton.style.display = 'block';
        });
        
        showGuideButton.addEventListener('click', () => {
            usageGuide.style.display = 'block';
            showGuideButton.style.display = 'none';
        });
    }
}

function setupMocksModal() {
    const addMockBtn = document.getElementById('addMock');
    const mockModal = document.getElementById('mockModal');
    const cancelMockBtn = document.getElementById('cancelMock');
    const saveMockBtn = document.getElementById('saveMock');
    const mockPath = document.getElementById('mockPath');
    const mockStatus = document.getElementById('mockStatus');
    const mockResponse = document.getElementById('mockResponse');
    const mockEnabled = document.getElementById('mockEnabled');
    const mockModalTitle = document.getElementById('mockModalTitle');
    
    if (!addMockBtn || !mockModal || !saveMockBtn || !cancelMockBtn) return;
    
    // Ensure the modal is hidden on page load or refresh
    mockModal.style.display = 'none';

    // Current mock being edited (if any)
    let currentEditMockId = null;
    
    // Show modal when Add Mock button is clicked
    addMockBtn.addEventListener('click', () => {
        // Reset form
        mockPath.value = '';
        mockStatus.value = '200';
        mockResponse.value = JSON.stringify({ message: 'Mocked response' }, null, 2);
        mockEnabled.checked = true;
        
        // Reset method selection
        const methodButtons = document.querySelectorAll('.method-button');
        methodButtons.forEach(btn => btn.classList.remove('active'));
        const getMethodBtn = document.querySelector('.method-button[data-method="GET"]');
        if (getMethodBtn) {
            getMethodBtn.classList.add('active');
        }
        
        // Reset query params container
        const queryParamsContainer = document.getElementById('queryParamsContainer');
        if (queryParamsContainer) {
            queryParamsContainer.innerHTML = '';
        }
        
        // Reset body match input
        const bodyMatchInput = document.getElementById('bodyMatchInput');
        if (bodyMatchInput) {
            bodyMatchInput.value = '';
        }
        
        currentEditMockId = null;
        mockModalTitle.textContent = 'Add API Mock';
        saveMockBtn.textContent = 'Add';
        
        // Show modal
        mockModal.style.display = 'flex';
    });
    
    // Hide modal when Cancel button is clicked
    cancelMockBtn.addEventListener('click', () => {
        mockModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === mockModal) {
            mockModal.style.display = 'none';
        }
    });
    
    // Method selection buttons
    document.querySelectorAll('.method-button').forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            document.querySelectorAll('.method-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Show/hide body match container based on method
            const method = button.getAttribute('data-method');
            const bodyMatchSection = document.querySelector('.body-match-section');
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                bodyMatchSection.style.display = 'block';
            } else {
                bodyMatchSection.style.display = 'none';
            }
        });
    });
    
    // Add query parameter
    document.getElementById('addQueryParam').addEventListener('click', () => {
        const container = document.getElementById('queryParamsContainer');
        const paramId = Date.now();
        const paramRow = document.createElement('div');
        paramRow.className = 'param-row';
        paramRow.innerHTML = `
            <input type="text" class="param-key" placeholder="Parameter name">
            <input type="text" class="param-value" placeholder="Parameter value">
            <button class="remove-param" data-id="${paramId}">×</button>
        `;
        container.appendChild(paramRow);
    });
    
    // Remove query parameter (using event delegation)
    document.getElementById('queryParamsContainer').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-param')) {
            e.target.closest('.param-row').remove();
        }
    });
    
    // Save mock when Save button is clicked
    saveMockBtn.addEventListener('click', () => {
        // Validate form
        if (!mockPath.value) {
            alert('Path is required');
            return;
        }
        
        let responseBody;
        try {
            responseBody = JSON.parse(mockResponse.value || '{}');
        } catch (error) {
            alert('Invalid JSON for response body');
            return;
        }
        
        // Get selected method
        const selectedMethod = document.querySelector('.method-button.active').getAttribute('data-method');
        
        // Collect query parameters
        const queryParams = [];
        document.querySelectorAll('.param-row').forEach(row => {
            const key = row.querySelector('.param-key').value.trim();
            const value = row.querySelector('.param-value').value.trim();
            if (key) {
                queryParams.push({ key, value });
            }
        });
        
        // Collect body match conditions
        let bodyMatch = null;
        if (selectedMethod === 'POST' || selectedMethod === 'PUT' || selectedMethod === 'PATCH') {
            try {
                const bodyMatchText = document.getElementById('bodyMatchInput').value.trim();
                if (bodyMatchText) {
                    bodyMatch = JSON.parse(bodyMatchText);
                }
            } catch (error) {
                alert('Invalid JSON for body match conditions');
                return;
            }
        }
        
        const mockData = {
            path: mockPath.value,
            method: selectedMethod,
            statusCode: parseInt(mockStatus.value || 200, 10),
            responseBody,
            enabled: mockEnabled.checked,
            queryParams,
            bodyMatch
        };
        
        if (currentEditMockId) {
            // Update existing mock
            fetch(`/mocks/${currentEditMockId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mockData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Hide modal
                    mockModal.style.display = 'none';
                    
                    // Refresh mocks list
                    fetchMocks();
                }
            })
            .catch(error => {
                console.error('Error updating mock:', error);
                alert('Error updating mock');
            });
        } else {
            // Add new mock
            fetch('/mocks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mockData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Hide modal
                    mockModal.style.display = 'none';
                    
                    // Refresh mocks list
                    fetchMocks();
                }
            })
            .catch(error => {
                console.error('Error adding mock:', error);
                alert('Error adding mock');
            });
        }
    });
    
    // Edit mock
    function editMock(mockId) {
        // Find mock by ID
        fetch('/mocks')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const mock = data.mocks.find(m => m.id === mockId);
                    if (mock) {
                        // Populate form with mock data
                        mockPath.value = mock.path;
                        mockStatus.value = mock.statusCode;
                        mockResponse.value = JSON.stringify(mock.responseBody, null, 2);
                        mockEnabled.checked = mock.enabled;
                        currentEditMockId = mockId;
                        mockModalTitle.textContent = 'Edit API Mock';
                        saveMockBtn.textContent = 'Update';
                        
                        // Set method button
                        document.querySelectorAll('.method-button').forEach(btn => {
                            btn.classList.remove('active');
                        });
                        const methodButton = document.querySelector(`.method-button[data-method="${mock.method || 'GET'}"]`);
                        if (methodButton) methodButton.classList.add('active');
                        
                        // Show/hide body match container based on method
                        const method = mock.method || 'GET';
                        const bodyMatchSection = document.querySelector('.body-match-section');
                        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                            bodyMatchSection.style.display = 'block';
                            
                            // Set body match if exists
                            if (mock.bodyMatch) {
                                document.getElementById('bodyMatchInput').value = 
                                    JSON.stringify(mock.bodyMatch, null, 2);
                            } else {
                                document.getElementById('bodyMatchInput').value = '';
                            }
                        } else {
                            bodyMatchSection.style.display = 'none';
                        }
                        
                        // Populate query parameters
                        const queryParamsContainer = document.getElementById('queryParamsContainer');
                        queryParamsContainer.innerHTML = '';
                        
                        if (mock.queryParams && mock.queryParams.length > 0) {
                            mock.queryParams.forEach(param => {
                                const paramId = Date.now() + Math.random();
                                const paramRow = document.createElement('div');
                                paramRow.className = 'param-row';
                                paramRow.innerHTML = `
                                    <input type="text" class="param-key" placeholder="Parameter name" value="${param.key || ''}">
                                    <input type="text" class="param-value" placeholder="Parameter value" value="${param.value || ''}">
                                    <button class="remove-param" data-id="${paramId}">×</button>
                                `;
                                queryParamsContainer.appendChild(paramRow);
                            });
                        }
                        
                        // Show modal
                        mockModal.style.display = 'flex';
                    }
                }
            })
            .catch(error => {
                console.error('Error fetching mock details:', error);
            });
    }
    
    // Toggle mock enabled state
    function toggleMock(mockId, enabled) {
        if (!interceptEnabled) {
            fetch(`/mocks/${mockId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log(`Mock ${mockId} ${enabled ? 'enabled' : 'disabled'}`);
                } else {
                    console.error('Error toggling mock:', data.error);
                    // Revert the toggle if the server update failed
                    const toggle = document.querySelector(`.mock-toggle[data-id="${mockId}"]`);
                    if (toggle) {
                        toggle.checked = !enabled;
                    }
                }
            })
            .catch(error => {
                console.error('Error toggling mock:', error);
                // Revert the toggle on error
                const toggle = document.querySelector(`.mock-toggle[data-id="${mockId}"]`);
                if (toggle) {
                    toggle.checked = !enabled;
                }
            });
        }
    }
    
    // Delete mock
    function deleteMock(mockId) {
        if (confirm('Are you sure you want to delete this mock?')) {
            fetch(`/mocks/${mockId}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Refresh mocks list
                    fetchMocks();
                }
            })
            .catch(error => {
                console.error('Error deleting mock:', error);
            });
        }
    }
    
    // Setup event delegation for mock actions
    const mocksContainer = document.getElementById('mocksContainer');
    if (mocksContainer) {
        mocksContainer.addEventListener('click', (event) => {
            const target = event.target;
            let actionButton = target;
            
            // Check if we clicked on the SVG or path inside the button
            if (target.tagName === 'svg' || target.tagName === 'path') {
                actionButton = target.closest('button');
            }
            
            // Edit button
            if (actionButton && actionButton.classList.contains('mock-action-edit')) {
                const mockId = actionButton.getAttribute('data-id');
                editMock(mockId);
            }
            
            // Delete button
            if (actionButton && actionButton.classList.contains('mock-action-delete')) {
                const mockId = actionButton.getAttribute('data-id');
                deleteMock(mockId);
            }
            
            // Toggle checkbox
            if (target.classList.contains('mock-toggle')) {
                const mockId = target.dataset.id;
                const enabled = target.checked;
                toggleMock(mockId, enabled);
            }
        });
    }
    
    // Update the mock toggle event handler
    mocksContainer.addEventListener('change', (event) => {
        if (event.target.classList.contains('mock-toggle')) {
            const mockId = event.target.dataset.id;
            const enabled = event.target.checked;
            
            if (interceptEnabled) {
                // Just update the UI state without affecting other toggles
                console.log(`Mock ${mockId} will be ${enabled ? 'enabled' : 'disabled'} when intercept mode is turned off`);
            } else {
                // Actually toggle the mock
                toggleMock(mockId, enabled);
            }
        }
    });
    
    // Initial fetch of mocks
    fetchMocks();
}

// Fetch and display mocks
function fetchMocks(retry = 0) {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second
    
    console.log(`Fetching mocks (attempt ${retry + 1})...`);
    fetch('/mocks')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                console.log(`Received ${data.mocks.length} mocks from server`);
                updateMocksUI(data.mocks);
            } else {
                console.error('Error in mocks data:', data.error || 'Unknown error');
                
                if (retry < maxRetries) {
                    console.log(`Retrying mocks fetch in ${retryDelay}ms...`);
                    setTimeout(() => fetchMocks(retry + 1), retryDelay);
                }
            }
        })
        .catch(error => {
            console.error('Error fetching mocks:', error);
            
            // If server might still be starting up, retry after a delay
            if (retry < maxRetries) {
                console.log(`Retrying mocks fetch in ${retryDelay}ms...`);
                setTimeout(() => fetchMocks(retry + 1), retryDelay);
            } else {
                // Update UI with error message after max retries
                const mocksContainer = document.getElementById('mocksContainer');
                if (mocksContainer) {
                    mocksContainer.innerHTML = `
                        <div class="mocks-error">
                            <p>Error loading mocks: ${error.message}</p>
                            <button id="retryMocks" class="button">Retry</button>
                        </div>
                    `;
                    
                    // Add event listener to retry button
                    const retryButton = document.getElementById('retryMocks');
                    if (retryButton) {
                        retryButton.addEventListener('click', () => fetchMocks(0));
                    }
                }
            }
        });
}

// Update mocks UI
function updateMocksUI(mocks) {
    const mocksContainer = document.getElementById('mocksContainer');
    if (!mocksContainer) return;
    
    if (mocks.length === 0) {
        mocksContainer.innerHTML = '<div class="mocks-placeholder">No mocks configured yet...</div>';
        return;
    }
    
    let html = '';
    
    mocks.forEach(mock => {
        html += `
            <div class="mock-item ${mock.enabled ? '' : 'disabled'}">
                <div class="mock-details">
                    <span class="mock-method">${mock.method || 'GET'}</span>
                    <span class="mock-path">${mock.path}</span>
                    <span class="mock-status">${mock.statusCode}</span>
                </div>
                <div class="mock-actions">
                    <label class="toggle-label">
                        <input type="checkbox" class="mock-toggle" data-id="${mock.id}" ${mock.enabled ? 'checked' : ''}>
                        <span class="toggle-switch"></span>
                    </label>
                    <button class="mock-action-btn mock-action-edit" data-id="${mock.id}" title="Edit Mock">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                        </svg>
                    </button>
                    <button class="mock-action-btn mock-action-delete" data-id="${mock.id}" title="Delete Mock">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    mocksContainer.innerHTML = html;
}

function setupInterceptUI() {
    const statusCard = document.querySelector('.status-card');
    const mocksCard = document.querySelector('.mocks-card');
    const logCard = document.querySelector('.log-card');
    
    if (!statusCard || !mocksCard || !logCard) return;
    
    // Create new intercept card with optimized layout
    const interceptCard = document.createElement('div');
    interceptCard.className = 'card intercept-card';
    interceptCard.innerHTML = `
        <div class="card-header compact-header">
            <h2>Intercept Requests</h2>
            <div class="intercept-controls">
                <label class="toggle-label" title="Enable/disable intercept mode">
                    <input type="checkbox" id="interceptToggle">
                    <span class="toggle-switch"></span>
                    <span>Intercept Mode</span>
                </label>
                <label class="toggle-label" title="When enabled, all matching requests will be paused">
                    <input type="checkbox" id="breakpointToggle" disabled>
                    <span class="toggle-switch"></span>
                    <span>Breakpoint</span>
                </label>
                <button id="addBreakpoint" class="button button-secondary compact-button" disabled>Add Breakpoint</button>
            </div>
        </div>
        <div class="intercept-container" id="interceptContainer">
            <div class="intercept-placeholder">Intercept mode is disabled. Enable it to intercept requests.</div>
            <div class="intercepted-requests" id="interceptedRequests" style="display: none;"></div>
            <div class="breakpoints-container" id="breakpointsContainer" style="display: none;">
                <h3 class="compact-h3">Breakpoints</h3>
                <div class="breakpoints-list" id="breakpointsList"></div>
            </div>
        </div>
    `;
    
    // Place intercept card after the mocks card
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (mocksCard.nextSibling) {
        dashboardGrid.insertBefore(interceptCard, mocksCard.nextSibling);
    } else {
        dashboardGrid.appendChild(interceptCard);
    }
    
    // Move logs card to the bottom
    dashboardGrid.removeChild(logCard);
    dashboardGrid.appendChild(logCard);
    
    // Setup event listeners
    setupInterceptControls();
}

function setupInterceptControls() {
    const interceptToggle = document.getElementById('interceptToggle');
    const breakpointToggle = document.getElementById('breakpointToggle');
    const addBreakpointBtn = document.getElementById('addBreakpoint');
    
    if (!interceptToggle || !breakpointToggle || !addBreakpointBtn) return;
    
    // Handle intercept toggle
    interceptToggle.addEventListener('change', () => {
        interceptEnabled = interceptToggle.checked;
        
        // Enable/disable breakpoint controls
        breakpointToggle.disabled = !interceptEnabled;
        addBreakpointBtn.disabled = !interceptEnabled;
        
        // Update UI
        updateInterceptUI();
        
        // Enable/disable mocks
        toggleMocksUI(!interceptEnabled);
        
        // Send request to server to update intercept mode
        fetch('/update-intercept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: interceptEnabled })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Intercept mode updated:', data);
        })
        .catch(error => {
            console.error('Error updating intercept mode:', error);
        });
    });
    
    // Handle breakpoint toggle
    breakpointToggle.addEventListener('change', () => {
        breakpointEnabled = breakpointToggle.checked;
        
        // Send request to server to update breakpoint mode
        fetch('/update-breakpoint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: breakpointEnabled })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Breakpoint mode updated:', data);
        })
        .catch(error => {
            console.error('Error updating breakpoint mode:', error);
        });
    });
    
    // Handle add breakpoint button
    addBreakpointBtn.addEventListener('click', () => {
        showBreakpointModal();
    });
}

function updateInterceptUI() {
    const interceptContainer = document.getElementById('interceptContainer');
    const interceptedRequestsContainer = document.getElementById('interceptedRequests');
    const breakpointsContainer = document.getElementById('breakpointsContainer');
    const interceptPlaceholder = document.querySelector('.intercept-placeholder');
    
    if (!interceptContainer) return;
    
    if (interceptEnabled) {
        if (interceptPlaceholder) interceptPlaceholder.style.display = 'none';
        interceptedRequestsContainer.style.display = 'block';
        breakpointsContainer.style.display = 'block';
    } else {
        if (interceptPlaceholder) interceptPlaceholder.style.display = 'block';
        interceptedRequestsContainer.style.display = 'none';
        breakpointsContainer.style.display = 'none';
    }
}

function toggleMocksUI(enabled) {
    const mocksCard = document.querySelector('.mocks-card');
    const addMockBtn = document.getElementById('addMock');
    const mocksContainer = document.getElementById('mocksContainer');
    
    if (!mocksCard) return;
    
    if (enabled) {
        // Enabling mocks (turning off intercept mode)
        mocksCard.classList.remove('disabled');
        
        // Remove mocks disabled message
        const existingMessage = document.getElementById('mocksDisabledMessage');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Restore all mock states that were changed during intercept mode
        mockStates.forEach((wasEnabled, mockId) => {
            const toggle = document.querySelector(`.mock-toggle[data-id="${mockId}"]`);
            if (toggle) {
                fetch(`/mocks/${mockId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: toggle.checked })
                }).catch(error => {
                    console.error('Error restoring mock state:', error);
                });
            }
        });
        
        // Clear stored states
        mockStates.clear();
        isInitialMockStateCapture = true;
        
    } else {
        // Disabling mocks (turning on intercept mode)
        mocksCard.classList.add('disabled');
        
        if (isInitialMockStateCapture) {
            // Capture initial states of all mocks
            document.querySelectorAll('.mock-toggle').forEach(toggle => {
                mockStates.set(toggle.dataset.id, toggle.checked);
            });
            isInitialMockStateCapture = false;
        }
        
        // Add mocks disabled message
        if (!document.getElementById('mocksDisabledMessage') && mocksContainer) {
            const disabledMessage = document.createElement('div');
            disabledMessage.id = 'mocksDisabledMessage';
            disabledMessage.className = 'mocks-disabled-message';
            disabledMessage.textContent = 'Mocks are disabled in intercept mode (UI changes will be applied when intercept mode is disabled)';
            
            if (mocksContainer.firstChild) {
                mocksContainer.insertBefore(disabledMessage, mocksContainer.firstChild);
            } else {
                mocksContainer.appendChild(disabledMessage);
            }
        }
        
        // Deactivate all mocks internally but maintain UI state
        fetch('/mocks/deactivate-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            console.log('All mocks deactivated internally:', data);
        })
        .catch(error => {
            console.error('Error deactivating mocks:', error);
        });
    }
    
    if (addMockBtn) {
        addMockBtn.disabled = !enabled;
    }
}

function showBreakpointModal() {
    // Create modal if it doesn't exist
    let breakpointModal = document.getElementById('breakpointModal');
    
    if (!breakpointModal) {
        breakpointModal = document.createElement('div');
        breakpointModal.id = 'breakpointModal';
        breakpointModal.className = 'modal';
        breakpointModal.innerHTML = `
            <div class="modal-content">
                <h3>Add Breakpoint</h3>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Direction:</label>
                        <div class="method-buttons">
                            <button class="method-button active" data-direction="request">Request</button>
                            <button class="method-button" data-direction="response">Response</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>HTTP Method:</label>
                        <div class="method-buttons">
                            <button class="method-button active" data-method="ALL">ALL</button>
                            <button class="method-button" data-method="GET">GET</button>
                            <button class="method-button" data-method="POST">POST</button>
                            <button class="method-button" data-method="PUT">PUT</button>
                            <button class="method-button" data-method="DELETE">DELETE</button>
                            <button class="method-button" data-method="PATCH">PATCH</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="breakpointUrl">URL Contains:</label>
                        <input type="text" id="breakpointUrl" class="text-input" placeholder="Optional - leave empty to match all">
                    </div>
                    <div class="form-group">
                        <label for="breakpointStatusCode">Status Code (for responses):</label>
                        <input type="text" id="breakpointStatusCode" class="text-input" placeholder="Optional - e.g. 200, 4xx, 5xx">
                    </div>
                    <div class="modal-buttons">
                        <button id="cancelBreakpoint" class="button button-secondary">Cancel</button>
                        <button id="saveBreakpoint" class="button">Add</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(breakpointModal);
        
        // Setup breakpoint modal event listeners
        setupBreakpointModalListeners();
    }
    
    // Show the modal
    breakpointModal.style.display = 'flex';
}

function setupBreakpointModalListeners() {
    const breakpointModal = document.getElementById('breakpointModal');
    const cancelBtn = document.getElementById('cancelBreakpoint');
    const saveBtn = document.getElementById('saveBreakpoint');
    
    if (!breakpointModal || !cancelBtn || !saveBtn) return;
    
    // Close modal when cancel is clicked
    cancelBtn.addEventListener('click', () => {
        breakpointModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === breakpointModal) {
            breakpointModal.style.display = 'none';
        }
    });
    
    // Method selection buttons
    document.querySelectorAll('#breakpointModal .method-button').forEach(button => {
        button.addEventListener('click', () => {
            // Find which group this button belongs to
            const parentGroup = button.closest('.form-group');
            if (!parentGroup) return;
            
            // Remove active class from all buttons in this group
            parentGroup.querySelectorAll('.method-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Add active class to clicked button
            button.classList.add('active');
        });
    });
    
    // Save breakpoint when save button is clicked
    saveBtn.addEventListener('click', () => {
        const direction = document.querySelector('#breakpointModal .method-button[data-direction].active')?.getAttribute('data-direction') || 'request';
        const method = document.querySelector('#breakpointModal .method-button[data-method].active')?.getAttribute('data-method') || 'ALL';
        const urlPattern = document.getElementById('breakpointUrl')?.value || '';
        const statusCode = document.getElementById('breakpointStatusCode')?.value || '';
        
        // Create breakpoint
        const breakpoint = {
            id: Date.now().toString(),
            direction,
            method,
            urlPattern,
            statusCode,
            enabled: true
        };
        
        // Add breakpoint
        addBreakpoint(breakpoint);
        
        // Hide modal
        breakpointModal.style.display = 'none';
    });
}

function addBreakpoint(breakpoint) {
    // Add to breakpoints map
    breakpoints.set(breakpoint.id, breakpoint);
    
    // Update UI
    updateBreakpointsList();
    
    // Send to server
    fetch('/breakpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(breakpoint)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Breakpoint added:', data);
    })
    .catch(error => {
        console.error('Error adding breakpoint:', error);
    });
}

function updateBreakpointsList() {
    const breakpointsList = document.getElementById('breakpointsList');
    if (!breakpointsList) return;
    
    if (breakpoints.size === 0) {
        breakpointsList.innerHTML = '<div class="breakpoints-placeholder">No breakpoints defined. Add a breakpoint to intercept specific requests.</div>';
        return;
    }
    
    let html = '';
    
    breakpoints.forEach(breakpoint => {
        html += `
            <div class="breakpoint-item" data-id="${breakpoint.id}">
                <div class="breakpoint-details">
                    <span class="breakpoint-direction">${breakpoint.direction.toUpperCase()}</span>
                    <span class="breakpoint-method">${breakpoint.method}</span>
                    <span class="breakpoint-url">${breakpoint.urlPattern || '(all URLs)'}</span>
                    ${breakpoint.statusCode ? `<span class="breakpoint-status">${breakpoint.statusCode}</span>` : ''}
                </div>
                <div class="breakpoint-actions">
                    <label class="toggle-label">
                        <input type="checkbox" class="breakpoint-toggle" data-id="${breakpoint.id}" ${breakpoint.enabled ? 'checked' : ''}>
                        <span class="toggle-switch"></span>
                    </label>
                    <button class="mock-action-btn breakpoint-action-delete" data-id="${breakpoint.id}" title="Delete Breakpoint">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    breakpointsList.innerHTML = html;
    
    // Add event listeners for toggle and delete
    document.querySelectorAll('.breakpoint-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            const enabled = e.target.checked;
            toggleBreakpoint(id, enabled);
        });
    });
    
    document.querySelectorAll('.breakpoint-action-delete').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.closest('button').dataset.id;
            deleteBreakpoint(id);
        });
    });
}

function toggleBreakpoint(id, enabled) {
    if (!breakpoints.has(id)) return;
    
    // Update local state
    const breakpoint = breakpoints.get(id);
    breakpoint.enabled = enabled;
    breakpoints.set(id, breakpoint);
    
    // Send to server
    fetch(`/breakpoints/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Breakpoint updated:', data);
    })
    .catch(error => {
        console.error('Error updating breakpoint:', error);
    });
}

function deleteBreakpoint(id) {
    if (!breakpoints.has(id)) return;
    
    if (confirm('Are you sure you want to delete this breakpoint?')) {
        // Remove from local state
        breakpoints.delete(id);
        
        // Update UI
        updateBreakpointsList();
        
        // Send to server
        fetch(`/breakpoints/${id}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            console.log('Breakpoint deleted:', data);
        })
        .catch(error => {
            console.error('Error deleting breakpoint:', error);
        });
    }
}

// Handle intercepted requests from WebSocket
function handleInterceptedRequest(data) {
    if (!data || !data.interceptionId) return;
    
    // Add to intercepted requests
    interceptedRequests.unshift(data);
    
    // Update UI
    updateInterceptedRequestsUI();
}

function updateInterceptedRequestsUI() {
    const container = document.getElementById('interceptedRequests');
    if (!container) return;
    
    if (interceptedRequests.length === 0) {
        container.innerHTML = '<div class="intercept-placeholder">No intercepted requests yet.</div>';
        return;
    }
    
    let html = '';
    
    interceptedRequests.forEach(req => {
        html += `
            <div class="intercepted-request" data-id="${req.interceptionId}">
                <div class="intercepted-request-info">
                    <span class="intercepted-method">${req.method}</span>
                    <span class="intercepted-url">${req.url}</span>
                    ${req.statusCode ? `<span class="intercepted-status">${req.statusCode}</span>` : ''}
                </div>
                <div class="intercepted-actions">
                    <button class="button button-small view-intercepted" data-id="${req.interceptionId}">View/Edit</button>
                    <button class="button button-primary forward-intercepted" data-id="${req.interceptionId}">Forward</button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners
    document.querySelectorAll('.view-intercepted').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            showInterceptedRequestModal(id);
        });
    });
    
    document.querySelectorAll('.forward-intercepted').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.dataset.id;
            forwardInterceptedRequest(id);
        });
    });
}

function showInterceptedRequestModal(id) {
    const request = interceptedRequests.find(req => req.interceptionId === id);
    if (!request) return;
    
    let interceptModal = document.getElementById('interceptedRequestModal');
    
    if (!interceptModal) {
        interceptModal = document.createElement('div');
        interceptModal.id = 'interceptedRequestModal';
        interceptModal.className = 'modal';
        interceptModal.innerHTML = `
            <div class="modal-content">
                <h3>Edit Intercepted ${request.responseBody ? 'Response' : 'Request'}</h3>
                <div class="modal-body">
                    <div class="form-group">
                        <label>${request.responseBody ? 'Response' : 'Request'} Details:</label>
                        <div class="intercepted-details">
                            <div class="intercepted-detail-item">
                                <span class="intercepted-detail-label">Method:</span>
                                <span id="interceptedMethod" class="intercepted-detail-value"></span>
                            </div>
                            <div class="intercepted-detail-item">
                                <span class="intercepted-detail-label">URL:</span>
                                <span id="interceptedUrl" class="intercepted-detail-value"></span>
                            </div>
                            ${request.statusCode ? `
                            <div class="intercepted-detail-item">
                                <span class="intercepted-detail-label">Status:</span>
                                <input type="text" id="interceptedStatus" class="text-input" value="${request.statusCode}">
                            </div>` : ''}
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="interceptedBody">${request.responseBody ? 'Response' : 'Request'} Body:</label>
                        <textarea id="interceptedBody" class="text-area"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Headers:</label>
                        <div id="interceptedHeaders" class="intercepted-headers">
                            <!-- Headers will be added here -->
                        </div>
                        <button id="addInterceptedHeader" class="button button-small">Add Header</button>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancelIntercept" class="button button-secondary">Cancel</button>
                        <button id="applyChanges" class="button">Apply Changes</button>
                        <button id="forwardRequest" class="button button-primary">Forward</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(interceptModal);
        
        // Setup event listeners
        setupInterceptModalListeners(id);
    }
    
    // Fill in details
    document.getElementById('interceptedMethod').textContent = request.method;
    document.getElementById('interceptedUrl').textContent = request.url;
    
    const bodyInput = document.getElementById('interceptedBody');
    
    // Format body based on content type
    if (request.responseBody) {
        let formattedBody = request.responseBody;
        
        // Try to format as JSON if possible
        try {
            const contentType = request.responseHeaders?.['content-type'] || '';
            if (contentType.includes('application/json')) {
                const jsonObj = typeof request.responseBody === 'string' ? 
                    JSON.parse(request.responseBody) : request.responseBody;
                formattedBody = JSON.stringify(jsonObj, null, 2);
            }
        } catch (e) {
            console.error('Error formatting response body:', e);
            formattedBody = request.responseBody;
        }
        
        bodyInput.value = formattedBody;
    } else if (request.requestBody) {
        bodyInput.value = typeof request.requestBody === 'string' ? 
            request.requestBody : JSON.stringify(request.requestBody, null, 2);
    } else {
        bodyInput.value = '';
    }
    
    // Fill headers
    const headersContainer = document.getElementById('interceptedHeaders');
    headersContainer.innerHTML = '';
    
    const headers = request.responseBody ? request.responseHeaders : request.requestHeaders;
    if (headers) {
        Object.entries(headers).forEach(([name, value]) => {
            addHeaderToContainer(headersContainer, name, value);
        });
    }
    
    // Show the modal
    interceptModal.style.display = 'flex';
}

function addHeaderToContainer(container, name = '', value = '') {
    const headerRow = document.createElement('div');
    headerRow.className = 'header-row';
    headerRow.innerHTML = `
        <input type="text" class="header-name text-input" value="${name}" placeholder="Header Name">
        <input type="text" class="header-value text-input" value="${value}" placeholder="Header Value">
        <button class="remove-header">×</button>
    `;
    
    container.appendChild(headerRow);
    
    // Add event listener to remove button
    headerRow.querySelector('.remove-header').addEventListener('click', () => {
        headerRow.remove();
    });
}

function setupInterceptModalListeners(requestId) {
    const modal = document.getElementById('interceptedRequestModal');
    const cancelBtn = document.getElementById('cancelIntercept');
    const applyBtn = document.getElementById('applyChanges');
    const forwardBtn = document.getElementById('forwardRequest');
    const addHeaderBtn = document.getElementById('addInterceptedHeader');
    
    if (!modal || !cancelBtn || !applyBtn || !forwardBtn || !addHeaderBtn) return;
    
    // Close modal when cancel is clicked
    cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Add header button
    addHeaderBtn.addEventListener('click', () => {
        const headersContainer = document.getElementById('interceptedHeaders');
        addHeaderToContainer(headersContainer);
    });
    
    // Apply changes button
    applyBtn.addEventListener('click', () => {
        applyInterceptedChanges(requestId);
    });
    
    // Forward button
    forwardBtn.addEventListener('click', () => {
        applyInterceptedChanges(requestId);
        forwardInterceptedRequest(requestId);
        modal.style.display = 'none';
    });
}

function applyInterceptedChanges(requestId) {
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) return;
    
    // Get updated values
    const statusInput = document.getElementById('interceptedStatus');
    const bodyInput = document.getElementById('interceptedBody');
    const headersContainer = document.getElementById('interceptedHeaders');
    
    // Update status if it exists
    if (statusInput && request.responseBody) {
        request.statusCode = parseInt(statusInput.value, 10) || request.statusCode;
    }
    
    // Update body
    if (request.responseBody) {
        request.responseBody = bodyInput.value;
    } else if (request.requestBody) {
        request.requestBody = bodyInput.value;
    }
    
    // Update headers
    const headerRows = headersContainer.querySelectorAll('.header-row');
    const headers = {};
    
    headerRows.forEach(row => {
        const nameInput = row.querySelector('.header-name');
        const valueInput = row.querySelector('.header-value');
        
        if (nameInput && valueInput && nameInput.value.trim()) {
            headers[nameInput.value.trim()] = valueInput.value;
        }
    });
    
    if (request.responseBody) {
        request.responseHeaders = headers;
    } else {
        request.requestHeaders = headers;
    }
    
    // Update in the array
    const index = interceptedRequests.findIndex(req => req.interceptionId === requestId);
    if (index !== -1) {
        interceptedRequests[index] = request;
    }
}

function forwardInterceptedRequest(requestId) {
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) return;
    
    // Send the request/response to the server to continue
    fetch(`/forward-intercepted/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    })
    .then(response => response.json())
    .then(data => {
        console.log('Request forwarded:', data);
        
        // Remove from intercepted requests array
        const index = interceptedRequests.findIndex(req => req.interceptionId === requestId);
        if (index !== -1) {
            interceptedRequests.splice(index, 1);
        }
        
        // Update UI
        updateInterceptedRequestsUI();
        
        // Hide modal if it's open
        const modal = document.getElementById('interceptedRequestModal');
        if (modal && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    })
    .catch(error => {
        console.error('Error forwarding request:', error);
    });
}

function setupMockToggleHandlers() {
    document.addEventListener('change', (event) => {
        if (event.target.classList.contains('mock-toggle')) {
            const mockId = event.target.dataset.id;
            const enabled = event.target.checked;
            
            if (interceptEnabled) {
                // Just update the UI state without affecting other toggles
                console.log(`Mock ${mockId} will be ${enabled ? 'enabled' : 'disabled'} when intercept mode is turned off`);
            } else {
                // Actually toggle the mock
                toggleMock(mockId, enabled);
            }
        }
    });
}