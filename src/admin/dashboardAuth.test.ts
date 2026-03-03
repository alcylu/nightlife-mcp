import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardAuth } from "./dashboardAuth.js";

type MockRes = {
  headers: Record<string, string>;
  statusCode: number;
  payload: unknown;
  redirectLocation: string | null;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => MockRes;
  json: (payload: unknown) => void;
  redirect: (path: string) => void;
};

function createMockRes(): MockRes {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    redirectLocation: null,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
    },
    redirect(path: string) {
      this.redirectLocation = path;
    },
  };
}

test("dashboard auth authenticates configured admin credentials", () => {
  const auth = createDashboardAuth({
    admins: [{ username: "ops", password: "secret" }],
    sessionTtlMinutes: 30,
    sessionCookieName: "vip_dashboard_session",
    secureCookies: false,
  });

  assert.equal(auth.authenticate("ops", "secret"), "ops");
  assert.equal(auth.authenticate("ops", "wrong"), null);
  assert.equal(auth.authenticate("", "secret"), null);
});

test("requireApiSession allows valid session and sets dashboard user", () => {
  const auth = createDashboardAuth({
    admins: [{ username: "ops", password: "secret" }],
    sessionTtlMinutes: 30,
    sessionCookieName: "vip_dashboard_session",
    secureCookies: false,
  });

  const sessionId = auth.createSession("ops");
  const req = {
    headers: {
      cookie: `vip_dashboard_session=${sessionId}`,
    },
  } as any;
  const res = createMockRes();

  let calledNext = false;
  auth.requireApiSession(req, res as any, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(req.dashboardAdminUsername, "ops");
  assert.match(String(res.headers["Set-Cookie"] || ""), /vip_dashboard_session=/);
});

test("requireApiSession blocks missing session", () => {
  const auth = createDashboardAuth({
    admins: [{ username: "ops", password: "secret" }],
    sessionTtlMinutes: 30,
    sessionCookieName: "vip_dashboard_session",
    secureCookies: false,
  });

  const req = { headers: {} } as any;
  const res = createMockRes();
  let calledNext = false;

  auth.requireApiSession(req, res as any, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, {
    error: {
      code: "UNAUTHORIZED",
      message: "Dashboard login required.",
    },
  });
});
