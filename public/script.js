function setupEndpointHandlers() {
    const endpoints = document.querySelectorAll('.endpoint-button');
    
    endpoints.forEach(endpoint => {
        // Add context menu handler (right-click)
        endpoint.addEventListener('contextmenu', (e) => {
            e.preventDefault();  // Prevent default context menu
            const text = endpoint.textContent;
            navigator.clipboard.writeText(text)
                .then(() => {
                    // Show temporary feedback
                    const originalText = endpoint.textContent;
                    endpoint.textContent = 'Copied!';
                    endpoint.classList.add('copied');
                    
                    setTimeout(() => {
                        endpoint.textContent = originalText;
                        endpoint.classList.remove('copied');
                    }, 1000);
                })
                .catch(err => {
                    console.error('Error copying to clipboard:', err);
                });
        });
        
        // Add click handler for opening the URL
        endpoint.addEventListener('click', (e) => {
            e.preventDefault();
            const url = endpoint.textContent;
            if (url.includes('*')) {
                // If URL contains wildcard, open base URL instead
                window.open(url.replace('/*', ''), '_blank');
            } else {
                window.open(url, '_blank');
            }
        });
    });
}

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
                    // Regular request logs
                    logEntry.className = `log-entry ${data.status >= 400 ? 'error' : 'success'}`;
                    logEntry.innerHTML = `
                        <span class="log-time">${timeString}</span>
                        <span class="log-method">${data.method}</span>
                        <span class="log-url">${data.url}</span>
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

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Setup UI components
    setupEndpointHandlers();
    setupTargetUrlUpdate();
    setupClearLogs();
    setupHeadersModal();
    setupMocksModal();
    setupGuideToggle();
    
    // Connect to WebSocket for real-time logs
    connectWebSocket();
    
    // Update endpoint examples with correct hostname
    updateEndpointExamples();
});

// Setup headers modal functionality
function setupHeadersModal() {
    const addHeaderButton = document.getElementById('addHeader');
    const headerModal = document.getElementById('headerModal');
    const saveHeaderButton = document.getElementById('saveHeader');
    const cancelHeaderButton = document.getElementById('cancelHeader');
    const headerNameInput = document.getElementById('headerName');
    const headerValueInput = document.getElementById('headerValue');
    const headersContainer = document.getElementById('headersContainer');
    
    // Current headers object
    let customHeaders = {};
    
    // Show modal when Add Header button is clicked
    if (addHeaderButton && headerModal) {
        addHeaderButton.addEventListener('click', () => {
            headerModal.classList.add('active');
            // Reset inputs
            if (headerNameInput) headerNameInput.value = '';
            if (headerValueInput) headerValueInput.value = '';
            // Focus on the first input
            if (headerNameInput) headerNameInput.focus();
        });
    }
    
    // Handle Save Header button in modal
    if (saveHeaderButton) {
        saveHeaderButton.addEventListener('click', () => {
            const name = headerNameInput.value.trim();
            const value = headerValueInput.value.trim();
            
            if (name) {
                // Add to headers object
                customHeaders[name] = value;
                
                // Update UI
                updateHeadersUI(customHeaders);
                
                // Close modal
                headerModal.classList.remove('active');
            } else {
                alert('Please enter a header name');
            }
        });
    }
    
    // Handle Cancel button in modal
    if (cancelHeaderButton) {
        cancelHeaderButton.addEventListener('click', () => {
            headerModal.classList.remove('active');
        });
    }
    
    // Setup save headers button
    const saveHeadersButton = document.getElementById('saveHeaders');
    if (saveHeadersButton) {
        saveHeadersButton.addEventListener('click', () => {
            // Send headers to server
            fetch('/update-headers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ headers: customHeaders })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert('Headers updated successfully');
                } else {
                    alert(`Error updating headers: ${data.error}`);
                }
            })
            .catch(error => {
                console.error('Error updating headers:', error);
                alert('Failed to update headers. Check console for details.');
            });
        });
    }
    
    // Function to update headers UI
    function updateHeadersUI(headers) {
        if (!headersContainer) return;
        
        // Clear container
        headersContainer.innerHTML = '';
        
        // Check if there are any headers
        const hasHeaders = Object.keys(headers).length > 0;
        
        if (!hasHeaders) {
            // Show placeholder if no headers
            headersContainer.innerHTML = '<div class="headers-placeholder">No custom headers yet...</div>';
            return;
        }
        
        // Add header items
        for (const [name, value] of Object.entries(headers)) {
            const headerItem = document.createElement('div');
            headerItem.className = 'header-item';
            headerItem.innerHTML = `
                <span class="header-name">${name}:</span>
                <span class="header-value">${value}</span>
                <button class="delete-header" data-name="${name}">×</button>
            `;
            headersContainer.appendChild(headerItem);
        }
        
        // Add event listeners to delete buttons
        const deleteButtons = headersContainer.querySelectorAll('.delete-header');
        deleteButtons.forEach(button => {
            button.addEventListener('click', () => {
                const headerName = button.getAttribute('data-name');
                if (headerName && headerName in customHeaders) {
                    delete customHeaders[headerName];
                    updateHeadersUI(customHeaders);
                }
            });
        });
    }
    
    // Fetch existing headers from server
    fetch('/info')
        .then(response => response.json())
        .then(data => {
            if (data.customHeaders) {
                customHeaders = data.customHeaders;
                updateHeadersUI(customHeaders);
            }
        })
        .catch(error => {
            console.error('Error fetching headers:', error);
        });
}

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
        
        const mockData = {
            path: mockPath.value,
            statusCode: parseInt(mockStatus.value || 200, 10),
            responseBody,
            enabled: mockEnabled.checked
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
            
            // Edit button
            if (target.classList.contains('mock-action-edit')) {
                const mockId = target.dataset.id;
                editMock(mockId);
            }
            
            // Delete button
            if (target.classList.contains('mock-action-delete')) {
                const mockId = target.dataset.id;
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
function fetchMocks() {
    fetch('/mocks')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateMocksUI(data.mocks);
            }
        })
        .catch(error => {
            console.error('Error fetching mocks:', error);
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