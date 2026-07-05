/**
 * Request-body wire scenarios (conformance input axis, r3). Each scenario
 * pins an OPTION set applied to both arms; the runner captures each engine's
 * first Messages API request body and fingerprints it. The official arm's
 * fingerprint becomes the committed reference target (wire-reference.json);
 * our arm is regression-checked against it (minus documented alignment gaps).
 *
 * Scope note: the request body is determined by OPTIONS + registered TOOLS,
 * not by what the model does - so the scenarios vary the option surface
 * (thinking, cache, tool set) rather than task content. One scripted reply
 * per scenario keeps it keyless and deterministic.
 *
 * Scenario shape:
 *   id                         - stable key (also the reference-target key)
 *   options                    - Options merged into BOTH arms
 *   buildOptions(sdk)          - per-arm option builder (MCP needs each arm's
 *                                own tool()/createSdkMcpServer); takes { sdk }
 *   notes                      - what this scenario probes
 */

export const WIRE_SCENARIOS = [
  {
    id: 'default',
    options: {},
    notes: 'shipped defaults: builtin tool set, engine-default thinking, caching on',
  },
  {
    id: 'thinking-off',
    options: { maxThinkingTokens: 0 },
    notes: 'thinking explicitly disabled - both arms should send no thinking block (or type off)',
  },
  {
    id: 'thinking-4096',
    options: { maxThinkingTokens: 4096 },
    notes: 'thinking pinned to an equal fixed budget on both arms (Fix-2 wire view)',
  },
  {
    id: 'cache-off',
    options: { provider: { promptCaching: false } },
    notes: 'prompt caching disabled - cache_control breakpoints should vanish from both arms',
  },
  {
    id: 'mcp-added',
    buildOptions: ({ sdk }) => ({
      mcpServers: {
        conf: sdk.createSdkMcpServer({
          name: 'conf',
          version: '1.0.0',
          tools: [
            sdk.tool('ping', 'Return a fixed marker.', {}, async () => ({
              content: [{ type: 'text', text: 'MCP-PING-OK' }],
            })),
          ],
        }),
      },
    }),
    notes: 'an in-process MCP server adds mcp__conf__ping to the advertised tool surface',
  },
];
