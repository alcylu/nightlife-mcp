import type { ModalTimeBucket } from "../types.js";

export interface RecommendationVector {
  energy: number;
  social: number;
  discovery: number;
  budget: number;
  timeBucket: ModalTimeBucket;
}

export interface DiversitySnapshot {
  area: string | null;
  primaryGenre: string | null;
  timeBucket: ModalTimeBucket;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function normalizedText(input: string[]): string {
  return input.map((value) => value.toLowerCase()).join(" ");
}

const HIGH_ENERGY_KEYWORDS = [
  "techno",
  "edm",
  "electro",
  "hardstyle",
  "trance",
  "drum",
  "bass",
  "house",
  "disco",
  "hip hop",
  "hip-hop",
  "rap",
  "punk",
  "hardcore",
  "metal",
];

const LOW_ENERGY_KEYWORDS = [
  "ambient",
  "chill",
  "downtempo",
  "lounge",
  "jazz",
  "acoustic",
];

const HIGH_SOCIAL_KEYWORDS = [
  "party",
  "salsa",
  "bachata",
  "latin",
  "disco",
  "hip hop",
  "hip-hop",
  "r&b",
  "edm",
  "pop",
  "drag",
];

const HIGH_DISCOVERY_KEYWORDS = [
  "experimental",
  "ambient",
  "avant",
  "noise",
  "underground",
  "leftfield",
  "indie",
  "diy",
];

const LOW_DISCOVERY_KEYWORDS = [
  "mainstream",
  "chart",
  "commercial",
  "top 40",
  "festival",
];

function parseHourInTimeZone(dateIso: string, timeZone: string): number | null {
  if (!dateIso) {
    return null;
  }
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });

  const values = formatter.formatToParts(date);
  const hourPart = values.find((part) => part.type === "hour");
  if (!hourPart) {
    return null;
  }
  const hour = Number(hourPart.value);
  return Number.isFinite(hour) ? hour : null;
}

export function toTimeBucket(dateIso: string, timeZone: string): ModalTimeBucket {
  const hour = parseHourInTimeZone(dateIso, timeZone);
  if (hour === null) {
    return "prime";
  }
  if (hour >= 21 && hour <= 23) {
    return "prime";
  }
  if (hour >= 18 && hour <= 20) {
    return "early";
  }
  if (hour >= 0 && hour <= 5) {
    return "late";
  }
  return "early";
}

export function deriveEnergyScore(genres: string[], name: string, performerCount: number): number {
  const text = `${name.toLowerCase()} ${normalizedText(genres)}`;
  let score = 3;
  if (includesAny(text, HIGH_ENERGY_KEYWORDS)) {
    score += 1.5;
  }
  if (includesAny(text, LOW_ENERGY_KEYWORDS)) {
    score -= 1.5;
  }
  if (performerCount >= 8) {
    score += 0.5;
  }
  return Math.round(clamp(score, 1, 5));
}

export function deriveSocialScore(genres: string[], name: string, performerCount: number): number {
  const text = `${name.toLowerCase()} ${normalizedText(genres)}`;
  let score = 2.5;
  if (includesAny(text, HIGH_SOCIAL_KEYWORDS)) {
    score += 1.5;
  }
  if (performerCount >= 6) {
    score += 0.5;
  }
  return Math.round(clamp(score, 1, 5));
}

export function deriveDiscoveryScore(genres: string[], name: string, featured: boolean): number {
  const text = `${name.toLowerCase()} ${normalizedText(genres)}`;
  let score = 3;
  if (includesAny(text, HIGH_DISCOVERY_KEYWORDS)) {
    score += 1.5;
  }
  if (includesAny(text, LOW_DISCOVERY_KEYWORDS)) {
    score -= 1.5;
  }
  if (featured) {
    score -= 0.5;
  }
  return Math.round(clamp(score, 1, 5));
}

