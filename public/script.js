// Fetch and update proxy status information
function updateStatus() {
    fetch('/info')
        .then(response => response.json())
        .then(data => {
            // Update proxy status
            const statusElement = document.getElementById('proxyStatus');
            const targetElement = document.getElementById('targetUrl');
            const portElement = document.getElementById('portInput');
            const timeElement = document.getElementById('startTime');

            statusElement.textContent = data.status;
            statusElement.className = `status-badge ${data.status}`;
            targetElement.value = data.target;
            portElement.value = data.port;
            timeElement.textContent = new Date(data.proxyStartTime).toLocaleString();

            // Update endpoint URLs and example URLs
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            const dashboardUrl = document.getElementById('dashboardUrl');
            const statusUrl = document.getElementById('statusUrl');
            const proxyUrl = document.getElementById('proxyUrl');
            
            // Update examples in the usage guide
            const apiUrlExample = document.getElementById('apiUrlExample');
            const targetUrlExample = document.getElementById('targetUrlExample');
            
            if (apiUrlExample) {
                apiUrlExample.textContent = `${baseUrl}/api/your-endpoint`;
            }
            
            if (targetUrlExample) {
                targetUrlExample.textContent = `${data.target}/your-endpoint`;
            }

            dashboardUrl.textContent = baseUrl;
            statusUrl.textContent = `${baseUrl}/info`;
            proxyUrl.textContent = `${baseUrl}/api/*`;

            // Update custom headers
            updateCustomHeadersDisplay(data.customHeaders || {});

            // Update cache settings
            const cacheToggle = document.getElementById('cacheToggle');
            const cacheStatus = document.getElementById('cacheStatus');
            
            if (data.cacheEnabled) {
                cacheToggle.checked = true;
                cacheStatus.textContent = 'Enabled';
            } else {
                cacheToggle.checked = false;
                cacheStatus.textContent = 'Disabled';
            }
            
            // Update statistics
            updateStats(data.stats || { total: 0, methods: {}, statusCodes: {}, errors: 0 });
        })
        .catch(error => {
            console.error('Error fetching status:', error);
            const statusElement = document.getElementById('proxyStatus');
            statusElement.textContent = 'Error';
            statusElement.className = 'status-badge inactive';
        });
}

// Handle logs
function addLogEntry(logData) {
    const logContainer = document.getElementById('logContainer');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${logData.status >= 400 ? 'error' : 'success'}`;
    
    const timestamp = new Date(logData.timestamp).toLocaleTimeString();
    const method = logData.method || 'N/A';
    const url = logData.url || 'N/A';
    const status = logData.status || 'N/A';
    
    // Highlight matching text in the log entry
    const searchText = document.getElementById('searchInput')?.value || '';
    const highlightText = (text) => {
        if (!searchText) return text;
        const regex = new RegExp(`(${searchText})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    };
    
    logEntry.innerHTML = `
        <span class="log-time">${highlightText(timestamp)}</span>
        <span class="log-method">${highlightText(method)}</span>
        <span class="log-url">${highlightText(url)}</span>
        <span class="log-status">${highlightText(status)}</span>
    `;
    
    logContainer.insertBefore(logEntry, logContainer.firstChild);
    
    // Remove placeholder if it exists
    const placeholder = logContainer.querySelector('.log-placeholder');
    if (placeholder) {
        placeholder.remove();
    }
}

// Search functionality for logs
function setupSearchFunctionality() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', () => {
        const searchText = searchInput.value.toLowerCase();
        const logEntries = document.querySelectorAll('.log-entry');
        
        logEntries.forEach(entry => {
            const text = entry.textContent.toLowerCase();
            entry.style.display = text.includes(searchText) ? 'flex' : 'none';
        });
    });
}

// Usage guide toggle
function setupUsageGuide() {
    const hideGuideButton = document.getElementById('hideGuide');
    const showGuideButton = document.getElementById('showGuide');
    const usageGuide = document.querySelector('.usage-guide');
    
    if (hideGuideButton && showGuideButton && usageGuide) {
        const guideHidden = localStorage.getItem('guide_hidden') === 'true';
        
        if (guideHidden) {
            usageGuide.style.display = 'none';
            showGuideButton.style.display = 'inline-block';
        }
        
        hideGuideButton.addEventListener('click', () => {
            usageGuide.style.display = 'none';
            showGuideButton.style.display = 'inline-block';
            localStorage.setItem('guide_hidden', 'true');
        });
        
        showGuideButton.addEventListener('click', () => {
            usageGuide.style.display = 'block';
            showGuideButton.style.display = 'none';
            localStorage.setItem('guide_hidden', 'false');
        });
    }
}

