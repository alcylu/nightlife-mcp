import { createHash, timingSafeEqual } from "node:crypto";

export function extractApiKeyFromHeaders(headers: Record<string, unknown>): string | null {
  const xApiKey = headerValue(headers["x-api-key"]);
  if (xApiKey) {
    return xApiKey;
  }

  const authHeader = headerValue(headers.authorization);
  if (!authHeader) {
    return null;
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearer) {
    return null;
  }

  const token = bearer[1]?.trim();
  return token || null;
}

function headerValue(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(raw)) {
    const first = raw.find((value) => typeof value === "string" && value.trim().length > 0);
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

export function keyFingerprint(key: string): string {
  const digest = hashApiKey(key);
  return digest.slice(0, 12);
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isApiKeyAllowed(candidate: string, allowedKeys: string[]): boolean {
  const candidateBytes = Buffer.from(candidate);

  return allowedKeys.some((key) => {
    const keyBytes = Buffer.from(key);
    if (keyBytes.length !== candidateBytes.length) {
      return false;
    }
    return timingSafeEqual(candidateBytes, keyBytes);
  });
}
