// MCP connection setup, discovery, notifications and keep-alives are unmetered.
// REST's authenticated data endpoints count one request each.
export function isBillableMcpRequest(method: string, body: unknown): boolean {
  return method === "POST" && !!body && typeof body === "object" &&
    "method" in body && body.method === "tools/call";
}
