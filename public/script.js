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
let interceptedRequests = [];
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
    const dashboardGrid = document.querySelector('.dashboard-grid');
    
    if (!statusCard || !mocksCard || !logCard || !dashboardGrid) return;
    
    // Create intercept card if it doesn't exist
    let interceptCard = document.querySelector('.intercept-card');
    if (!interceptCard) {
        interceptCard = document.createElement('div');
        interceptCard.className = 'card intercept-card';
        interceptCard.innerHTML = `
            <div class="compact-header">
                <h2>Intercept Requests</h2>
                <div class="intercept-controls">
                    <label class="toggle-label">
                        <input type="checkbox" id="interceptToggle">
                        <span class="toggle-switch"></span>
                        <span>Intercept Mode</span>
                    </label>
                </div>
            </div>
            <div class="intercept-container" id="interceptContainer">
                <div class="intercept-placeholder">
                    Enable intercept mode to inspect and modify requests in real-time.
                </div>
                <div id="interceptedRequests" class="intercepted-requests" style="display: none;">
                    <h3 class="compact-h3">Intercepted Requests</h3>
                    <div id="interceptedRequestsList" class="intercepted-requests-list"></div>
                </div>
            </div>
        `;
    }
    
    // Insert intercept card after mocks card
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
    
    if (!interceptToggle) return;
    
    // Handle intercept toggle
    interceptToggle.addEventListener('change', () => {
        interceptEnabled = interceptToggle.checked;
        
        // Update UI
        updateInterceptUI();
        
        // Update the mocks UI visual state without disabling mocks
        updateMocksUIVisualState(interceptEnabled);
        
        // Reset intercepted requests when disabled
        if (!interceptEnabled) {
            interceptedRequests = [];
            updateInterceptedRequestsUI();
        }
        
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
}

// Only update the UI visual state without turning off mocks
function updateMocksUIVisualState(interceptEnabled) {
    const mocksCard = document.querySelector('.mocks-card');
    
    if (interceptEnabled) {
        // Intercept mode is on, show mocks as disabled
        mocksCard.classList.add('disabled');
        
        // Add or update the disabled message
        let disabledMsg = document.querySelector('.mocks-disabled-message');
        if (!disabledMsg) {
            disabledMsg = document.createElement('div');
            disabledMsg.className = 'mocks-disabled-message';
            disabledMsg.innerHTML = '<p>Mocks are disabled while intercept mode is active</p>';
            mocksCard.appendChild(disabledMsg);
        }
        
        // Disable the "Add Mock" button
        const addMockButton = document.getElementById('addMock');
        if (addMockButton) {
            addMockButton.disabled = true;
        }
        
        // Add a semi-transparent overlay to block interaction
        let clickBlocker = document.querySelector('.mocks-click-blocker');
        if (!clickBlocker) {
            clickBlocker = document.createElement('div');
            clickBlocker.className = 'mocks-click-blocker';
            mocksCard.appendChild(clickBlocker);
        }
    } else {
        // Intercept mode is off, show mocks as enabled
        mocksCard.classList.remove('disabled');
        
        // Remove the disabled message if it exists
        const disabledMsg = document.querySelector('.mocks-disabled-message');
        if (disabledMsg) {
            disabledMsg.remove();
        }
        
        // Enable the "Add Mock" button
        const addMockButton = document.getElementById('addMock');
        if (addMockButton) {
            addMockButton.disabled = false;
        }
        
        // Remove the click blocker if it exists
        const clickBlocker = document.querySelector('.mocks-click-blocker');
        if (clickBlocker) {
            clickBlocker.remove();
        }
    }
}

// Original toggleMocksUI function is kept for backward compatibility
// but modified to not actually toggle mocks
function toggleMocksUI(enabled) {
    const mocksCard = document.querySelector('.mocks-card');
    const addMockBtn = document.getElementById('addMock');
    const mocksContainer = document.getElementById('mocksContainer');
    
    if (!mocksCard) return;
    
    if (enabled) {
        // Enabling mocks
        mocksCard.classList.remove('disabled');
        
        // Remove mocks disabled message
        const existingMessage = document.getElementById('mocksDisabledMessage');
        if (existingMessage) {
            existingMessage.remove();
        }
    } else {
        // Visual indication that intercept mode is active
        mocksCard.classList.add('disabled');
        
        // Add intercept mode message (but don't actually disable mocks)
        if (!document.getElementById('mocksDisabledMessage') && mocksContainer) {
            const disabledMessage = document.createElement('div');
            disabledMessage.id = 'mocksDisabledMessage';
            disabledMessage.className = 'mocks-disabled-message';
            disabledMessage.textContent = 'Intercept mode is active. Mocks remain enabled but UI changes take effect immediately.';
            
            if (mocksContainer.firstChild) {
                mocksContainer.insertBefore(disabledMessage, mocksContainer.firstChild);
            } else {
                mocksContainer.appendChild(disabledMessage);
            }
        }
    }
    
    // Add mock button is always enabled
    if (addMockBtn) {
        addMockBtn.disabled = false;
    }
}

function updateInterceptUI() {
    const interceptContainer = document.getElementById('interceptContainer');
    const interceptedRequestsContainer = document.getElementById('interceptedRequests');
    const interceptPlaceholder = document.querySelector('.intercept-placeholder');
    
    if (!interceptContainer) return;
    
    if (interceptEnabled) {
        if (interceptPlaceholder) interceptPlaceholder.style.display = 'none';
        interceptedRequestsContainer.style.display = 'block';
    } else {
        if (interceptPlaceholder) interceptPlaceholder.style.display = 'block';
        interceptedRequestsContainer.style.display = 'none';
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
    if (!request) {
        console.error(`Intercepted request not found: ${id}`);
        return;
    }
    
    // Create modal if it doesn't exist
    let modal = document.getElementById('interceptedRequestModal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'interceptedRequestModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Intercepted Request</h3>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="interceptedMethod">Method:</label>
                        <input type="text" id="interceptedMethod" class="text-input" readonly>
                    </div>
                    <div class="form-group">
                        <label for="interceptedUrl">URL:</label>
                        <input type="text" id="interceptedUrl" class="text-input">
                    </div>
                    <div class="form-group">
                        <label for="interceptedStatus">Status Code:</label>
                        <input type="number" id="interceptedStatus" class="text-input" placeholder="200">
                    </div>
                    <div class="form-group">
                        <label>Headers:</label>
                        <button id="addInterceptedHeader" class="button button-small">Add Header</button>
                        <div id="interceptedHeaders" class="headers-container"></div>
                    </div>
                    <div class="form-group">
                        <label for="interceptedBody">Body:</label>
                        <textarea id="interceptedBody" class="text-area"></textarea>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancelIntercept" class="button button-secondary">Cancel</button>
                        <button id="applyChanges" class="button">Save</button>
                        <button id="forwardRequest" class="button">Forward</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // Fill the modal with request data
    const methodInput = document.getElementById('interceptedMethod');
    const urlInput = document.getElementById('interceptedUrl');
    const statusInput = document.getElementById('interceptedStatus');
    const bodyInput = document.getElementById('interceptedBody');
    const headersContainer = document.getElementById('interceptedHeaders');
    
    if (methodInput) methodInput.value = request.method;
    if (urlInput) urlInput.value = request.url;
    if (statusInput) statusInput.value = request.status || 200;
    
    // Parse and format body if it's JSON
    if (bodyInput) {
        try {
            if (typeof request.body === 'object' && request.body !== null) {
                bodyInput.value = JSON.stringify(request.body, null, 2);
            } else if (typeof request.body === 'string') {
                // Try to parse as JSON first
                try {
                    const parsedBody = JSON.parse(request.body);
                    bodyInput.value = JSON.stringify(parsedBody, null, 2);
                } catch {
                    // Not JSON, use as is
                    bodyInput.value = request.body || '';
                }
            } else {
                bodyInput.value = '';
            }
        } catch (error) {
            console.error('Error formatting request body:', error);
            bodyInput.value = '';
        }
    }
    
    // Add headers
    if (headersContainer) {
        headersContainer.innerHTML = '';
        
        if (request.headers) {
            for (const [name, value] of Object.entries(request.headers)) {
                // Skip internal headers
                if (name.startsWith('_')) continue;
                
                addHeaderToContainer(headersContainer, name, value);
            }
        }
    }
    
    // Setup event listeners
    setupInterceptModalListeners(id);
    
    // Show the modal
    modal.style.display = 'flex';
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
    
    if (!modal) return;
    
    // Close modal when cancel is clicked
    if (cancelBtn) {
        // Remove existing listeners
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
    
    // Close modal when clicking outside
    const closeOnOutsideClick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
    
    // Remove existing event listener
    window.removeEventListener('click', closeOnOutsideClick);
    // Add new event listener
    window.addEventListener('click', closeOnOutsideClick);
    
    // Add header button
    if (addHeaderBtn) {
        // Remove existing listeners
        const newAddHeaderBtn = addHeaderBtn.cloneNode(true);
        addHeaderBtn.parentNode.replaceChild(newAddHeaderBtn, addHeaderBtn);
        
        newAddHeaderBtn.addEventListener('click', () => {
            const headersContainer = document.getElementById('interceptedHeaders');
            addHeaderToContainer(headersContainer);
        });
    }
    
    // Apply changes button (Save)
    if (applyBtn) {
        // Remove existing listeners
        const newApplyBtn = applyBtn.cloneNode(true);
        applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
        
        newApplyBtn.addEventListener('click', () => {
            applyInterceptedChanges(requestId);
            console.log('Changes saved for request:', requestId);
            // Close the modal after saving
            modal.style.display = 'none';
            // Show a temporary success message
            const requestElement = document.querySelector(`.intercepted-request[data-id="${requestId}"]`);
            if (requestElement) {
                requestElement.classList.add('saved');
                setTimeout(() => {
                    requestElement.classList.remove('saved');
                }, 1000);
            }
        });
    }
    
    // Forward button
    if (forwardBtn) {
        // Remove existing listeners
        const newForwardBtn = forwardBtn.cloneNode(true);
        forwardBtn.parentNode.replaceChild(newForwardBtn, forwardBtn);
        
        newForwardBtn.addEventListener('click', () => {
            applyInterceptedChanges(requestId);
            forwardInterceptedRequest(requestId);
            modal.style.display = 'none';
        });
    }
}

function applyInterceptedChanges(requestId) {
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) {
        console.error('Request not found:', requestId);
        return;
    }
    
    // Get updated values
    const urlInput = document.getElementById('interceptedUrl');
    const statusInput = document.getElementById('interceptedStatus');
    const bodyInput = document.getElementById('interceptedBody');
    const headersContainer = document.getElementById('interceptedHeaders');
    
    // Update URL if changed
    if (urlInput && urlInput.value.trim() !== request.url) {
        request.url = urlInput.value.trim();
    }
    
    // Update status code
    if (statusInput) {
        const statusCode = parseInt(statusInput.value, 10);
        if (!isNaN(statusCode)) {
            request.status = statusCode;
        }
    }
    
    // Update body
    if (bodyInput) {
        try {
            // Try to parse as JSON
            const bodyValue = bodyInput.value.trim();
            try {
                // Check if it's valid JSON
                JSON.parse(bodyValue);
                // If it's valid JSON, save as string
                request.body = bodyValue;
            } catch (e) {
                // Not valid JSON, save as is
                request.body = bodyValue;
            }
        } catch (error) {
            console.error('Error updating request body:', error);
        }
    }
    
    // Update headers
    if (headersContainer) {
        const headerRows = headersContainer.querySelectorAll('.header-row');
        const headers = {...request.headers}; // Clone existing headers
        
        // Clear non-internal headers
        for (const key of Object.keys(headers)) {
            if (!key.startsWith('_')) {
                delete headers[key];
            }
        }
        
        // Add updated headers
        headerRows.forEach(row => {
            const nameInput = row.querySelector('.header-name');
            const valueInput = row.querySelector('.header-value');
            
            if (nameInput && valueInput && nameInput.value.trim()) {
                headers[nameInput.value.trim()] = valueInput.value;
            }
        });
        
        request.headers = headers;
    }
    
    // Update in the array
    const index = interceptedRequests.findIndex(req => req.interceptionId === requestId);
    if (index !== -1) {
        interceptedRequests[index] = request;
    }
    
    console.log('Updated request:', request);
}

function forwardInterceptedRequest(requestId) {
    if (!requestId) return;
    
    console.log(`Forwarding intercepted request: ${requestId}`);
    
    // Get the request from our local store
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) {
        console.error(`Request not found: ${requestId}`);
        return;
    }
    
    // Send request to server to forward the intercepted request
    fetch(`/forward-request/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request) // Send the modified request data
    })
    .then(response => response.json())
    .then(data => {
        console.log('Request forwarded:', data);
        
        // Close modal if it's open
        const modal = document.getElementById('interceptedRequestModal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Remove the request from the UI
        const requestElement = document.querySelector(`.intercepted-request[data-id="${requestId}"]`);
        if (requestElement) {
            requestElement.remove();
        }
        
        // Update the intercepted requests list
        const index = interceptedRequests.findIndex(req => req.interceptionId === requestId);
        if (index !== -1) {
            interceptedRequests.splice(index, 1);
        }
        
        // If there are no more intercepted requests, update the UI
        if (interceptedRequests.length === 0) {
            updateInterceptedRequestsUI();
        }
    })
    .catch(error => {
        console.error('Error forwarding request:', error);
        alert('Error forwarding request: ' + error.message);
    });
}

function setupMockToggleHandlers() {
    document.addEventListener('change', (event) => {
        if (event.target.classList.contains('mock-toggle')) {
            const mockId = event.target.dataset.id;
            const enabled = event.target.checked;
            
            // Always toggle the mock regardless of intercept mode
            toggleMock(mockId, enabled);
            
            // Add visual feedback when toggling during intercept mode
            if (interceptEnabled) {
                console.log(`Mock ${mockId} ${enabled ? 'enabled' : 'disabled'} during intercept mode`);
                // Flash the toggle to indicate it was successful
                const toggle = event.target;
                toggle.classList.add('toggled');
                setTimeout(() => {
                    toggle.classList.remove('toggled');
                }, 500);
            }
        }
    });
}