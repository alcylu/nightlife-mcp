import { Router } from "express";
import type { Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorToHttpStatus, toNightlifeError } from "../errors.js";
import {
  createVipAdminBooking,
  getVipAdminBookingDetail,
  listVipAdminBookings,
  listVipAdminVenues,
  updateVipAdminBooking,
  type CreateVipAdminBookingInput,
  type UpdateVipAdminBookingPatch,
} from "../services/vipAdmin.js";
import type { VipBookingStatus } from "../types.js";
import type { RequestWithDashboardAuth } from "./dashboardAuth.js";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseStatusesCsv(value: unknown): VipBookingStatus[] | undefined {
  const raw = str(value);
  if (!raw) {
    return undefined;
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0) as VipBookingStatus[];
}

function sendError(res: Response, error: unknown): void {
  const nle = toNightlifeError(error);
  const status = errorToHttpStatus(nle.code);
  res.status(status).json({
    error: {
      code: nle.code,
      message: nle.message,
    },
  });
}

export function createVipAdminRouter(supabase: SupabaseClient): Router {
  const router = Router();

  router.post("/vip-bookings", async (req: RequestWithDashboardAuth, res) => {
    try {
      const body = (req.body || {}) as CreateVipAdminBookingInput;
      const result = await createVipAdminBooking(supabase, body);
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/vip-bookings", async (req: RequestWithDashboardAuth, res) => {
    try {
      const result = await listVipAdminBookings(supabase, {
        statuses: parseStatusesCsv(req.query.statuses),
        booking_date_from: str(req.query.booking_date_from),
        booking_date_to: str(req.query.booking_date_to),
        search: str(req.query.search),
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/vip-venues", async (_req: RequestWithDashboardAuth, res) => {
    try {
      const result = await listVipAdminVenues(supabase);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/vip-bookings/:id", async (req: RequestWithDashboardAuth, res) => {
    try {
      const result = await getVipAdminBookingDetail(supabase, String(req.params.id || ""));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/vip-bookings/:id", async (req: RequestWithDashboardAuth, res) => {
    try {
      const body = (req.body || {}) as {
        patch?: UpdateVipAdminBookingPatch;
        note?: string;
      };

      const result = await updateVipAdminBooking(supabase, {
        booking_request_id: String(req.params.id || ""),
        editor_username: req.dashboardAdminUsername || "dashboard",
        patch: body.patch || {},
        note: body.note,
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
