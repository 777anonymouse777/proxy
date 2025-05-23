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

// Global variable to store intercept rules
let interceptRules = [];

// Host address for displaying in UI examples
const HOST_ADDRESS = '0.0.0.0:3333';

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
            
            // Update API URL example to use 0.0.0.0 instead of localhost
            const apiExample = document.getElementById('apiUrlExample');
            if (apiExample) {
                apiExample.textContent = `http://${HOST_ADDRESS}/your-endpoint`;
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
            
            // Check if this is an intercepted request that hasn't been handled yet
            if ((data.interceptionId || data.type === 'intercepted-request') && !data.isForwarded) {
                console.log('Received intercepted request:', data.method, data.url, data.interceptionId);
                
                // Only handle in the intercepted requests UI but don't log yet
                handleInterceptedRequest(data);
                
                // We'll only log this when it's been forwarded
                return;
            }
            
            // Let forwarded intercepted responses through (they have both interceptionId and isForwarded)
            console.log('Processing message:', data.method, data.url, 
                        data.interceptionId ? `ID: ${data.interceptionId}` : '', 
                        data.isForwarded ? '(forwarded)' : '');
            
            // Log non-intercepted requests for debugging
            if (data.tag === 'non-intercepted') {
                console.log(`Received non-intercepted request: ${data.method} ${data.url}, status: ${data.status}`);
            }
            
            // Create a unique key for this request 
            const logKey = `${data.method}:${data.url}:${data.timestamp}`;
            
            // Store the complete log data using a unique key
            logDataStore.set(logKey, data);
            
            // Only for non-intercepted requests or responses with real status codes,
            // try to find and update an existing entry
            if (data.tag === 'non-intercepted' && data.status) {
                // Look for existing log entry with this key or similar key
                const existingLogElement = findExistingLogEntry(data);
                
                // If we found an existing log element, update it instead of creating new one
                if (existingLogElement) {
                    console.log(`Updating existing log entry for: ${data.method} ${data.url} with status: ${data.status}`);
                    
                    // Update the status in the existing log element
                    const statusElement = existingLogElement.querySelector('.log-status');
                    if (statusElement) {
                        statusElement.textContent = data.status;
                    }
                    
                    // Update the class based on status code
                    if (typeof data.status === 'number' && data.status >= 400) {
                        existingLogElement.className = 'log-entry error';
                    } else {
                        existingLogElement.className = 'log-entry success';
                    }
                    
                    // Update the log key data attribute
                    existingLogElement.dataset.logKey = logKey;
                    
                    // We've updated the existing entry, so don't create a new one
                    return;
                }
            }
            
            // Add log entry to the log container (only for new entries or entries we couldn't update)
            const logContainer = document.getElementById('logContainer');
            if (logContainer) {
                // Format timestamp
                const timestamp = new Date(data.timestamp);
                const timeString = timestamp.toLocaleTimeString();
                
                // Use the more modern renderLog function if available
                // or fallback to the original implementation
                if (typeof renderLog === 'function') {
                    // Create a log entry using the new renderer
                    const logEntry = renderLog(data);
                    
                    // Insert at the top of the container for newest first
                    if (logContainer.firstChild) {
                        logContainer.insertBefore(logEntry, logContainer.firstChild);
                    } else {
                        logContainer.appendChild(logEntry);
                    }
                } else {
                    // Create log entry with proper formatting (legacy approach)
                    const logEntry = document.createElement('div');
                    
                    // Special handling for SYSTEM messages
                    if (data.method === 'SYSTEM') {
                        // Use success class for system messages to maintain green styling
                        logEntry.className = 'log-entry success';
                        logEntry.innerHTML = `
                            <span class="log-time">${timeString}</span>
                            <span class="log-method">${data.method}</span>
                            <span class="log-url">${data.url}</span>
                        `;
                    } else {
                        // Regular request logs with inline mocked indicator
                        logEntry.className = 'log-entry';
                        
                        // Use unique class name to avoid style conflicts
                        const mockedText = data.mocked ? ' <span class="log-mocked-inline">MOCKED</span>' : '';
                        
                        logEntry.innerHTML = `
                            <span class="log-time">${timeString}</span>
                            <span class="log-method">${data.method}</span>
                            <span class="log-url">${data.url}${mockedText}</span>
                        `;
                    }
                    
                    // Store the log key as a data attribute for use when clicked
                    logEntry.dataset.logKey = logKey;
                    
                    // Add click event listener to show details
                    logEntry.addEventListener('click', function() {
                        // Get the stored log data using the key
                        const storedLogData = logDataStore.get(this.dataset.logKey);
                        if (storedLogData) {
                            // Use new handler if available, otherwise fall back to old one
                            if (typeof handleLogClick === 'function') {
                                handleLogClick(storedLogData);
                            } else {
                                showLogDetails(storedLogData);
                            }
                        }
                    });
                    
                    // Insert at the top of the container for newest first
                    if (logContainer.firstChild) {
                        logContainer.insertBefore(logEntry, logContainer.firstChild);
                    } else {
                        logContainer.appendChild(logEntry);
                    }
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

// Helper function to find existing log entry for a request
function findExistingLogEntry(data) {
    // Don't try to update entries for system messages or intercepted requests
    if (data.method === 'SYSTEM' || 
        data.interceptionId || 
        data.type === 'intercepted-request') {
        return null;
    }
    
    // Check for a valid status - we only want to update entries when we have a numeric status code
    if (typeof data.status !== 'number') {
        return null;
    }
    
    console.log(`Looking for existing entry to update for: ${data.method} ${data.url}, status: ${data.status}`);
    
    // Get all log entries
    const logEntries = document.querySelectorAll('.log-entry');
    
    // Try to match by URL parts to handle non-intercepted requests more reliably
    for (const entry of logEntries) {
        const methodEl = entry.querySelector('.log-method');
        const urlEl = entry.querySelector('.log-url');
        const statusEl = entry.querySelector('.log-status');
        
        if (!methodEl || !urlEl || !statusEl) continue;
        
        const methodText = methodEl.textContent.trim();
        // Strip any tags from URL text to compare just the URL part
        const urlText = urlEl.textContent.replace(/<[^>]*>/g, '').trim();
        const statusText = statusEl.textContent.trim();
        
        // If method matches and URL contains our target URL 
        // and status is "Processing" or "Pending", this is likely our entry
        if (methodText === data.method && urlText.includes(data.url)) {
            // Check if status indicates this is a pending entry
            if (statusText === 'Processing' || statusText === 'Pending' || statusText === '') {
                console.log(`Found matching entry to update: ${methodText} ${urlText} with status: ${statusText}`);
                return entry;
            }
        }
    }
    
    console.log('No pending entry found to update');
    return null;
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
    document.getElementById('clearLogs').addEventListener('click', () => {
        document.getElementById('logContainer').innerHTML = '<div class="log-placeholder">No logs yet...</div>';
    });
}

// Setup log search functionality
function setupLogSearch() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const logEntries = document.querySelectorAll('.log-entry');
        
        logEntries.forEach(entry => {
            const text = entry.textContent.toLowerCase();
            entry.style.display = text.includes(searchTerm) ? 'flex' : 'none';
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
    console.log('Showing log details for:', logData);
    
    // Create modal if it doesn't exist yet
    let modal = document.getElementById('logDetailsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'logDetailsModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    // Determine if this log has a response body (for any HTTP method, not just GET)
    const hasResponseBody = logData.responseBody && logData.responseBody.length > 0;
    let formattedResponseBody = '';
    
    if (hasResponseBody) {
        // Format the response body based on content type
        const contentType = logData.contentType || '';
        
        if (contentType.includes('application/json')) {
            try {
                // Try to parse and re-format JSON if it's not already formatted
                if (typeof logData.responseBody === 'string' && !logData.responseBody.includes('\n')) {
                    const jsonObj = JSON.parse(logData.responseBody);
                    formattedResponseBody = JSON.stringify(jsonObj, null, 2);
                } else {
                    formattedResponseBody = logData.responseBody;
                }
            } catch (e) {
                console.error('Error formatting JSON response body:', e);
                formattedResponseBody = logData.responseBody;
            }
        } else {
            // For non-JSON responses, just use the string as is
            formattedResponseBody = logData.responseBody;
        }
    }
    
    const responseBodyContent = hasResponseBody 
        ? `<div class="log-detail-item">
            <div class="log-detail-label">Response Body:</div>
            <pre class="log-detail-body">${formattedResponseBody}</pre>
           </div>`
        : '';
    
    // Determine if this log has request body
    const hasRequestBody = logData.requestBody && 
        (typeof logData.requestBody === 'object' ? 
            Object.keys(logData.requestBody).length > 0 : 
            logData.requestBody.length > 0);
    
    const requestBodyContent = hasRequestBody
        ? `<div class="log-detail-item">
            <div class="log-detail-label">Request Body:</div>
            <pre class="log-detail-body">${
                typeof logData.requestBody === 'object' 
                    ? JSON.stringify(logData.requestBody, null, 2) 
                    : logData.requestBody
            }</pre>
           </div>`
        : '';
    
    // Format response headers if they exist
    const responseHeaders = logData.responseHeaders ? Object.entries(logData.responseHeaders)
        .map(([key, value]) => `<div><strong>${key}:</strong> ${value}</div>`)
        .join('') : '';
    
    const responseHeadersContent = responseHeaders 
        ? `<div class="log-detail-item">
            <div class="log-detail-label">Response Headers:</div>
            <div class="log-detail-headers">${responseHeaders}</div>
           </div>`
        : '';
    
    // Create modal content with basic request details and any bodies
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Request Details</h3>
            <div class="log-details">
                <div class="log-detail-item">
                    <div class="log-detail-label">Method:</div>
                    <div class="log-detail-value">${logData.method}</div>
                </div>
                <div class="log-detail-item">
                    <div class="log-detail-label">URL:</div>
                    <div class="log-detail-value">${logData.url}</div>
                </div>
                <div class="log-detail-item">
                    <div class="log-detail-label">Status:</div>
                    <div class="log-detail-value">${logData.status || 'Pending'}</div>
                </div>
                <div class="log-detail-item">
                    <div class="log-detail-label">Time:</div>
                    <div class="log-detail-value">${new Date(logData.timestamp).toLocaleString()}</div>
                </div>
                ${logData.contentType ? `
                <div class="log-detail-item">
                    <div class="log-detail-label">Content Type:</div>
                    <div class="log-detail-value">${logData.contentType}</div>
                </div>
                ` : ''}
                ${requestBodyContent}
                ${responseHeadersContent}
                ${responseBodyContent}
            </div>
            <div class="modal-buttons">
                <button id="closeLogDetails" class="button">Close</button>
            </div>
        </div>
    `;
    
    // Show the modal
    modal.style.display = 'flex';
    
    // Add event listener to close button
    document.getElementById('closeLogDetails').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Close modal when clicking outside the content
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize WebSocket connection
    connectWebSocket();
    
    // Fetch server info
    fetchServerInfo();
    
    // Setup target URL update
    setupTargetUrlUpdate();
    
    // Setup clear logs button
    setupClearLogs();
    
    // Setup log search
    setupLogSearch();
    
    // Setup log details modal
    setupLogDetailsModal();
    
    // Setup guide toggle
    setupGuideToggle();
    
    // Setup mocks modal
    setupMocksModal();
    
    // Fetch mocks
    fetchMocks();
    
    // Setup intercept UI
    setupInterceptUI();
    
    // Setup mock toggle handlers
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
    const interceptCard = document.querySelector('.intercept-card');
    if (!interceptCard) return;
    
    // Create a header similar to mocks UI
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    cardHeader.innerHTML = `
        <h2>Intercept Requests</h2>
        <div>
            <button id="addInterceptRule" class="button button-secondary">Add Rule</button>
            <div class="toggle-container" style="display: inline-block; margin-left: 10px;">
                <label class="toggle-label">
                    <input type="checkbox" id="interceptToggle">
                    <span class="toggle-switch"></span>
                    Intercept Mode
                </label>
            </div>
        </div>
    `;
    
    // Create "Intercept All" toggle
    const interceptAllContainer = document.createElement('div');
    interceptAllContainer.className = 'intercept-all-container';
    interceptAllContainer.innerHTML = `
        <div class="intercept-all-header">
            <div class="toggle-container">
                <label class="toggle-label">
                    <input type="checkbox" id="interceptAllToggle">
                    <span class="toggle-switch"></span>
                    <strong>Intercept All Requests</strong>
                </label>
            </div>
            <p class="intercept-help">When enabled, all requests will be intercepted regardless of rules below.</p>
        </div>
    `;
    
    // Create rules container similar to mocks container
    const rulesContainer = document.createElement('div');
    rulesContainer.id = 'interceptRulesContainer';
    rulesContainer.className = 'mocks-container';
    rulesContainer.innerHTML = '<div class="intercept-placeholder">No intercept rules yet. All requests will be intercepted when Intercept Mode is on and Intercept All is enabled.</div>';
    
    // Create intercepted requests section
    const requestsSection = document.createElement('div');
    requestsSection.className = 'intercepted-requests';
    requestsSection.innerHTML = `
        <h3>Intercepted Requests</h3>
        <div id="interceptedRequests" class="intercepted-requests-list"></div>
    `;
    
    // Add sections to the card
    interceptCard.innerHTML = '';
    interceptCard.appendChild(cardHeader);
    interceptCard.appendChild(interceptAllContainer);
    interceptCard.appendChild(rulesContainer);
    interceptCard.appendChild(requestsSection);
    
    // Set up event listeners
    document.getElementById('interceptToggle').addEventListener('change', (e) => {
        const enabled = e.target.checked;
        toggleInterceptMode(enabled);
    });
    
    document.getElementById('interceptAllToggle').addEventListener('change', (e) => {
        const enabled = e.target.checked;
        fetch('/update-intercept-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('Intercept all mode updated:', enabled);
                updateInterceptUI();
                // Display a message to the user
                const message = enabled 
                    ? 'All requests will be intercepted regardless of rules'
                    : 'Only requests matching rules will be intercepted';
                console.log(message);
            } else {
                console.error('Failed to update intercept all mode:', data.error);
                // Revert the toggle
                document.getElementById('interceptAllToggle').checked = !enabled;
            }
        })
        .catch(error => {
            console.error('Error updating intercept all mode:', error);
            // Revert the toggle
            document.getElementById('interceptAllToggle').checked = !enabled;
        });
    });
    
    // Setup add rule button
    setupAddInterceptRule();
    
    // Check current intercept status
    checkInterceptStatus();
    
    // Fetch initial intercept rules
    fetchInterceptRules();
}

// Update the UI to display intercept rules
function updateInterceptRulesUI() {
    const container = document.getElementById('interceptRulesContainer');
    if (!container) return;
    
    if (interceptRules.length === 0) {
        // Check if "intercept all" is enabled
        const interceptAllToggle = document.getElementById('interceptAllToggle');
        const interceptAllEnabled = interceptAllToggle ? interceptAllToggle.checked : false;
        
        if (interceptAllEnabled) {
            container.innerHTML = `
                <div class="intercept-placeholder">
                    <p><strong>Intercept Mode:</strong> "Intercept All Requests" is enabled. All requests will be intercepted.</p>
                    <p>Add specific rules below if you want to intercept only certain requests.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="intercept-placeholder">
                    <p><strong>Intercept Mode:</strong> No rules are defined and "Intercept All" is disabled.</p>
                    <p>No requests will be intercepted. Add rules below or enable "Intercept All".</p>
                </div>
            `;
        }
        
        return;
    }
    
    let html = '';
    
    interceptRules.forEach(rule => {
        html += `
            <div class="mock-item" data-id="${rule.id}">
                <div class="mock-details">
                    <div class="mock-method ${rule.method === 'ALL' ? 'method-all' : ''}">${rule.method}</div>
                    <div class="mock-path">${rule.path}</div>
                </div>
                <div class="mock-actions">
                    <label class="toggle-label">
                        <input type="checkbox" class="rule-toggle" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                        <span class="toggle-switch"></span>
                    </label>
                    <button class="mock-action-btn mock-action-delete rule-delete" data-id="${rule.id}" title="Delete Rule">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners for rule toggles
    document.querySelectorAll('.rule-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            const enabled = e.target.checked;
            updateInterceptRule(id, { enabled });
        });
    });
    
    // Add event listeners for delete buttons
    document.querySelectorAll('.rule-delete').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.closest('.rule-delete').dataset.id;
            if (confirm('Are you sure you want to delete this intercept rule?')) {
                deleteInterceptRule(id);
            }
        });
    });
}

