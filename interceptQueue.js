/**
 * Request Interception Queue
 * Manages the interception, queueing, and forwarding of HTTP requests.
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

class InterceptQueue {
    constructor() {
        this.interceptEnabled = false;
        this.pendingRequests = new Map();
    }

    /**
     * Check if request interception is enabled
     * @returns {boolean} True if interception is enabled
     */
    isInterceptionEnabled() {
        return this.interceptEnabled;
    }

    /**
     * Enable or disable request interception
     * @param {boolean} enabled Whether interception should be enabled
     */
    setInterceptionEnabled(enabled) {
        const wasEnabled = this.interceptEnabled;
        this.interceptEnabled = !!enabled;
        
        // If intercept mode is being disabled and there were pending requests,
        // automatically forward all of them
        if (wasEnabled && !this.interceptEnabled) {
            const pendingCount = this.pendingRequests.size;
            if (pendingCount > 0) {
                console.log(`Auto-forwarding ${pendingCount} pending requests after disabling intercept mode`);
                this.forwardAllRequests();
            }
        }
    }

    /**
     * Intercept an HTTP request
     * @param {Object} req Express request object
     * @param {Object} res Express response object
     * @param {Function} next Express next function
     * @param {Function} callback Callback function called with the interception ID
     */
    intercept(req, res, next, callback) {
        // Generate a unique ID for this interception
        const interceptId = uuidv4();
        
        // Create a copy of the request data
        const requestData = {
            id: interceptId,
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            body: req.body,
            query: req.query,
            params: req.params,
            // Store the original request and response objects
            _request: req,
            _response: res,
            _next: next,
            _intercepted: true
        };
        
        // Store the request in the queue
        this.pendingRequests.set(interceptId, requestData);
        
        // Call the callback with the interception ID
        if (typeof callback === 'function') {
            callback(interceptId);
        }
        
        // The request is now intercepted, so don't call next() yet
        return;
    }

    /**
     * Get all pending intercepted requests
     * @returns {Array} Array of pending requests
     */
    getPendingRequests() {
        const requests = [];
        
        this.pendingRequests.forEach(request => {
            // Create a copy without private properties
            const { _response, _next, ...publicData } = request;
            requests.push(publicData);
        });
        
        return requests;
    }

    /**
     * Get a specific intercepted request
     * @param {string} id Request ID
     * @returns {Object|null} The request or null if not found
     */
    getRequest(id) {
        return this.pendingRequests.get(id) || null;
    }

    /**
     * Forward an intercepted request
     * @param {string} id Request ID
     */
    forwardRequest(id) {
        const request = this.pendingRequests.get(id);
        
        if (!request) {
            throw new Error(`Request with ID ${id} not found`);
        }
        
        if (!request._intercepted) {
            throw new Error(`Request with ID ${id} is not intercepted`);
        }
        
        // Get the original Express request, response objects
        const res = request._response;
        const req = request._request;
        
        console.log(`Forwarding intercepted request ${id}: ${request.method} ${request.url}`);
        
        // Build the target URL from the original request
        const targetUrl = `${process.env.API_SERVICE_URL}${request.url}`;
        
        // Prepare headers (remove host header to avoid conflicts)
        const headers = { ...request.headers };
        delete headers.host;
        
        // Make the actual HTTP request to the target using axios
        axios({
            method: request.method,
            url: targetUrl,
            headers: headers,
            data: request.body,
            timeout: 30000, // 30 second timeout
            validateStatus: () => true // Accept all status codes
        })
        .then(response => {
            console.log(`Received response for forwarded request ${id}: ${response.status}`);
            
            // Send the response headers
            Object.entries(response.headers).forEach(([key, value]) => {
                // Skip setting certain headers that might cause conflicts
                if (!['content-length', 'connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) {
                    res.set(key, value);
                }
            });
            
            // Send the status code and response body
            res.status(response.status).send(response.data);
        })
        .catch(error => {
            console.error(`Error forwarding request ${id}:`, error.message);
            
            // Handle the error appropriately
            if (error.response) {
                // The request was made and the server responded with a non-2xx status
                res.status(error.response.status).send(error.response.data);
            } else if (error.request) {
                // The request was made but no response was received
                res.status(502).json({
                    error: 'Bad Gateway',
                    message: 'No response received from target server'
                });
            } else {
                // Something happened in setting up the request
                res.status(500).json({
                    error: 'Internal Server Error',
                    message: error.message
                });
            }
        })
        .finally(() => {
            // Remove the request from the queue
            this.pendingRequests.delete(id);
        });
    }

    /**
     * Drop an intercepted request
     * @param {string} id Request ID
     */
    dropRequest(id) {
        const request = this.pendingRequests.get(id);
        
        if (!request) {
            throw new Error(`Request with ID ${id} not found`);
        }
        
        if (!request._intercepted) {
            throw new Error(`Request with ID ${id} is not intercepted`);
        }
        
        const res = request._response;
        
        // Remove the request from the queue
        this.pendingRequests.delete(id);
        
        // Send a response to the client
        if (res && !res.headersSent) {
            res.status(403).json({
                error: 'Request blocked by proxy',
                message: 'The request was intercepted and dropped'
            });
        }
    }

    /**
     * Forward all pending requests
     * @returns {number} Number of forwarded requests
     */
    forwardAllRequests() {
        const requestIds = Array.from(this.pendingRequests.keys());
        let forwardedCount = 0;
        
        requestIds.forEach(id => {
            try {
                this.forwardRequest(id);
                forwardedCount++;
            } catch (error) {
                console.error(`Error forwarding request ${id}:`, error);
            }
        });
        
        return forwardedCount;
    }

    /**
     * Drop all pending requests
     * @returns {number} Number of dropped requests
     */
    dropAllRequests() {
        const requestIds = Array.from(this.pendingRequests.keys());
        let droppedCount = 0;
        
        requestIds.forEach(id => {
            try {
                this.dropRequest(id);
                droppedCount++;
            } catch (error) {
                console.error(`Error dropping request ${id}:`, error);
            }
        });
        
        return droppedCount;
    }
}

module.exports = InterceptQueue; 