// Clear logs
document.getElementById('clearLogs')?.addEventListener('click', () => {
    const logContainer = document.getElementById('logContainer');
    logContainer.innerHTML = '<div class="log-placeholder">No logs yet...</div>';
});

// Configuration update handlers
function setupUpdateHandlers() {
    const targetUrlInput = document.getElementById('targetUrl');
    const portInput = document.getElementById('portInput');
    const saveTargetButton = document.getElementById('saveTarget');
    const updatePortButton = document.getElementById('updatePort');
    const newPortButton = document.getElementById('newPort');

    if (saveTargetButton) {
        saveTargetButton.addEventListener('click', updateTargetUrl);
    }

    if (updatePortButton) {
        updatePortButton.addEventListener('click', () => updatePort(false));
    }

    if (newPortButton) {
        newPortButton.addEventListener('click', () => updatePort(true));
    }

    // Add keyboard support
    if (targetUrlInput) {
        targetUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                updateTargetUrl();
            }
        });
    }

    if (portInput) {
        portInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                updatePort(false);
            }
        });
    }
}

function updateTargetUrl() {
    const targetUrlInput = document.getElementById('targetUrl');
    if (!targetUrlInput) return;
    
    const newUrl = targetUrlInput.value.trim();
    if (!newUrl) {
        alert('Please enter a target URL');
        return;
    }

    // Add http:// if no protocol is specified
    const urlToUpdate = newUrl.startsWith('http://') || newUrl.startsWith('https://') 
        ? newUrl 
        : `https://${newUrl}`;

    const saveTargetButton = document.getElementById('saveTarget');
    saveTargetButton.disabled = true;
    saveTargetButton.textContent = 'Updating...';

    fetch('/update-target', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ target: urlToUpdate })
    })
    .then(async response => {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned non-JSON response');
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update target URL');
        }
        return data;
    })
    .then(data => {
        if (data.success) {
            // Refresh status to update the proxy configuration
            updateStatus();
            // Show success message
            const statusElement = document.getElementById('proxyStatus');
            statusElement.textContent = 'Updated';
            statusElement.className = 'status-badge active';
            setTimeout(() => {
                statusElement.textContent = 'active';
            }, 2000);
        } else {
            throw new Error(data.error || 'Failed to update target URL');
        }
    })
    .catch(error => {
        console.error('Error updating target URL:', error);
        alert(error.message || 'Failed to update target URL. Please try again.');
        // Reset the input to the previous value
        updateStatus();
    })
    .finally(() => {
        saveTargetButton.disabled = false;
        saveTargetButton.textContent = 'Update';
    });
}

function updatePort(isNewInstance = false) {
    const portInput = document.getElementById('portInput');
    if (!portInput) return;
    
    const newPort = parseInt(portInput.value);
    if (!newPort || newPort < 1 || newPort > 65535) {
        alert('Please enter a valid port number (1-65535)');
        return;
    }

    const button = isNewInstance ? document.getElementById('newPort') : document.getElementById('updatePort');
    button.disabled = true;
    button.textContent = 'Updating...';

    fetch('/update-port', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ 
            port: newPort,
            isNewInstance: isNewInstance
        })
    })
    .then(async response => {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned non-JSON response');
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update port');
        }
        return data;
    })
    .then(data => {
        if (data.success) {
            if (isNewInstance) {
                // Open new instance in a new tab
                window.open(`${window.location.protocol}//${window.location.hostname}:${data.newPort}`, '_blank');
                // Show success message
                const statusElement = document.getElementById('proxyStatus');
                statusElement.textContent = 'New instance created';
                statusElement.className = 'status-badge active';
                setTimeout(() => {
                    statusElement.textContent = 'active';
                }, 2000);
            } else {
                // Update current instance
                const statusElement = document.getElementById('proxyStatus');
                statusElement.textContent = 'Restarting...';
                statusElement.className = 'status-badge active';
                
                // Wait for the server to restart
                setTimeout(() => {
                    // Update the WebSocket connection
                    if (ws) {
                        ws.close();
                    }
                    // Update the page URL
                    window.location.href = `${window.location.protocol}//${window.location.hostname}:${data.newPort}`;
                }, 1000);
            }
        } else {
            throw new Error(data.error || 'Failed to update port');
        }
    })
    .catch(error => {
        console.error('Error updating port:', error);
        alert(error.message || 'Failed to update port. Please try again.');
        // Reset the input to the previous value
        updateStatus();
    })
    .finally(() => {
        button.disabled = false;
        button.textContent = isNewInstance ? 'New Instance' : 'Update';
    });
}

