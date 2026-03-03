import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { VipDashboardAdminCredential } from "../config.js";

export type RequestWithDashboardAuth = Request & {
  dashboardAdminUsername?: string;
};

type DashboardSession = {
  username: string;
  expiresAtMs: number;
};

type DashboardAuthOptions = {
  admins: VipDashboardAdminCredential[];
  sessionTtlMinutes: number;
  sessionCookieName: string;
  secureCookies: boolean;
};

function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  return timingSafeEqual(aBytes, bBytes);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const chunk of header.split(";")) {
    const [name, ...valueParts] = chunk.split("=");
    const key = String(name || "").trim();
    if (!key) {
      continue;
    }

    const rawValue = valueParts.join("=").trim();
    if (!rawValue) {
      continue;
    }

    try {
      cookies.set(key, decodeURIComponent(rawValue));
    } catch {
      cookies.set(key, rawValue);
    }
  }

  return cookies;
}

function serializeCookie(name: string, value: string, attrs: {
  maxAgeSec?: number;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  secure?: boolean;
  path?: string;
}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (attrs.path) {
    parts.push(`Path=${attrs.path}`);
  }
  if (typeof attrs.maxAgeSec === "number") {
    parts.push(`Max-Age=${attrs.maxAgeSec}`);
  }
  if (attrs.httpOnly) {
    parts.push("HttpOnly");
  }
  if (attrs.sameSite) {
    parts.push(`SameSite=${attrs.sameSite}`);
  }
  if (attrs.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function createDashboardAuth(options: DashboardAuthOptions) {
  const sessions = new Map<string, DashboardSession>();
  const sessionTtlMs = Math.max(5, Math.floor(options.sessionTtlMinutes)) * 60 * 1000;

  function pruneExpired(nowMs = Date.now()): void {
    for (const [sessionId, session] of sessions.entries()) {
      if (session.expiresAtMs <= nowMs) {
        sessions.delete(sessionId);
      }
    }
  }

  function clearSessionCookie(res: Response): void {
    res.setHeader(
      "Set-Cookie",
      serializeCookie(options.sessionCookieName, "", {
        path: "/",
        maxAgeSec: 0,
        httpOnly: true,
        sameSite: "Strict",
        secure: options.secureCookies,
      }),
    );
  }

  function issueSessionCookie(res: Response, sessionId: string): void {
    res.setHeader(
      "Set-Cookie",
      serializeCookie(options.sessionCookieName, sessionId, {
        path: "/",
        maxAgeSec: Math.floor(sessionTtlMs / 1000),
        httpOnly: true,
        sameSite: "Strict",
        secure: options.secureCookies,
      }),
    );
  }

  function readSessionId(req: Request): string | null {
    const cookieHeader = req.headers.cookie as unknown;
    const headerValue = typeof cookieHeader === "string"
      ? cookieHeader
      : Array.isArray(cookieHeader)
        ? cookieHeader.join(";")
        : undefined;
    const cookies = parseCookies(headerValue);
    return cookies.get(options.sessionCookieName) || null;
  }

  function createSession(username: string): string {
    const sessionId = randomBytes(24).toString("base64url");
    sessions.set(sessionId, {
      username,
      expiresAtMs: Date.now() + sessionTtlMs,
    });
    return sessionId;
  }

  function destroySession(sessionId: string | null): void {
    if (!sessionId) {
      return;
    }
    sessions.delete(sessionId);
  }

  function authenticate(usernameRaw: string, passwordRaw: string): string | null {
    const username = String(usernameRaw || "").trim();
    const password = String(passwordRaw || "");
    if (!username || !password || options.admins.length === 0) {
      return null;
    }

    for (const admin of options.admins) {
      if (safeEqual(username, admin.username) && safeEqual(password, admin.password)) {
        return admin.username;
      }
    }

    return null;
  }

  function resolveSession(req: RequestWithDashboardAuth): { sessionId: string; username: string } | null {
    pruneExpired();
    const sessionId = readSessionId(req);
    if (!sessionId) {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.expiresAtMs <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    // Sliding expiration while active in dashboard.
    session.expiresAtMs = Date.now() + sessionTtlMs;
    sessions.set(sessionId, session);
    req.dashboardAdminUsername = session.username;

    return {
      sessionId,
      username: session.username,
    };
  }

  function requireApiSession(req: RequestWithDashboardAuth, res: Response, next: NextFunction): void {
    const session = resolveSession(req);
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Dashboard login required.",
        },
      });
      return;
    }

    issueSessionCookie(res, session.sessionId);
    next();
  }

  function requirePageSession(req: RequestWithDashboardAuth, res: Response, next: NextFunction): void {
    const session = resolveSession(req);
    if (!session) {
      clearSessionCookie(res);
      res.redirect("/ops/login");
      return;
    }

    issueSessionCookie(res, session.sessionId);
    next();
  }

  return {
    adminsConfigured: options.admins.length > 0,
    sessionCookieName: options.sessionCookieName,
    authenticate,
    createSession,
    destroySession,
    issueSessionCookie,
    clearSessionCookie,
    readSessionId,
    requireApiSession,
    requirePageSession,
  };
}