// Set up UI for adding new intercept rules
function setupAddInterceptRule() {
    const addRuleButton = document.getElementById('addInterceptRule');
    if (!addRuleButton) return;
    
    addRuleButton.addEventListener('click', () => {
        // Show the mock modal but adapt it for intercept rules
        const mockModal = document.getElementById('mockModal');
        const mockModalTitle = document.getElementById('mockModalTitle');
        const saveMockBtn = document.getElementById('saveMock');
        
        if (!mockModal || !mockModalTitle || !saveMockBtn) {
            // Use simple prompt as fallback
            const method = prompt('HTTP Method (GET, POST, etc. or ALL for any method):');
            const path = prompt('Path to intercept (e.g., /api/users or /api/*):');
            
            if (method && path) {
                addInterceptRule({
                    method,
                    path,
                    enabled: true
                });
            }
            return;
        }
        
        // Reset form and prepare for intercept rule
        const mockPath = document.getElementById('mockPath');
        if (mockPath) mockPath.value = '';
        
        // Reset method selection
        const methodButtons = document.querySelectorAll('.method-button');
        methodButtons.forEach(btn => btn.classList.remove('active'));
        const getMethodBtn = document.querySelector('.method-button[data-method="GET"]');
        if (getMethodBtn) {
            getMethodBtn.classList.add('active');
        }
        
        // Add ALL method button if it doesn't exist
        const methodContainer = document.querySelector('.method-buttons');
        if (methodContainer && !document.querySelector('.method-button[data-method="ALL"]')) {
            const allButton = document.createElement('button');
            allButton.className = 'method-button';
            allButton.setAttribute('data-method', 'ALL');
            allButton.textContent = 'ALL';
            
            // Add event listener
            allButton.addEventListener('click', (e) => {
                e.preventDefault();
                methodButtons.forEach(btn => btn.classList.remove('active'));
                allButton.classList.add('active');
            });
            
            // Add to container before the first method button
            methodContainer.insertBefore(allButton, methodContainer.firstChild);
        }
        
        // Set modal title and button text
        mockModalTitle.textContent = 'Add Intercept Rule';
        saveMockBtn.textContent = 'Add Rule';
        
        // Hide mock-specific elements
        const statusElement = document.getElementById('mockStatus');
        const responseElement = document.getElementById('mockResponse');
        const bodyMatchSection = document.querySelector('.body-match-section');
        const queryParamSection = document.querySelector('#queryParamsContainer').parentElement;
        
        if (statusElement) statusElement.parentElement.style.display = 'none';
        if (responseElement) responseElement.parentElement.style.display = 'none';
        if (bodyMatchSection) bodyMatchSection.style.display = 'none';
        if (queryParamSection) queryParamSection.style.display = 'none';
        
        // Store the original save handler
        const originalSaveHandler = saveMockBtn.onclick;
        
        // Override the save button handler
        saveMockBtn.onclick = () => {
            const method = document.querySelector('.method-button.active').getAttribute('data-method');
            const path = mockPath.value;
            
            if (!path) {
                alert('Path is required');
                return;
            }
            
            // Add intercept rule
            addInterceptRule({
                method,
                path,
                enabled: true
            });
            
            // Hide modal
            mockModal.style.display = 'none';
            
            // Restore original elements' visibility
            if (statusElement) statusElement.parentElement.style.display = 'block';
            if (responseElement) responseElement.parentElement.style.display = 'block';
            if (queryParamSection) queryParamSection.style.display = 'block';
            
            // Restore original save handler
            saveMockBtn.onclick = originalSaveHandler;
        };
        
        // Show modal
        mockModal.style.display = 'flex';
    });
}