// Custom Headers Management
let customHeaders = {};

function updateCustomHeadersDisplay(headers) {
    customHeaders = headers || {};
    const container = document.getElementById('headersContainer');
    if (!container) return;
    
    if (Object.keys(customHeaders).length === 0) {
        container.innerHTML = '<div class="headers-placeholder">No custom headers yet...</div>';
        return;
    }
    
    container.innerHTML = '';
    
    Object.entries(customHeaders).forEach(([key, value]) => {
        const headerItem = document.createElement('div');
        headerItem.className = 'header-item';
        
        headerItem.innerHTML = `
            <div class="header-name">${key}</div>
            <div class="header-value">${value}</div>
            <button class="delete-header" data-key="${key}">×</button>
        `;
        
        container.appendChild(headerItem);
    });
    
    // Add event listeners for delete buttons
    document.querySelectorAll('.delete-header').forEach(button => {
        button.addEventListener('click', (e) => {
            const key = e.target.getAttribute('data-key');
            delete customHeaders[key];
            updateCustomHeadersDisplay(customHeaders);
        });
    });
}

function setupHeadersHandlers() {
    const addHeaderButton = document.getElementById('addHeader');
    const cancelHeaderButton = document.getElementById('cancelHeader');
    const saveHeaderButton = document.getElementById('saveHeader');
    const saveHeadersButton = document.getElementById('saveHeaders');
    
    if (addHeaderButton) {
        addHeaderButton.addEventListener('click', openHeaderModal);
    }
    
    if (cancelHeaderButton) {
        cancelHeaderButton.addEventListener('click', closeHeaderModal);
    }
    
    if (saveHeaderButton) {
        saveHeaderButton.addEventListener('click', addCustomHeader);
    }
    
    if (saveHeadersButton) {
        saveHeadersButton.addEventListener('click', saveCustomHeaders);
    }
}

function openHeaderModal() {
    const modal = document.getElementById('headerModal');
    modal.style.display = 'flex';
    
    document.getElementById('headerName').value = '';
    document.getElementById('headerValue').value = '';
    document.getElementById('headerName').focus();
}

function closeHeaderModal() {
    const modal = document.getElementById('headerModal');
    modal.style.display = 'none';
}

function addCustomHeader() {
    const name = document.getElementById('headerName').value.trim();
    const value = document.getElementById('headerValue').value.trim();
    
    if (!name) {
        alert('Please enter a header name');
        return;
    }
    
    customHeaders[name] = value;
    updateCustomHeadersDisplay(customHeaders);
    closeHeaderModal();
}

function saveCustomHeaders() {
    const saveButton = document.getElementById('saveHeaders');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    
    fetch('/update-headers', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ headers: customHeaders })
    })
    .then(async response => {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Server returned non-JSON response');
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update headers');
        }
        return data;
    })
    .then(data => {
        if (data.success) {
            // Refresh status to update the proxy configuration
            updateStatus();
            // Show success message
            const statusElement = document.getElementById('proxyStatus');
            statusElement.textContent = 'Headers Updated';
            statusElement.className = 'status-badge active';
            setTimeout(() => {
                statusElement.textContent = 'active';
            }, 2000);
        } else {
            throw new Error(data.error || 'Failed to update headers');
        }
    })
    .catch(error => {
        console.error('Error updating headers:', error);
        alert(error.message || 'Failed to update headers. Please try again.');
    })
    .finally(() => {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Headers';
    });
}

