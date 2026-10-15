import * as z from "zod/v4";

export const eventHeatSchema = z.object({
  score: z.number(),
  level: z.enum(["hot", "warm", "quiet"]),
  confidence: z.enum(["high", "medium", "low"]),
  top_signal: z.enum(["tickets", "gl", "ra", "ig"]).nullable(),
  signals: z.object({
    tickets: z.number().optional(),
    gl: z.number().optional(),
    ra: z.number().optional(),
    ig: z.number().optional(),
  }),
  raw: z.object({
    tickets: z.number().optional(),
    gl: z.number().optional(),
    ra: z.number().optional(),
    ig: z.number().optional(),
  }),
  updated_at: z.string().nullable(),
});

export const eventMediaItemSchema = z.object({
  media_url: z.string(),
  media_type: z.string(),
  is_primary: z.boolean(),
  display_order: z.number(),
  thumbnail_url: z.string().nullable(),
  title: z.string().nullable(),
});

export const eventSummarySchema = z.object({
  event_id: z.string(),
  name: z.string(),
  date: z.string(),
  service_date: z.string().nullable(),
  venue: z.object({
    id: z.string(),
    name: z.string(),
    area: z.string().nullable(),
  }),
  performers: z.array(z.string()),
  genres: z.array(z.string()),
  price: z.string().nullable(),
  flyer_url: z.string().nullable(),
  heat: eventHeatSchema.nullable(),
  event_media: z.array(eventMediaItemSchema),
  nlt_url: z.string(),
});

// Public transport contract; internal services retain the complete event model.
export const publicEventSummarySchema = eventSummarySchema.omit({ heat: true });

export const cityUnavailableSchema = z.object({
  requested_city: z.string(),
  message: z.string(),
  available_cities: z.array(z.string()),
  request_city_url: z.string(),
});
