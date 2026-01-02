import { McpClient, createClient } from './client.js';
import { fileURLToPath } from 'url';
import { argv } from 'process';

// Check if this module is being run directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

// Example usage - create and connect directly
async function main() {
  try {
    const client = await createClient({ hostname: 'localhost', port: 3001 });
    console.log('Connected to MCP server');
    
    // List available tools
    const tools = await client.listTools();
    //console.log('Available tools:', tools);
    
    // Example: Call a tool if available
    if (tools.tools && tools.tools.length > 0) {
      const result = await client.callTool('docs', { product: 'sf', 
        paths: ['../../../../../../../../../../etc/passwd','../..'] });
      console.log('Tool result:', result);
    }
    
    await client.disconnect();
    console.log('\nDisconnected from MCP server');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run main function if executed directly
if (isMainModule) {
  main();
}
