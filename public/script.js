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
    const clearLogsButton = document.getElementById('clearLogs');
    const logContainer = document.getElementById('logContainer');
    
    if (clearLogsButton && logContainer) {
        clearLogsButton.addEventListener('click', () => {
            // Clear all logs
            logContainer.innerHTML = '<div class="log-placeholder">No logs yet...</div>';
        });
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    setupEndpointHandlers();
    setupTargetUrlUpdate();
    setupClearLogs();
    setupHeadersModal();
    setupGuideToggle();
    connectWebSocket();
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