// Check intercept status from the server
function checkInterceptStatus() {
    fetch('/intercept-status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                interceptEnabled = data.interceptEnabled;
                console.log('Intercept status from server:', interceptEnabled);
                console.log('Intercept all setting from server:', data.interceptAllRequests);
                
                // Update UI based on current status
                const interceptToggle = document.getElementById('interceptToggle');
                if (interceptToggle) {
                    interceptToggle.checked = interceptEnabled;
                }
                
                // Update interceptAllToggle based on server setting
                const interceptAllToggle = document.getElementById('interceptAllToggle');
                if (interceptAllToggle && data.interceptAllRequests !== undefined) {
                    interceptAllToggle.checked = data.interceptAllRequests;
                }
                
                // Fetch any pending intercepted requests if intercept mode is enabled
                if (interceptEnabled) {
                    fetchInterceptedRequests();
                }
                
                updateInterceptUI();
            } else {
                console.error('Failed to get intercept status:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching intercept status:', error);
        });
}

// Fetch the current intercepted requests from the server
function fetchInterceptedRequests() {
    console.log('Fetching intercepted requests from server');
    fetch('/intercepted-requests')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                interceptedRequests = data.requests || [];
                console.log('Received intercepted requests:', interceptedRequests.length);
                updateInterceptedRequestsUI();
            } else {
                console.error('Failed to fetch intercepted requests:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching intercepted requests:', error);
        });
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
            disabledMsg.innerHTML = '<p><i class="fas fa-exclamation-triangle"></i> Mocks are disabled while intercept mode is active. Please turn off intercept mode to use mocks.</p>';
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
    console.log('Updating intercept UI, intercept enabled:', interceptEnabled);
    
    // Check intercept all toggle
    const interceptAllToggle = document.getElementById('interceptAllToggle');
    const interceptAllEnabled = interceptAllToggle ? interceptAllToggle.checked : false;
    console.log('Intercept all setting:', interceptAllEnabled);
    
    // Update the toggle state
    const interceptToggle = document.getElementById('interceptToggle');
    if (interceptToggle) {
        interceptToggle.checked = interceptEnabled;
    }
    
    // Update the intercepted requests area visibility
    const interceptedRequestsArea = document.querySelector('.intercepted-requests');
    if (interceptedRequestsArea) {
        interceptedRequestsArea.style.display = interceptEnabled ? 'block' : 'none';
    }
    
    // Update the intercept card style
    const interceptCard = document.querySelector('.intercept-card');
    if (interceptCard) {
        if (interceptEnabled) {
            interceptCard.classList.add('active');
        } else {
            interceptCard.classList.remove('active');
        }
    }
    
    // Update the intercept rules container
    updateInterceptRulesUI();
    
    // Update the intercepted requests list
    if (interceptEnabled) {
        updateInterceptedRequestsUI();
    }
}

