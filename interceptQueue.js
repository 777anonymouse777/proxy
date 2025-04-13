/**
 * Request Interception Queue
 * Manages the interception, queueing, and forwarding of HTTP requests.
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

class InterceptQueue {
  constructor(logger) {
    this.interceptEnabled = false;
    this.pendingRequests = new Map();
    // logger is a function that accepts a log object and broadcasts it (e.g., to WebSocket clients)
    this.logger = logger;
    console.log('InterceptQueue initialized with interception disabled');
  }

  /**
   * Check if request interception is enabled
   * @returns {boolean} True if interception is enabled
   */
  isInterceptionEnabled() {
    console.log('Checking interception status:', this.interceptEnabled);
    return this.interceptEnabled;
  }

  /**
   * Enable or disable request interception
   * @param {boolean} enabled Whether interception should be enabled
   */
  setInterceptionEnabled(enabled) {
    const wasEnabled = this.interceptEnabled;
    this.interceptEnabled = !!enabled;
    console.log(`Intercept mode ${this.interceptEnabled ? 'enabled' : 'disabled'}`);

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

    console.log(`Intercepting request ${interceptId}: ${req.method} ${req.url}`);

    // Create a clean copy of the request data without references to old data
    const requestData = {
      interceptionId: interceptId, // Use consistent property name with frontend
      id: interceptId,
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body: JSON.parse(JSON.stringify(req.body || {})),
      query: { ...req.query },
      params: { ...req.params },
      // Store the original request and response objects
      _request: req,
      _response: res,
      _next: next,
      _intercepted: true,
      type: 'intercepted-request' // Add type to distinguish in logs/UI
    };

    // Store the request in the queue
    this.pendingRequests.set(interceptId, requestData);

    // Log the intercepted request with tag "intercepted"
    if (this.logger) {
      const logData = {
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        status: 'INTERCEPTED',
        tag: 'intercepted',
        interceptionId: interceptId,
        type: 'intercepted-request'
      };
      console.log('Broadcasting intercepted request log:', logData);
      this.logger(logData);
    }

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
      // Create a clean copy without private properties and references to old data
      const { _request, _response, _next, ...publicData } = request;
      requests.push({...publicData});
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
   * Fetch the expected response for an intercepted request without forwarding it
   * @param {string} id Request ID
   * @returns {Promise<Object>} Promise resolving to the response data
   */
  async fetchResponsePreview(id) {
    const request = this.pendingRequests.get(id);

    if (!request) {
      throw new Error(`Request with ID ${id} not found`);
    }

    if (!request._intercepted) {
      throw new Error(`Request with ID ${id} is not intercepted`);
    }

    console.log(`Fetching response preview for intercepted request ${id}: ${request.method} ${request.url}`);

    // Build the target URL from the original request
    const targetUrl = `${process.env.API_SERVICE_URL}${request.url}`;

    // Prepare headers (remove host header to avoid conflicts)
    const headers = { ...request.headers };
    delete headers.host;

    try {
      // Make the actual HTTP request to the target using axios
      const response = await axios({
        method: request.method,
        url: targetUrl,
        headers: headers,
        data: request.body,
        timeout: 30000, // 30 second timeout
        validateStatus: () => true // Accept all status codes
      });

      console.log(`Received preview response for request ${id}: ${response.status}`);

      // Format the response body if it's JSON
      let formattedBody = response.data;
      if (typeof formattedBody === 'object') {
        formattedBody = JSON.stringify(formattedBody, null, 2);
      }

      // Store the response preview in the request object
      request.responsePreview = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: formattedBody,
        contentType: response.headers['content-type'] || ''
      };

      // Update the request in the queue
      this.pendingRequests.set(id, request);

      // Return the response preview
      return request.responsePreview;

    } catch (error) {
      console.error(`Error fetching preview for request ${id}:`, error.message);

      // Create an error response
      const errorResponse = {
        status: error.response ? error.response.status : 500,
        statusText: error.response ? error.response.statusText : 'Error',
        headers: error.response ? error.response.headers : {},
        body: error.response ? JSON.stringify(error.response.data, null, 2) : error.message,
        contentType: error.response && error.response.headers['content-type'] ? error.response.headers['content-type'] : 'text/plain',
        error: true
      };

      // Store the error response in the request
      request.responsePreview = errorResponse;
      this.pendingRequests.set(id, request);

      // Return the error response
      return errorResponse;
    }
  }

  /**
   * Forward an intercepted request
   * @param {string} id Request ID
   * @param {Object} customResponse Custom response object
   */
  forwardRequest(id, customResponse = null) {
    const request = this.pendingRequests.get(id);

    if (!request) {
      throw new Error(`Request with ID ${id} not found`);
    } 

    if (!request._intercepted) {
      throw new Error(`Request with ID ${id} is not intercepted`);
    }

    // Get the original Express request and response objects
    const res = request._response;
    
    // If there's a custom response, send it directly
    if (customResponse) {
      console.log(`Sending custom response for intercepted request ${id}`);
      
      // Set status code
      res.status(customResponse.statusCode || 200);
      
      // Set headers
      if (customResponse.headers) {
        Object.entries(customResponse.headers).forEach(([name, value]) => {
          res.set(name, value);
        });
      }
      
      // Send the body
      res.send(customResponse.body);
      
      // Log the custom response with tag "custom-response"
      if (this.logger) {
        this.logger({
          timestamp: new Date().toISOString(),
          method: request.method,
          url: request.url,
          status: customResponse.statusCode || 200,
          tag: 'custom-response'
        });
      }
      
      // Remove the request from the queue
      this.pendingRequests.delete(id);
      return;
    }

    // Get the original Express request and response objects
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

        // Log the forwarded response with tag "forwarded"
        if (this.logger) {
          this.logger({
            timestamp: new Date().toISOString(),
            method: request.method,
            url: request.url,
            status: response.status,
            tag: 'forwarded'
          });
        }

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

        // Log the error response as forwarded
        if (this.logger) {
          this.logger({
            timestamp: new Date().toISOString(),
            method: request.method,
            url: request.url,
            status: error.response ? error.response.status : 'Error',
            tag: 'forwarded'
          });
        }

        // Handle the error appropriately
        if (error.response) {
          res.status(error.response.status).send(error.response.data);
        } else if (error.request) {
          res.status(502).json({
            error: 'Bad Gateway',
            message: 'No response received from target server'
          });
        } else {
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

    // Simply remove the request from the queue without forwarding
    this.pendingRequests.delete(id);
  }

  /**
   * Forward all intercepted requests
   */
  forwardAllRequests() {
    for (const id of Array.from(this.pendingRequests.keys())) {
      this.forwardRequest(id);
    }
  }
}

module.exports = InterceptQueue;
