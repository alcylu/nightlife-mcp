## What changed

<!-- 1-3 sentences. Link the bug or context. -->

## How to verify

<!-- Steps a reviewer can run. Include commands or "verified manually with Claude Desktop / WebMCP". -->

## Pre-merge checklist

- [ ] `npm test` passes locally
- [ ] If this fixes a bug: added a regression test
- [ ] If this adds a new MCP tool: at least one test covering response shape and auth
- [ ] If this changes the tool surface: noted which downstream consumers (`nightlife` consumer site, `nlt-admin`) are affected
- [ ] If a test wasn't possible: explained why above
