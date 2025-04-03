// WebSocket connection handling
let ws;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000; // 2 seconds

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

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Setup UI components
    setupTargetUrlUpdate();
    setupClearLogs();
    setupMocksModal();
    setupGuideToggle();
    setupLogSearch();
    
    // Connect to WebSocket for real-time logs
    connectWebSocket();
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
        fetch(`/mocks/${mockId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Refresh mocks list
                fetchMocks();
            }
        })
        .catch(error => {
            console.error('Error toggling mock:', error);
        });
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