// Cache Management
function setupCacheHandlers() {
    const cacheToggle = document.getElementById('cacheToggle');
    const clearCacheButton = document.getElementById('clearCache');
    
    if (cacheToggle) {
        cacheToggle.addEventListener('change', toggleCache);
    }
    
    if (clearCacheButton) {
        clearCacheButton.addEventListener('click', clearCache);
    }
}

function toggleCache() {
    const enabled = document.getElementById('cacheToggle').checked;
    const duration = document.getElementById('cacheDuration').value || '5';
    const unit = document.getElementById('cacheUnit').value;
    
    // Format duration string
    let durationString = `${duration} ${unit}`;
    
    fetch('/update-cache', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ 
            enabled: enabled,
            duration: durationString
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to update cache settings');
        }
        return response.json();
    })
    .then(data => {
        document.getElementById('cacheStatus').textContent = enabled ? 'Enabled' : 'Disabled';
    })
    .catch(error => {
        console.error('Error updating cache settings:', error);
        alert(error.message || 'Failed to update cache settings');
        // Reset UI to match server state
        updateStatus();
    });
}

function clearCache() {
    fetch('/clear-cache', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to clear cache');
        }
        return response.json();
    })
    .then(data => {
        const statusElement = document.getElementById('proxyStatus');
        statusElement.textContent = 'Cache Cleared';
        statusElement.className = 'status-badge active';
        setTimeout(() => {
            statusElement.textContent = 'active';
        }, 2000);
    })
    .catch(error => {
        console.error('Error clearing cache:', error);
        alert(error.message || 'Failed to clear cache');
    });
}

// Statistics Management
function updateStats(stats) {
    const totalRequests = document.getElementById('totalRequests');
    const successRate = document.getElementById('successRate');
    const errorRate = document.getElementById('errorRate');
    
    if (!totalRequests || !successRate || !errorRate) return;
    
    totalRequests.textContent = stats.total || 0;
    
    const methodsChart = document.getElementById('methodsChart');
    const statusChart = document.getElementById('statusChart');
    
    // Calculate success and error rates
    let successCount = 0;
    let errorCount = stats.errors || 0;
    
    Object.entries(stats.statusCodes || {}).forEach(([code, count]) => {
        if (parseInt(code) < 400) {
            successCount += count;
        } else {
            errorCount += count;
        }
    });
    
    const successRateValue = stats.total ? Math.round((successCount / stats.total) * 100) : 0;
    const errorRateValue = stats.total ? Math.round((errorCount / stats.total) * 100) : 0;
    
    successRate.textContent = `${successRateValue}%`;
    errorRate.textContent = `${errorRateValue}%`;
    
    // Create simple bar charts for methods and status codes
    if (methodsChart) {
        methodsChart.innerHTML = '';
        if (stats.methods && Object.keys(stats.methods).length > 0) {
            methodsChart.innerHTML = createSimpleChart(stats.methods);
        } else {
            methodsChart.innerHTML = '<div class="chart-placeholder">No data available</div>';
        }
    }
    
    if (statusChart) {
        statusChart.innerHTML = '';
        if (stats.statusCodes && Object.keys(stats.statusCodes).length > 0) {
            statusChart.innerHTML = createSimpleChart(stats.statusCodes);
        } else {
            statusChart.innerHTML = '<div class="chart-placeholder">No data available</div>';
        }
    }
}

function createSimpleChart(data) {
    const total = Object.values(data).reduce((sum, count) => sum + count, 0);
    
    return Object.entries(data)
        .map(([key, value]) => {
            const percentage = Math.round((value / total) * 100);
            return `
                <div class="chart-item">
                    <div class="chart-label">${key}</div>
                    <div class="chart-bar-container">
                        <div class="chart-bar" style="width: ${percentage}%"></div>
                    </div>
                    <div class="chart-value">${value} (${percentage}%)</div>
                </div>
            `;
        })
        .join('');
}

function setupStatsHandlers() {
    const resetStatsButton = document.getElementById('resetStats');
    
    if (resetStatsButton) {
        resetStatsButton.addEventListener('click', resetStats);
    }
}

