/**
 * example-hello — Demonstration BPT plugin.
 *
 * This plugin registers two simple tools:
 * 1. hello — Returns a greeting message
 * 2. current_time — Returns the current date/time
 *
 * It demonstrates the plugin API pattern:
 * - exports.activate(bpt) is called at load time
 * - bpt.registerTool() declares the tool schema
 * - bpt.registerToolHandler() provides the execution logic
 * - exports.execute() handles tool calls at runtime
 */

exports.activate = function (bpt) {
  bpt.log('info', 'example-hello plugin activating');

  // Register a greeting tool
  bpt.registerTool({
    name: 'hello',
    description: 'Returns a friendly greeting. Useful for testing the plugin system.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to greet', default: 'World' },
      },
      required: [],
    },
  });

  bpt.registerToolHandler('hello', function (input) {
    var name = input.name || 'World';
    return { message: 'Hello, ' + name + '! This response comes from the example-hello plugin.' };
  });

  // Register a current time tool
  bpt.registerTool({
    name: 'current_time',
    description: 'Returns the current date and time. Useful when the LLM needs to know the current time.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  });

  bpt.registerToolHandler('current_time', function () {
    var now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      timestamp: now.getTime(),
    };
  });

  bpt.log('info', 'example-hello plugin activated with 2 tools');
};
