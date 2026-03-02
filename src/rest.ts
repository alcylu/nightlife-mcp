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
      const result = await searchEvents(supabase, config, {
        city: str(req.query.city),
        date: str(req.query.date),
        genre: str(req.query.genre),
        area: str(req.query.area),
        query: str(req.query.query),
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/events/tonight
  router.get("/events/tonight", async (req, res) => {
    try {
      const result = await searchEvents(supabase, config, {
        city: str(req.query.city),
        date: "tonight",
        genre: str(req.query.genre),
        area: str(req.query.area),
        limit: num(req.query.limit),
        offset: num(req.query.offset),
      });
      res.json(result);
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
      res.json(result);
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
        limit: num(req.query.limit),
        offset: num(req.query.offset),
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
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // GET /api/v1/performers
  router.get("/performers", async (req, res) => {
    try {
      const sortBy = str(req.query.sort_by) as
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
      res.json(result);
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
      res.json(result);
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
      res.json(result);
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
