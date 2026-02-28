type ToolCounter = {
  calls: number;
  errors: number;
  totalDurationMs: number;
  lastDurationMs: number;
  lastErrorCode: string | null;
};

type HttpCounter = {
  requests: number;
  byMethod: Record<string, number>;
  byStatusClass: Record<string, number>;
  auth: {
    success: number;
    denied: number;
  };
};

type UnmetRequestCounter = {
  attempts: number;
  success: number;
  errors: number;
};

const startedAt = Date.now();

const toolCounters = new Map<string, ToolCounter>();
const httpCounter: HttpCounter = {
  requests: 0,
  byMethod: {},
  byStatusClass: {},
  auth: {
    success: 0,
    denied: 0,
  },
};

const unmetRequestCounter: UnmetRequestCounter = {
  attempts: 0,
  success: 0,
  errors: 0,
};

function getToolCounter(name: string): ToolCounter {
  const current = toolCounters.get(name);
  if (current) {
    return current;
  }

  const initial: ToolCounter = {
    calls: 0,
    errors: 0,
    totalDurationMs: 0,
    lastDurationMs: 0,
    lastErrorCode: null,
  };
  toolCounters.set(name, initial);
  return initial;
}

export function recordToolResult(input: {
  tool: string;
  durationMs: number;
  errorCode?: string;
}): void {
  const counter = getToolCounter(input.tool);
  counter.calls += 1;
  counter.totalDurationMs += input.durationMs;
  counter.lastDurationMs = input.durationMs;
  if (input.errorCode) {
    counter.errors += 1;
    counter.lastErrorCode = input.errorCode;
  } else {
    counter.lastErrorCode = null;
  }
}

export function recordHttpRequest(input: {
  method: string;
  statusCode: number;
}): void {
  const method = input.method.toUpperCase();
  const statusClass = `${Math.floor(input.statusCode / 100)}xx`;
  httpCounter.requests += 1;
  httpCounter.byMethod[method] = (httpCounter.byMethod[method] || 0) + 1;
  httpCounter.byStatusClass[statusClass] = (httpCounter.byStatusClass[statusClass] || 0) + 1;
}

export function recordHttpAuthResult(allowed: boolean): void {
  if (allowed) {
    httpCounter.auth.success += 1;
    return;
  }
  httpCounter.auth.denied += 1;
}

export function recordUnmetRequestWrite(success: boolean): void {
  unmetRequestCounter.attempts += 1;
  if (success) {
    unmetRequestCounter.success += 1;
    return;
  }
  unmetRequestCounter.errors += 1;
}

export function snapshotRuntimeMetrics(): {
  uptimeSec: number;
  tools: Record<string, ToolCounter & { avgDurationMs: number }>;
  http: HttpCounter;
  unmet_requests: UnmetRequestCounter;
} {
  const tools: Record<string, ToolCounter & { avgDurationMs: number }> = {};
  for (const [name, counter] of toolCounters.entries()) {
    tools[name] = {
      ...counter,
      avgDurationMs: counter.calls > 0
        ? Math.round((counter.totalDurationMs / counter.calls) * 100) / 100
        : 0,
    };
  }

  return {
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    tools,
    http: {
      requests: httpCounter.requests,
      byMethod: { ...httpCounter.byMethod },
      byStatusClass: { ...httpCounter.byStatusClass },
      auth: {
        success: httpCounter.auth.success,
        denied: httpCounter.auth.denied,
      },
    },
    unmet_requests: {
      attempts: unmetRequestCounter.attempts,
      success: unmetRequestCounter.success,
      errors: unmetRequestCounter.errors,
    },
  };
}

export function logEvent(
  event: string,
  fields: Record<string, unknown>,
): void {
  console.error(`[nightlife-mcp] ${event} ${JSON.stringify(fields)}`);
}