function resetStats() {
    fetch('/reset-stats', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to reset statistics');
        }
        return response.json();
    })
    .then(data => {
        updateStats({ total: 0, methods: {}, statusCodes: {}, errors: 0 });
        
        const statusElement = document.getElementById('proxyStatus');
        statusElement.textContent = 'Stats Reset';
        statusElement.className = 'status-badge active';
        setTimeout(() => {
            statusElement.textContent = 'active';
        }, 2000);
    })
    .catch(error => {
        console.error('Error resetting statistics:', error);
        alert(error.message || 'Failed to reset statistics');
    });
}

// Authentication Helper - replaced with empty function
function getAuthHeader() {
    // Return empty string since auth is disabled
    return '';
}

// Authentication error handler - replaced with empty function
function handleAuthError(retryCallback) {
    // Just retry without prompting for credentials
    if (typeof retryCallback === 'function') {
        retryCallback();
    }
}

// Add endpoint button handlers
function setupEndpointHandlers() {
    const dashboardUrl = document.getElementById('dashboardUrl');
    const statusUrl = document.getElementById('statusUrl');
    const proxyUrl = document.getElementById('proxyUrl');
    
    if (dashboardUrl) {
        dashboardUrl.addEventListener('click', function() {
            window.open(this.textContent, '_blank');
        });
    }
    
    if (statusUrl) {
        statusUrl.addEventListener('click', function() {
            window.open(this.textContent, '_blank');
        });
    }
    
    if (proxyUrl) {
        proxyUrl.addEventListener('click', function() {
            window.open(this.textContent.replace('/*', ''), '_blank');
        });
    }
}

// Create info page
function createInfoPage(data) {
    const baseUrl = `${window.location.protocol}//${window.location.host}`;
    
    // Apply info page styles
    document.body.className = 'info-body';
    
    // Create a document fragment to build the info page
    document.body.innerHTML = `
    <div class="info-page">
        <header class="info-header">
            <h1>Proxy Server Information</h1>
            <button class="button back-button" id="backButton">← Back to Dashboard</button>
        </header>
        
        <div class="info-section">
            <div class="section-header">
                <h2>Server Status</h2>
                <span class="status-badge ${data.status}">${data.status}</span>
            </div>
            
            <div class="info-grid">
                <div class="info-item">
                    <div class="info-label">Target URL:</div>
                    <div class="info-value-container">
                        <code class="info-value">${data.target}</code>
                        <button class="copy-button" data-value="${data.target}">Copy</button>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Port:</div>
                    <div class="info-value-container">
                        <code class="info-value">${data.port}</code>
                        <button class="copy-button" data-value="${data.port}">Copy</button>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">HTTPS:</div>
                    <div class="info-value">
                        <span class="https-badge ${data.httpsEnabled ? 'enabled' : 'disabled'}">
                            ${data.httpsEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Start Time:</div>
                    <div class="info-value">${new Date(data.proxyStartTime).toLocaleString()}</div>
                </div>
            </div>
        </div>
        
        <div class="info-section">
            <div class="section-header">
                <h2>Custom Headers</h2>
                <button class="copy-button" data-value='${JSON.stringify(data.customHeaders)}'>Copy All</button>
            </div>
            <div class="headers-table">
                ${Object.entries(data.customHeaders || {}).length > 0 ? 
                    `<div class="table-header">
                        <div class="header-name">Name</div>
                        <div class="header-value">Value</div>
                        <div class="header-action"></div>
                    </div>
                    ${Object.entries(data.customHeaders || {}).map(([key, value]) => `
                        <div class="table-row">
                            <div class="header-name">${key}</div>
                            <div class="header-value">${value}</div>
                            <div class="header-action">
                                <button class="copy-button small" data-value="${value}">Copy</button>
                            </div>
                        </div>
                    `).join('')}` 
                    : '<div class="no-data">No custom headers configured</div>'
                }
            </div>
        </div>
        
        <div class="info-section">
            <div class="section-header">
                <h2>Request Statistics</h2>
                <button class="copy-button" data-value='${JSON.stringify(data.stats)}'>Copy All</button>
            </div>
            
            <div class="stats-summary">
                <div class="stat-card">
                    <div class="stat-value">${data.stats?.total || 0}</div>
                    <div class="stat-label">Total Requests</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-value">${Object.keys(data.stats?.methods || {}).length}</div>
                    <div class="stat-label">HTTP Methods</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-value">${Object.keys(data.stats?.statusCodes || {}).length}</div>
                    <div class="stat-label">Status Codes</div>
                </div>
                
                <div class="stat-card error">
                    <div class="stat-value">${data.stats?.errors || 0}</div>
                    <div class="stat-label">Errors</div>
                </div>
            </div>
            
            <div class="stats-details">
                ${data.stats?.methods && Object.keys(data.stats.methods).length > 0 ? `
                    <div class="stats-section">
                        <h3>Methods</h3>
                        <div class="stats-grid">
                            ${Object.entries(data.stats.methods).map(([method, count]) => `
                                <div class="method-item">
                                    <div class="method-name">${method}</div>
                                    <div class="method-count">${count}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${data.stats?.statusCodes && Object.keys(data.stats.statusCodes).length > 0 ? `
                    <div class="stats-section">
                        <h3>Status Codes</h3>
                        <div class="stats-grid">
                            ${Object.entries(data.stats.statusCodes).map(([code, count]) => `
                                <div class="status-item">
                                    <div class="status-code ${parseInt(code) >= 400 ? 'error' : parseInt(code) >= 300 ? 'redirect' : 'success'}">${code}</div>
                                    <div class="status-count">${count}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
        
        <div class="info-section">
            <h2>Endpoints</h2>
            <div class="endpoints-grid">
                <div class="endpoint-card">
                    <div class="endpoint-title">Dashboard</div>
                    <div class="endpoint-url">
                        <a href="${baseUrl}" class="endpoint-link">${baseUrl}</a>
                    </div>
                    <div class="endpoint-description">Main control panel for configuring the proxy server</div>
                    <button class="copy-button" data-value="${baseUrl}">Copy URL</button>
                </div>
                
                <div class="endpoint-card">
                    <div class="endpoint-title">API Proxy</div>
                    <div class="endpoint-url">
                        <a href="${baseUrl}/api" class="endpoint-link">${baseUrl}/api/*</a>
                    </div>
                    <div class="endpoint-description">Pass requests through to target URL</div>
                    <button class="copy-button" data-value="${baseUrl}/api">Copy URL</button>
                </div>
                
                <div class="endpoint-card">
                    <div class="endpoint-title">Server Info</div>
                    <div class="endpoint-url">
                        <a href="${baseUrl}/info" class="endpoint-link">${baseUrl}/info</a>
                    </div>
                    <div class="endpoint-description">View detailed proxy server information</div>
                    <button class="copy-button" data-value="${baseUrl}/info">Copy URL</button>
                </div>
            </div>
        </div>
    </div>
    `;
    
    // Add back button handler
    document.getElementById('backButton').addEventListener('click', () => {
        window.location.href = baseUrl;
    });
    
    // Add copy button functionality
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', () => {
            const value = button.getAttribute('data-value');
            navigator.clipboard.writeText(value).then(() => {
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.classList.add('copied');
                
                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 1500);
            });
        });
    });
}