// Handle intercepted requests from WebSocket
function handleInterceptedRequest(data) {
    if (!data || !data.interceptionId) {
        console.error('Invalid intercepted request data:', data);
        return;
    }
    
    console.log('Adding request to intercepted list:', data.method, data.url, data.interceptionId);
    
    // Check if this request is already in the list
    const existingIndex = interceptedRequests.findIndex(req => req.interceptionId === data.interceptionId);
    
    if (existingIndex >= 0) {
        // Update existing request
        interceptedRequests[existingIndex] = data;
    } else {
        // Add to intercepted requests
        interceptedRequests.unshift(data);
    }
    
    // Update UI if intercept mode is enabled
    if (interceptEnabled) {
        updateInterceptedRequestsUI();
    }
}

function updateInterceptedRequestsUI() {
    const container = document.getElementById('interceptedRequests');
    if (!container) return;
    
    console.log('Updating intercepted requests UI, count:', interceptedRequests.length);
    
    if (interceptedRequests.length === 0) {
        container.innerHTML = '<div class="intercept-placeholder">No intercepted requests yet. Send requests to your API to see them here.</div>';
        return;
    }
    
    let html = '';
    
    interceptedRequests.forEach(req => {
        html += `
            <div class="mock-item intercepted-request" data-id="${req.interceptionId}">
                <div class="mock-details">
                    <div class="mock-method">${req.method}</div>
                    <div class="mock-path">${req.url}</div>
                    ${req.statusCode ? `<div class="mock-status">${req.statusCode}</div>` : ''}
                </div>
                <div class="mock-actions">
                    <button class="mock-action-btn mock-action-edit view-intercepted" data-id="${req.interceptionId}" title="Override">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                        </svg>
                        Override
                    </button>
                    <button class="mock-action-btn forward-intercepted" data-id="${req.interceptionId}" title="Forward">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path fill-rule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/>
                        </svg>
                    </button>
                    <button class="mock-action-btn drop-intercepted" data-id="${req.interceptionId}" title="Drop">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners
    document.querySelectorAll('.view-intercepted').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.closest('.view-intercepted').dataset.id;
            showInterceptedRequestModal(id);
        });
    });
    
    document.querySelectorAll('.forward-intercepted').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.closest('.forward-intercepted').dataset.id;
            forwardInterceptedRequest(id);
        });
    });
    
    document.querySelectorAll('.drop-intercepted').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = e.target.closest('.drop-intercepted').dataset.id;
            dropInterceptedRequest(id);
        });
    });
}

function showInterceptedRequestModal(id) {
    // Find the request in our intercepted requests array
    const request = interceptedRequests.find(req => req.interceptionId === id);
    if (!request) return;

    // Create modal if it doesn't exist
    let modal = document.getElementById('interceptModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'interceptModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    // Show loading state
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Override Response</h3>
            <div class="modal-body">
                <div style="text-align: center; padding: 20px;">
                    <div class="spinner"></div>
                    <p>Loading response data...</p>
                </div>
            </div>
        </div>
    `;
    
    // Show the modal immediately with loading state
    modal.classList.add('active');

    // Fetch response data to populate the override tab
    fetch(`/preview-response/${id}`)
        .then(response => response.json())
        .then(data => {
            console.log('Response data:', data);
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch response data');
            }
            
            const preview = data.preview;
            
            // Populate the modal content with preview data
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Override Response</h3>
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Method:</label>
                            <span class="intercepted-method">${request.method}</span>
                        </div>
                        <div class="form-group">
                            <label>URL:</label>
                            <span class="intercepted-url">${request.url}</span>
                        </div>
                        
                        <div class="form-group">
                            <label for="customStatusCode">Status Code:</label>
                            <input type="number" id="customStatusCode" class="text-input" value="${preview.status || 200}" />
                        </div>
                        
                        <h4>Custom Response Headers</h4>
                        <div id="responseHeadersContainer">
                            ${Object.entries(preview.headers || {}).slice(0, 5).map(([name, value]) => 
                                `<div class="header-row">
                                    <input type="text" class="header-name" value="${name}" />
                                    <input type="text" class="header-value" value="${value}" />
                                    <button class="remove-header">×</button>
                                </div>`
                            ).join('')}
                        </div>
                        <button id="addResponseHeader" class="button button-small">Add Header</button>
                        
                        <h4>Custom Response Body</h4>
                        <textarea id="customResponseBody" class="text-area">${preview.body || ''}</textarea>
                        
                        <div class="modal-buttons">
                            <button id="closeInterceptModal" class="button button-secondary">Cancel</button>
                            <button id="dropRequestBtn" class="button button-secondary" style="background-color: #d9534f;">Drop</button>
                            <button id="forwardWithChanges" class="button" title="Forward the request with or without your changes">Forward Response</button>
                        </div>
                    </div>
                </div>
            `;

            // Set up event listeners for the modal
            setupInterceptModalListeners(id);
            
            // Set up response headers container
            document.getElementById('addResponseHeader').addEventListener('click', () => {
                addHeaderToContainer(document.getElementById('responseHeadersContainer'));
            });
            
            // Drop request button
            document.getElementById('dropRequestBtn').addEventListener('click', () => {
                dropInterceptedRequest(id);
                document.getElementById('interceptModal').classList.remove('active');
            });
        })
        .catch(error => {
            console.error('Error fetching response preview:', error);
            
            // Show error state in modal
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>Override Response</h3>
                    <div class="modal-body">
                        <div class="alert alert-error">
                            Failed to fetch response data: ${error.message}
                        </div>
                        
                        <div class="form-group">
                            <label>Method:</label>
                            <span class="intercepted-method">${request.method}</span>
                        </div>
                        <div class="form-group">
                            <label>URL:</label>
                            <span class="intercepted-url">${request.url}</span>
                        </div>
                        
                        <div class="form-group">
                            <label for="customStatusCode">Status Code:</label>
                            <input type="number" id="customStatusCode" class="text-input" value="200" />
                        </div>
                        
                        <h4>Custom Response Headers</h4>
                        <div id="responseHeadersContainer">
                            <!-- Default headers in case of error -->
                            <div class="header-row">
                                <input type="text" class="header-name" value="Content-Type" />
                                <input type="text" class="header-value" value="application/json" />
                                <button class="remove-header">×</button>
                            </div>
                        </div>
                        <button id="addResponseHeader" class="button button-small">Add Header</button>
                        
                        <h4>Custom Response Body</h4>
                        <textarea id="customResponseBody" class="text-area" placeholder='{"message": "Custom response"}'></textarea>
                        
                        <div class="modal-buttons">
                            <button id="closeInterceptModal" class="button button-secondary">Cancel</button>
                            <button id="dropRequestBtn" class="button button-secondary" style="background-color: #d9534f;">Drop</button>
                            <button id="forwardWithChanges" class="button" title="Forward the request with or without your changes">Forward Response</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Set up event listeners for the error state
            setupInterceptModalListeners(id);
            
            // Set up response headers container
            document.getElementById('addResponseHeader').addEventListener('click', () => {
                addHeaderToContainer(document.getElementById('responseHeadersContainer'));
            });
            
            // Drop request button
            document.getElementById('dropRequestBtn').addEventListener('click', () => {
                dropInterceptedRequest(id);
                document.getElementById('interceptModal').classList.remove('active');
            });
        });
}

function setupTabs() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked tab
            button.classList.add('active');
            const tabId = button.dataset.tab;
            document.getElementById(tabId).classList.add('active');
        });
    });
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
    // Close the modal when the close button is clicked
    document.getElementById('closeInterceptModal').addEventListener('click', () => {
        document.getElementById('interceptModal').classList.remove('active');
    });
    
    // Close when clicking outside the modal content
    const closeOnOutsideClick = (event) => {
        const modal = document.getElementById('interceptModal');
        if (event.target === modal) {
            modal.classList.remove('active');
        }
    };
    
    window.addEventListener('click', closeOnOutsideClick);
    
    // Add response header button
    document.getElementById('addResponseHeader').addEventListener('click', () => {
        addHeaderToContainer(document.getElementById('responseHeadersContainer'));
    });
    
    // Forward response button - works whether changes were made or not
    document.getElementById('forwardWithChanges').addEventListener('click', () => {
        applyInterceptedChanges(requestId);
        forwardInterceptedRequest(requestId);
    });
    
    // Drop request button
    document.getElementById('dropRequestBtn').addEventListener('click', () => {
        dropInterceptedRequest(requestId);
    });
}

function applyInterceptedChanges(requestId) {
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) {
        console.error('Request not found:', requestId);
        return;
    }
    
    // Get status code
    const statusCodeInput = document.getElementById('customStatusCode');
    const statusCode = statusCodeInput ? parseInt(statusCodeInput.value, 10) : 200;
    
    // Get response body
    const responseBodyInput = document.getElementById('customResponseBody');
    const responseBody = responseBodyInput ? responseBodyInput.value.trim() : '';
    
    // Get response headers
    const responseHeadersContainer = document.getElementById('responseHeadersContainer');
    const responseHeaders = {};
    
    if (responseHeadersContainer) {
        const headerRows = responseHeadersContainer.querySelectorAll('.header-row');
        headerRows.forEach(row => {
            const nameInput = row.querySelector('.header-name');
            const valueInput = row.querySelector('.header-value');
            
            if (nameInput && valueInput && nameInput.value.trim()) {
                responseHeaders[nameInput.value.trim()] = valueInput.value;
            }
        });
    }
    
    // Create custom response object
    const customResponse = {
        statusCode: statusCode,
        body: responseBody,
        headers: responseHeaders
    };
    
    // Store custom response in the request object
    request.customResponse = customResponse;
    
    console.log('Applied intercepted changes:', {
        requestId,
        customResponse
    });
    
    // Update the request in the interceptedRequests array
    const index = interceptedRequests.findIndex(req => req.interceptionId === requestId);
    if (index !== -1) {
        interceptedRequests[index] = request;
    }
}

function forwardInterceptedRequest(requestId) {
    // Find the request in our local array
    const request = interceptedRequests.find(req => req.interceptionId === requestId);
    if (!request) {
        console.error('Request not found:', requestId);
        return;
    }
    
    // Mark the request as forwarded so it will be logged
    request.isForwarded = true;
    
    // Close the modal if it's open
    const modal = document.getElementById('interceptModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Determine if we should use custom response
    let customResponseData = null;
    let isCustomized = false;
    
    // Use custom response if it was defined in the request object
    if (request.customResponse) {
        console.log('Using custom response:', request.customResponse);
        customResponseData = request.customResponse;
        isCustomized = true;
        
        // If response body is a string but looks like JSON, try to parse it
        if (typeof customResponseData.body === 'string' && 
            customResponseData.body.trim().startsWith('{') && 
            customResponseData.body.trim().endsWith('}')) {
            try {
                customResponseData.body = JSON.parse(customResponseData.body);
                console.log('Parsed response body as JSON');
            } catch (e) {
                console.log('Failed to parse response body as JSON, using as string');
            }
        }
        
        // Make sure Content-Type is set for JSON responses
        if (typeof customResponseData.body === 'object' && 
            (!customResponseData.headers || !customResponseData.headers['Content-Type'])) {
            customResponseData.headers = {
                ...customResponseData.headers,
                'Content-Type': 'application/json'
            };
        }
    }
    
    console.log(`Forwarding request with ID: ${requestId}, customized: ${isCustomized}`);
    
    // Make the request to forward the intercepted request
    fetch(`/forward-intercepted-request/${requestId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            customResponse: customResponseData,
            isForwarded: true,
            shouldLog: true
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Successfully forwarded request:', requestId);
            
            // Display a success message
            const alertDiv = document.createElement('div');
            alertDiv.className = 'alert alert-success';
            alertDiv.textContent = isCustomized ? 
                'Request forwarded with custom response.' : 
                'Request forwarded with original response.';
            
            // Add to the top of the page temporarily
            const container = document.querySelector('.container');
            if (container && container.firstChild) {
                container.insertBefore(alertDiv, container.firstChild);
                // Remove after 3 seconds
                setTimeout(() => {
                    alertDiv.remove();
                }, 3000);
            }
            
            // Remove the request from our list
            interceptedRequests = interceptedRequests.filter(
                req => req.interceptionId !== requestId
            );
            updateInterceptedRequestsUI();
        } else {
            console.error('Error forwarding request:', data.error);
            alert(`Failed to forward request: ${data.error}`);
        }
    })
    .catch(error => {
        console.error('Error forwarding request:', error);
        alert(`Error forwarding request: ${error.message}`);
    });
}

function dropInterceptedRequest(requestId) {
    if (!confirm('Are you sure you want to drop this request? This will return no response to the client and may cause errors.')) {
        return;
    }
    
    // Make the request to drop the intercepted request
    fetch(`/drop-request/${requestId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Remove the request from our list
            interceptedRequests = interceptedRequests.filter(
                req => req.interceptionId !== requestId
            );
            updateInterceptedRequestsUI();
            
            // Close the modal if it's open
            const modal = document.getElementById('interceptModal');
            if (modal) modal.classList.remove('active');
        } else {
            console.error('Error dropping request:', data.error);
            alert(`Error dropping request: ${data.error}`);
        }
    })
    .catch(error => {
        console.error('Error dropping request:', error);
        alert(`Error dropping request: ${error.message}`);
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

// Fetch intercept rules from the server
function fetchInterceptRules() {
    fetch('/intercept-rules')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                interceptRules = data.rules;
                updateInterceptRulesUI();
            }
        })
        .catch(error => {
            console.error('Error fetching intercept rules:', error);
        });
}

// Add a new intercept rule
function addInterceptRule(rule) {
    fetch('/intercept-rules', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(rule)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Add the new rule to our list
            interceptRules.push(data.rule);
            // Update the UI
            updateInterceptRulesUI();
        } else {
            console.error('Error adding intercept rule:', data.error);
        }
    })
    .catch(error => {
        console.error('Error adding intercept rule:', error);
    });
}

// Update an existing intercept rule
function updateInterceptRule(id, updates) {
    fetch(`/intercept-rules/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update the rule in our list
            const index = interceptRules.findIndex(rule => rule.id === id);
            if (index !== -1) {
                interceptRules[index] = data.rule;
            }
            // Update the UI
            updateInterceptRulesUI();
        } else {
            console.error('Error updating intercept rule:', data.error);
        }
    })
    .catch(error => {
        console.error('Error updating intercept rule:', error);
    });
}