function parsePriceAmount(priceText: string | null): number | null {
  if (!priceText) {
    return null;
  }
  const normalized = priceText.replace(/,/g, "");
  const numbers = normalized.match(/\d{3,6}/g);
  if (!numbers || numbers.length === 0) {
    return null;
  }
  const parsed = Number(numbers[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveBudgetScore(priceText: string | null): number {
  const raw = String(priceText || "").toLowerCase();
  if (raw.includes("vip") || raw.includes("premium")) {
    return 5;
  }

  const amount = parsePriceAmount(priceText);
  if (amount === null) {
    return 3;
  }
  if (amount <= 2000) {
    return 2;
  }
  if (amount <= 4000) {
    return 3;
  }
  if (amount <= 7000) {
    return 4;
  }
  return 5;
}

export function deriveQualityScore(input: {
  featured: boolean;
  performerCount: number;
  ticketTierCount: number;
  guestListStatus: "available" | "full" | "closed" | null;
  hasFlyer: boolean;
  eventDate: string;
  now?: Date;
}): number {
  const now = input.now || new Date();
  const eventDate = new Date(input.eventDate);

  const featuredScore = input.featured ? 1 : 0.45;
  const lineupScore = clamp(input.performerCount / 8, 0, 1);
  const ticketScore = clamp(input.ticketTierCount / 4, 0, 1);
  const guestScore = input.guestListStatus === "available"
    ? 1
    : input.guestListStatus === "full"
      ? 0.7
      : 0.4;
  const mediaScore = input.hasFlyer ? 1 : 0.55;

  let freshnessScore = 0.5;
  if (!Number.isNaN(eventDate.getTime())) {
    const diffHours = (eventDate.getTime() - now.getTime()) / 3600000;
    if (diffHours >= 0 && diffHours <= 48) {
      freshnessScore = 1;
    } else if (diffHours > 48 && diffHours <= 96) {
      freshnessScore = 0.8;
    } else if (diffHours < 0) {
      freshnessScore = 0.3;
    }
  }

  return clamp(
    (featuredScore * 0.25) +
      (lineupScore * 0.2) +
      (ticketScore * 0.2) +
      (guestScore * 0.1) +
      (mediaScore * 0.1) +
      (freshnessScore * 0.15),
    0,
    1,
  );
}

function timeBucketIndex(bucket: ModalTimeBucket): number {
  switch (bucket) {
    case "early":
      return 0;
    case "prime":
      return 1;
    case "late":
      return 2;
  }
}

export function timePenalty(
  current: ModalTimeBucket,
  target: ModalTimeBucket,
): number {
  return Math.abs(timeBucketIndex(current) - timeBucketIndex(target));
}

export function modalDistance(
  vector: RecommendationVector,
  target: RecommendationVector,
): number {
  return (
    Math.abs(vector.energy - target.energy) +
    Math.abs(vector.social - target.social) +
    Math.abs(vector.discovery - target.discovery) +
    Math.abs(vector.budget - target.budget) +
    timePenalty(vector.timeBucket, target.timeBucket)
  );
}

export function modalFit(distance: number): number {
  return clamp(1 - distance / 10, 0, 1);
}

export function diversityScore(
  candidate: DiversitySnapshot,
  selected: DiversitySnapshot[],
): number {
  if (selected.length === 0) {
    return 1;
  }

  const usedAreas = new Set(
    selected
      .map((item) => item.area?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const usedGenres = new Set(
    selected
      .map((item) => item.primaryGenre?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  const usedBuckets = new Set(selected.map((item) => item.timeBucket));

  const areaScore = candidate.area
    ? (usedAreas.has(candidate.area.trim().toLowerCase()) ? 0.2 : 1)
    : 0.5;
  const genreScore = candidate.primaryGenre
    ? (usedGenres.has(candidate.primaryGenre.trim().toLowerCase()) ? 0.2 : 1)
    : 0.5;
  const bucketScore = usedBuckets.has(candidate.timeBucket) ? 0.3 : 1;

  return clamp((areaScore * 0.4) + (genreScore * 0.4) + (bucketScore * 0.2), 0, 1);
}

export function preferenceBoost(input: {
  preferredArea?: string;
  preferredGenre?: string;
  query?: string;
  area: string | null;
  genres: string[];
  name: string;
  performers: string[];
}): number {
  let score = 0;

  const areaNeedle = String(input.preferredArea || "").trim().toLowerCase();
  if (areaNeedle && input.area?.toLowerCase().includes(areaNeedle)) {
    score += 0.45;
  }

  const genreNeedle = String(input.preferredGenre || "").trim().toLowerCase();
  if (genreNeedle && input.genres.some((genre) => genre.toLowerCase().includes(genreNeedle))) {
    score += 0.45;
  }

  const queryNeedle = String(input.query || "").trim().toLowerCase();
  if (queryNeedle) {
    const haystack = [
      input.name,
      ...input.genres,
      ...input.performers,
      input.area || "",
    ]
      .join(" ")
      .toLowerCase();
    if (haystack.includes(queryNeedle)) {
      score += 0.35;
    }
  }

  return clamp(score, 0, 1);
}