// Check if we're on the info page
function handleInfoPage() {
    if (window.location.pathname === '/info') {
        // Fetch and display info
        fetch('/info')
            .then(response => response.json())
            .then(data => {
                createInfoPage(data);
            })
            .catch(error => {
                console.error('Error fetching info:', error);
                document.body.innerHTML = `
                <div class="info-page">
                    <div class="info-section">
                        <h2>Error</h2>
                        <p>Failed to load proxy information: ${error.message}</p>
                        <button class="button" onclick="window.location.href='/'">Go to Dashboard</button>
                    </div>
                </div>
                `;
            });
        return true;
    }
    return false;
}

// WebSocket connection for real-time logs
let ws;
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/logs`);
    
    ws.onmessage = (event) => {
        const logData = JSON.parse(event.data);
        addLogEntry(logData);
    };
    
    ws.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting...');
        setTimeout(connectWebSocket, 1000);
    };
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on the info page
    if (handleInfoPage()) {
        return; // Don't initialize dashboard if we're on the info page
    }
    
    // Initialize dashboard
    updateStatus();
    setInterval(updateStatus, 30000);
    connectWebSocket();
    
    // Set up all handlers
    setupSearchFunctionality();
    setupUsageGuide();
    setupUpdateHandlers();
    setupHeadersHandlers();
    setupCacheHandlers();
    setupStatsHandlers();
    setupEndpointHandlers();
});