function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function buildEventUrl(
  baseUrl: string,
  citySlug: string,
  eventId: string,
): string {
  return `${trimTrailingSlash(baseUrl)}/${citySlug}/events/${eventId}`;
}

export function buildVenueUrl(
  baseUrl: string,
  citySlug: string,
  venueId: string,
): string {
  return `${trimTrailingSlash(baseUrl)}/${citySlug}/venues/${venueId}`;
}

export function buildPerformerUrl(
  baseUrl: string,
  citySlug: string,
  slugOrId: string,
  performerType?: string | null,
): string {
  const segmentByType: Record<string, string> = {
    DJ: "djs",
    Dancer: "dancers",
    "Live Act": "live-acts",
    "Visual Artist": "visual-artists",
    Other: "others",
    Rapper: "rappers",
    Singer: "singers",
    Band: "bands",
    Photographer: "photographers",
    Videographer: "videographers",
  };
  const segment = (performerType && segmentByType[performerType]) || "djs";
  return `${trimTrailingSlash(baseUrl)}/${citySlug}/${segment}/${slugOrId}`;
}
