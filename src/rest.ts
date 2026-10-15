import { Router } from "express";
import type { Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.js";
import { NightlifeError, errorToHttpStatus, toNightlifeError } from "./errors.js";
import { searchEvents, getEventDetails } from "./services/events.js";
import { searchVenues, getVenueInfo } from "./services/venues.js";
import { searchPerformers, getPerformerInfo } from "./services/performers.js";
import { getRecommendations } from "./services/recommendations.js";
import { listCities } from "./services/cities.js";
import { listGenres, listAreas } from "./services/helpers.js";
import { getVipPricing } from "./services/vipPricing.js";
import type { RequestWithAuth } from "./middleware/apiKeyAuth.js";
import type { ZodType } from "zod/v4";
import { publicSearchEventsOutputSchema, publicEventDetailSchema, publicRecommendationsOutputSchema } from "./tools/events.js";
import { publicSearchVenuesOutputSchema, publicVenueDetailSchema, proVenueDetailSchema } from "./tools/venues.js";
import { publicSearchPerformersOutputSchema, publicPerformerDetailSchema, proSearchPerformersOutputSchema, proPerformerDetailSchema } from "./tools/performers.js";

function isInternal(req: RequestWithAuth): boolean { return req.apiKeyTier === "ops"; }
function respond(res: Response, data: unknown, schema: ZodType, internal: boolean): void {
  res.json(internal ? data : schema.parse(data));
}
function assertPublicSort(internal: boolean, kind: "events" | "performers", value: unknown): void {
  if (internal || value === undefined) return;
  const allowed = kind === "events" ? ["date"] : ["alphabetical", "recent_activity"];
  if (!allowed.includes(String(value))) throw new NightlifeError("INVALID_REQUEST", `Public ${kind} sort_by must be ${allowed.join(" or ")}.`);
}

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

export function createRestRouter(
  config: AppConfig,
  supabase: SupabaseClient,
): Router {
  const router = Router();

  // GET /api/v1/events
  router.get("/events", async (req, res) => {
    try {
      assertPublicSort(isInternal(req), "events", req.query.sort_by);
      const result = await searchEvents(supabase, config, {
        city: str(req.query.city),
        date: str(req.query.date),
        genre: str(req.query.genre),
        area: str(req.query.area),
        query: str(req.query.query),
        seriesId: str(req.query.series_id),
        sort_by: str(req.query.sort_by) as "date" | "heat" | undefined,
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      respond(res, result, publicSearchEventsOutputSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/events/tonight
  router.get("/events/tonight", async (req, res) => {
    try {
      assertPublicSort(isInternal(req), "events", req.query.sort_by);
      const result = await searchEvents(supabase, config, {
        city: str(req.query.city),
        date: "tonight",
        genre: str(req.query.genre),
        area: str(req.query.area),
        seriesId: str(req.query.series_id),
        sort_by: str(req.query.sort_by) as "date" | "heat" | undefined,
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      respond(res, result, publicSearchEventsOutputSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/events/:id
  router.get("/events/:id", async (req, res) => {
    try {
      const result = await getEventDetails(supabase, config, req.params.id);
      if (!result) {
        res.status(404).json({
          error: { code: "EVENT_NOT_FOUND", message: "Event not found." },
        });
        return;
      }
      respond(res, result, publicEventDetailSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/venues
  router.get("/venues", async (req, res) => {
    try {
      const result = await searchVenues(supabase, config, {
        city: str(req.query.city),
        date: str(req.query.date),
        area: str(req.query.area),
        genre: str(req.query.genre),
        query: str(req.query.query),
        vip_booking_supported_only:
          str(req.query.vip_booking_supported_only) === "true" || undefined,
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      respond(res, result, publicSearchVenuesOutputSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/venues/:id/vip-pricing
  router.get("/venues/:id/vip-pricing", async (req, res) => {
    if (!isInternal(req)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not available in the public API." } });
      return;
    }
    try {
      const result = await getVipPricing(supabase, {
        venue_id: req.params.id,
        date: str(req.query.date),
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/venues/:id
  router.get("/venues/:id", async (req, res) => {
    try {
      const result = await getVenueInfo(supabase, config, req.params.id);
      if (!result) {
        res.status(404).json({
          error: { code: "VENUE_NOT_FOUND", message: "Venue not found." },
        });
        return;
      }
      respond(res, result, (req as RequestWithAuth).proProfiles ? proVenueDetailSchema : publicVenueDetailSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/performers
  router.get("/performers", async (req, res) => {
    try {
      assertPublicSort(isInternal(req), "performers", req.query.sort_by);
      const sortBy = (str(req.query.sort_by) ?? (isInternal(req) ? undefined : "alphabetical")) as
        | "popularity"
        | "recent_activity"
        | "alphabetical"
        | "rising_stars"
        | undefined;
      const result = await searchPerformers(supabase, config, {
        city: str(req.query.city),
        date: str(req.query.date),
        genre: str(req.query.genre),
        query: str(req.query.query),
        sort_by: sortBy,
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      respond(res, result, (req as RequestWithAuth).proProfiles ? proSearchPerformersOutputSchema : publicSearchPerformersOutputSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/performers/:id
  router.get("/performers/:id", async (req, res) => {
    try {
      const result = await getPerformerInfo(supabase, config, req.params.id);
      if (!result) {
        res.status(404).json({
          error: {
            code: "PERFORMER_NOT_FOUND",
            message: "Performer not found.",
          },
        });
        return;
      }
      respond(res, result, (req as RequestWithAuth).proProfiles ? proPerformerDetailSchema : publicPerformerDetailSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/recommendations
  router.get("/recommendations", async (req, res) => {
    try {
      const result = await getRecommendations(supabase, config, {
        city: str(req.query.city),
        date: str(req.query.date),
        area: str(req.query.area),
        genre: str(req.query.genre),
        query: str(req.query.query),
        limit: num(req.query.limit),
      });
      respond(res, result, publicRecommendationsOutputSchema, isInternal(req));
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/cities
  router.get("/cities", async (_req, res) => {
    try {
      const result = await listCities(supabase, config.topLevelCities);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/genres
  router.get("/genres", async (_req, res) => {
    try {
      const result = await listGenres(supabase);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/areas
  router.get("/areas", async (req, res) => {
    try {
      const result = await listAreas(supabase, config, str(req.query.city));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
