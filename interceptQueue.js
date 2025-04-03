/**
 * Request Interception Queue
 * Manages the interception, queueing, and forwarding of HTTP requests.
 */
const { v4: uuidv4 } = require('uuid');

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
        this.interceptEnabled = !!enabled;
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
            // Store the response and next function so we can continue later
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
        
        // Continue the request processing
        const next = request._next;
        
        // Remove the request from the queue
        this.pendingRequests.delete(id);
        
        // Continue the request processing
        if (typeof next === 'function') {
            next();
        }
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