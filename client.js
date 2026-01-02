#!/usr/bin/env node

import http from 'http';
import { EventSource } from 'eventsource';

/**
 * MCP SSE Client for connecting to the Serverless MCP Server
 * 
 * Usage:
 * ```javascript
 * const client = new McpClient({ hostname: 'localhost', port: 3001 })
 * await client.connect()
 * 
 * // List available tools
 * const tools = await client.listTools()
 * 
 * // Call a tool
 * const result = await client.callTool('docs', {
 *   product: 'sf',
 *   paths: ['README.md']
 * })
 * 
 * await client.disconnect()
 * ```
 */
class McpClient {
  constructor({ hostname = 'localhost', port = 3001, timeout = 10000 } = {}) {
    this.hostname = hostname
    this.port = port
    this.timeout = timeout
    this.sessionId = null
    this.eventSource = null
    this.pendingRequests = new Map()
    this.messageIdCounter = 1
    this.connected = false
  }

  /**
   * Connects to the MCP SSE server
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) {
      throw new Error('Already connected. Call disconnect() first.')
    }

    const sseUrl = `http://${this.hostname}:${this.port}/sse`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout: sessionId not received within ${this.timeout}ms`))
      }, this.timeout)

      this.eventSource = new EventSource(sseUrl)

      // Listen for the endpoint event to get sessionId
      this.eventSource.addEventListener('endpoint', (event) => {
        try {
          const data = event.data
          const parsedUrl = new URL(data, sseUrl)
          this.sessionId = parsedUrl.searchParams.get('sessionId')
          
          if (!this.sessionId) {
            clearTimeout(timeout)
            reject(new Error('Failed to get sessionId from endpoint event'))
            return
          }

          clearTimeout(timeout)
          this.connected = true
          resolve()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      })

      // Handle incoming messages
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data && data.id && this.pendingRequests.has(data.id)) {
            const { resolve, reject } = this.pendingRequests.get(data.id)
            this.pendingRequests.delete(data.id)
            
            if (data.error) {
              reject(new Error(`MCP Error: ${data.error.message || JSON.stringify(data.error)}`))
            } else {
              resolve(data)
            }
          }
        } catch (err) {
          // Silently fail on parse errors for non-request messages
        }
      }

      this.eventSource.onerror = (error) => {
        clearTimeout(timeout)
        if (!this.connected) {
          reject(error)
        }
      }
    })
  }

  /**
   * Disconnects from the server
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this.sessionId = null
    this.connected = false
    this.pendingRequests.clear()
  }

  /**
   * Sends a JSON-RPC message to the server
   * @param {Object} messageObj - JSON-RPC message object
   * @returns {Promise<any>} Response from the server
   * @private
   */
  async sendMessage(messageObj) {
    if (!this.connected || !this.sessionId) {
      throw new Error('Not connected. Call connect() first.')
    }

    return new Promise((resolve, reject) => {
      // Set message ID if not provided
      if (!messageObj.id) {
        messageObj.id = this.messageIdCounter++
      }

      // Store the promise resolvers
      this.pendingRequests.set(messageObj.id, { resolve, reject })

      const requestBody = JSON.stringify(messageObj)
      const options = {
        hostname: this.hostname,
        port: this.port,
        path: `/messages?sessionId=${this.sessionId}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const error = this.pendingRequests.get(messageObj.id)
            if (error) {
              this.pendingRequests.delete(messageObj.id)
              error.reject(new Error(`HTTP Error ${res.statusCode}: ${data}`))
            }
          }
          // Response will come via SSE, not HTTP response body
        })
      })

      req.on('error', (err) => {
        const error = this.pendingRequests.get(messageObj.id)
        if (error) {
          this.pendingRequests.delete(messageObj.id)
          error.reject(err)
        }
      })

      req.write(requestBody)
      req.end()
    })
  }

  /**
   * Lists all available tools
   * @returns {Promise<Object>} List of tools
   */
  async listTools() {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
    })
    return response.result
  }

  /**
   * Calls a tool by name
   * @param {string} toolName - Name of the tool to call
   * @param {Object} args - Arguments to pass to the tool
   * @returns {Promise<any>} Tool result
   */
  async callTool(toolName, args = {}) {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    })
    return response.result
  }

  /**
   * Gets server info
   * @returns {Promise<Object>} Server information
   */
  async getInfo() {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'info',
      params: {},
    })
    return response.result
  }

  /**
   * Lists all available resources
   * @returns {Promise<Object>} List of resources
   */
  async listResources() {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'resources/list',
      params: {},
    })
    return response.result
  }

  /**
   * Reads a resource by URI
   * @param {string} uri - URI of the resource to read
   * @returns {Promise<Object>} Resource content
   */
  async readResource(uri) {
    const response = await this.sendMessage({
      jsonrpc: '2.0',
      method: 'resources/read',
      params: {
        uri: uri,
      },
    })
    return response.result
  }
}

/**
 * Convenience function to create and connect a client
 * @param {Object} options - Client options
 * @returns {Promise<McpClient>} Connected client
 */
async function createClient(options = {}) {
  const client = new McpClient(options)
  await client.connect()
  return client
}

// Export for ES modules
export {
  McpClient,
  createClient,
}

// Example usage when run directly:
// node testClient.js
// 
// For actual usage, import and use the client:
// import { createClient } from './client.js'
