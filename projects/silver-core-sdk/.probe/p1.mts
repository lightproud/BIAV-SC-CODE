import { DefaultMcpRegistry } from '../src/mcp/registry.js';
import { createSdkMcpServer, tool } from '../src/mcp/sdk-server.js';

const srvA = createSdkMcpServer({ name: 'a', tools: [tool('b__c', 'd', {}, async () => ({ content: [] }))] });
const srvAB = createSdkMcpServer({ name: 'a__b', tools: [tool('c', 'd', {}, async () => ({ content: [] }))] });
const reg = new DefaultMcpRegistry({ servers: { a: srvA, 'a__b': srvAB } });
await reg.connectAll();
console.log('allTools:', reg.allTools().map((t) => `${t.serverName} => ${t.qualifiedName}`));
console.log('has(mcp__a__b__c):', reg.has('mcp__a__b__c'));