// Delete an intercept rule
function deleteInterceptRule(id) {
    fetch(`/intercept-rules/${id}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Remove the rule from our list
            interceptRules = interceptRules.filter(rule => rule.id !== id);
            // Update the UI
            updateInterceptRulesUI();
        } else {
            console.error('Error deleting intercept rule:', data.error);
        }
    })
    .catch(error => {
        console.error('Error deleting intercept rule:', error);
    });
}

// Toggle intercept mode
function toggleInterceptMode(enabled) {
    console.log('Toggling intercept mode:', enabled);
    
    // Send request to server to update intercept mode
    fetch('/update-intercept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('Intercept mode updated:', data);
            interceptEnabled = enabled;
            
            // Update UI
            updateInterceptUI();
            
            // Update the mocks UI visual state
            updateMocksUIVisualState(interceptEnabled);
            
            // Reset intercepted requests when disabled
            if (!interceptEnabled) {
                interceptedRequests = [];
                updateInterceptedRequestsUI();
            } else {
                // If enabled, fetch any pending requests
                fetch('/intercepted-requests')
                    .then(response => response.json())
                    .then(data => {
                        if (data.success && data.requests) {
                            interceptedRequests = data.requests;
                            updateInterceptedRequestsUI();
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching intercepted requests:', error);
                    });
            }
        } else {
            console.error('Error updating intercept mode:', data.error);
            // Revert toggle if there was an error
            const interceptToggle = document.getElementById('interceptToggle');
            if (interceptToggle) {
                interceptToggle.checked = !enabled;
            }
            alert(`Error toggling intercept mode: ${data.error}`);
        }
    })
    .catch(error => {
        console.error('Error updating intercept mode:', error);
        // Revert toggle if there was an error
        const interceptToggle = document.getElementById('interceptToggle');
        if (interceptToggle) {
            interceptToggle.checked = !enabled;
        }
        alert(`Error toggling intercept mode: ${error.message}`);
    });
}

function handleLogClick(logEntry) {
    console.log("Log entry clicked:", logEntry);
    
    // Create modal for displaying log details
    const modal = document.createElement('div');
    modal.className = 'log-details-modal';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'log-details-content';
    
    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-button';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => modal.remove();
    
    // Header with method, URL and status
    const header = document.createElement('div');
    header.className = 'log-details-header';
    
    const methodSpan = document.createElement('span');
    methodSpan.className = `method ${logEntry.method.toLowerCase()}`;
    methodSpan.textContent = logEntry.method;
    
    const urlSpan = document.createElement('span');
    urlSpan.className = 'url';
    urlSpan.textContent = logEntry.url;
    
    const statusSpan = document.createElement('span');
    statusSpan.className = `status status-${Math.floor(logEntry.status / 100)}xx`;
    statusSpan.textContent = logEntry.status;
    
    header.appendChild(methodSpan);
    header.appendChild(urlSpan);
    
    // Add mocked tag if this response was mocked
    if (logEntry.mocked) {
        const mockedTag = document.createElement('span');
        mockedTag.className = 'mocked-tag';
        mockedTag.textContent = 'MOCKED';
        mockedTag.title = 'This response was served from a mock';
        header.appendChild(mockedTag);
    }
    
    header.appendChild(statusSpan);
    
    // Timestamps
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'log-details-timestamp';
    timestampDiv.textContent = `Time: ${new Date(logEntry.timestamp).toLocaleString()}`;
    
    // Body container
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'log-details-body';
    
    // Tabs for Request/Response
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'details-tabs';
    
    const requestTab = document.createElement('div');
    requestTab.className = 'details-tab active';
    requestTab.textContent = 'Request';
    requestTab.dataset.tab = 'request';
    
    const responseTab = document.createElement('div');
    responseTab.className = 'details-tab';
    responseTab.textContent = 'Response';
    responseTab.dataset.tab = 'response';
    
    tabsContainer.appendChild(requestTab);
    tabsContainer.appendChild(responseTab);
    
    // Tab content containers
    const requestContent = document.createElement('div');
    requestContent.className = 'tab-content request-content active';
    
    const responseContent = document.createElement('div');
    responseContent.className = 'tab-content response-content';
    
    // REQUEST CONTENT
    // Headers section for request
    const requestHeadersSection = document.createElement('div');
    requestHeadersSection.className = 'details-section';
    
    const requestHeadersTitle = document.createElement('h3');
    requestHeadersTitle.textContent = 'Headers';
    requestHeadersSection.appendChild(requestHeadersTitle);
    
    const requestHeadersList = document.createElement('div');
    requestHeadersList.className = 'headers-list';
    
    // Add request headers if available
    if (logEntry.requestHeaders) {
        for (const [key, value] of Object.entries(logEntry.requestHeaders)) {
            const headerItem = document.createElement('div');
            headerItem.className = 'header-item';
            headerItem.innerHTML = `<strong>${key}:</strong> ${value}`;
            requestHeadersList.appendChild(headerItem);
        }
    } else {
        requestHeadersList.textContent = 'No headers available';
    }
    
    requestHeadersSection.appendChild(requestHeadersList);
    requestContent.appendChild(requestHeadersSection);
    
    // Body section for request
    const requestBodySection = document.createElement('div');
    requestBodySection.className = 'details-section';
    
    const requestBodyTitle = document.createElement('h3');
    requestBodyTitle.textContent = 'Body';
    requestBodySection.appendChild(requestBodyTitle);
    
    const requestBodyContent = document.createElement('pre');
    requestBodyContent.className = 'body-content';
    
    // Add request body if available
    if (logEntry.requestBody && typeof logEntry.requestBody === 'object' && Object.keys(logEntry.requestBody).length > 0) {
        requestBodyContent.textContent = JSON.stringify(logEntry.requestBody, null, 2);
    } else if (logEntry.requestBody && typeof logEntry.requestBody === 'string' && logEntry.requestBody.trim() !== '') {
        requestBodyContent.textContent = logEntry.requestBody;
    } else {
        requestBodyContent.textContent = 'No body content';
        requestBodyContent.className += ' no-content';
    }
    
    requestBodySection.appendChild(requestBodyContent);
    requestContent.appendChild(requestBodySection);
    
    // RESPONSE CONTENT
    // Headers section for response
    const responseHeadersSection = document.createElement('div');
    responseHeadersSection.className = 'details-section';
    
    const responseHeadersTitle = document.createElement('h3');
    responseHeadersTitle.textContent = 'Headers';
    responseHeadersSection.appendChild(responseHeadersTitle);
    
    const responseHeadersList = document.createElement('div');
    responseHeadersList.className = 'headers-list';
    
    // Add response headers if available
    if (logEntry.responseHeaders) {
        for (const [key, value] of Object.entries(logEntry.responseHeaders)) {
            const headerItem = document.createElement('div');
            headerItem.className = 'header-item';
            headerItem.innerHTML = `<strong>${key}:</strong> ${value}`;
            responseHeadersList.appendChild(headerItem);
        }
    } else {
        responseHeadersList.textContent = 'No headers available';
    }
    
    responseHeadersSection.appendChild(responseHeadersList);
    responseContent.appendChild(responseHeadersSection);
    
    // Body section for response
    const responseBodySection = document.createElement('div');
    responseBodySection.className = 'details-section';
    
    const responseBodyTitle = document.createElement('h3');
    responseBodyTitle.textContent = 'Body';
    responseBodySection.appendChild(responseBodyTitle);
    
    const responseBodyContent = document.createElement('pre');
    responseBodyContent.className = 'body-content';
    
    // Add response body if available (now for all methods including GET)
    if (logEntry.responseBody && logEntry.responseBody.trim() !== '') {
        if (logEntry.contentType && logEntry.contentType.includes('application/json')) {
            try {
                // If it's already formatted JSON (with newlines), use it as is
                if (logEntry.responseBody.includes('\n')) {
                    responseBodyContent.textContent = logEntry.responseBody;
                } else {
                    // Try to parse and reformat
                    const jsonObj = JSON.parse(logEntry.responseBody);
                    responseBodyContent.textContent = JSON.stringify(jsonObj, null, 2);
                }
                responseBodyContent.classList.add('json');
            } catch (e) {
                // If parsing fails, show as is
                responseBodyContent.textContent = logEntry.responseBody;
            }
        } else {
            responseBodyContent.textContent = logEntry.responseBody;
        }
    } else {
        responseBodyContent.textContent = 'No body content';
        responseBodyContent.className += ' no-content';
    }
    
    responseBodySection.appendChild(responseBodyContent);
    responseContent.appendChild(responseBodySection);
    
    // Tab click handlers
    requestTab.addEventListener('click', () => {
        requestTab.classList.add('active');
        responseTab.classList.remove('active');
        requestContent.classList.add('active');
        responseContent.classList.remove('active');
    });
    
    responseTab.addEventListener('click', () => {
        responseTab.classList.add('active');
        requestTab.classList.remove('active');
        responseContent.classList.add('active');
        requestContent.classList.remove('active');
    });
    
    // Assemble modal content
    bodyContainer.appendChild(tabsContainer);
    bodyContainer.appendChild(requestContent);
    bodyContainer.appendChild(responseContent);
    
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(header);
    modalContent.appendChild(timestampDiv);
    modalContent.appendChild(bodyContainer);
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add event listener to close modal when clicking outside
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.remove();
        }
    });
}

function renderLog(logEntry) {
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.dataset.id = logEntry.id;
    
    // Add class for different status codes
    if (logEntry.status) {
        const statusClass = Math.floor(logEntry.status / 100);
        logItem.classList.add(`status-${statusClass}xx`);
    }
    
    // Time - moved to leftmost position
    const time = document.createElement('span');
    time.className = 'time';
    const date = new Date(logEntry.timestamp);
    time.textContent = date.toLocaleTimeString();
    logItem.appendChild(time);
    
    // Method
    const method = document.createElement('span');
    method.className = `method ${logEntry.method.toLowerCase()}`;
    method.textContent = logEntry.method;
    logItem.appendChild(method);
    
    // URL path (truncated if too long)
    const url = document.createElement('span');
    url.className = 'url';
    
    try {
        const urlObj = new URL(logEntry.url);
        let displayPath = urlObj.pathname;
        if (displayPath.length > 40) {
            displayPath = displayPath.substring(0, 37) + '...';
        }
        url.textContent = displayPath;
        url.title = logEntry.url; // Show full URL on hover
    } catch (e) {
        url.textContent = logEntry.url;
    }
    logItem.appendChild(url);
    
    // Add "MOCKED" tag if this is a mocked response
    if (logEntry.mocked) {
        const mockedTag = document.createElement('span');
        mockedTag.className = 'mocked-tag';
        mockedTag.textContent = 'MOCKED';
        mockedTag.title = 'This response was served from a mock';
        logItem.appendChild(mockedTag);
    }
    
    // Add indicator for clickable logs with response body
    if (logEntry.responseBody) {
        const indicator = document.createElement('span');
        indicator.className = 'body-indicator';
        indicator.title = 'View request/response details';
        indicator.textContent = '↗';
        logItem.appendChild(indicator);
    }
    
    // Add click event to view details
    logItem.addEventListener('click', () => {
        handleLogClick(logEntry);
    });
    
    return logItem;
}