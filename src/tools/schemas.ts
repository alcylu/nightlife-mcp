import * as z from "zod/v4";

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
  nlt_url: z.string(),
});

export const cityUnavailableSchema = z.object({
  requested_city: z.string(),
  message: z.string(),
  available_cities: z.array(z.string()),
  request_city_url: z.string(),
});
