import { fromZonedTime } from "date-fns-tz";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ParsedDateFilter {
  label: string;
  startServiceDate: string;
  endServiceDateExclusive: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const values = new Map<string, string>();
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values.set(part.type, part.value);
    }
  }

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
  };
}

function toIsoDateUtc(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(serviceDate: string): number {
  return new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
}

function parseCutoff(cutoff: string): { hour: number; minute: number } {
  const normalized = normalizeCutoffTime(cutoff);
  const match = HH_MM_RE.exec(normalized);
  if (!match) {
    return { hour: 6, minute: 0 };
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function normalizeCutoffTime(cutoff: string | null | undefined): string {
  if (!cutoff) {
    return "06:00";
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.exec(cutoff.trim());
  if (!match) {
    return "06:00";
  }
  return `${match[1]}:${match[2]}`;
}

export function addDaysToIsoDate(serviceDate: string, days: number): string {
  const d = new Date(`${serviceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getCurrentServiceDate(
  now: Date,
  timeZone: string,
  cutoffTime: string,
): string {
  const zoned = getZonedParts(now, timeZone);
  const { hour: cutoffHour, minute: cutoffMinute } = parseCutoff(cutoffTime);
  const today = toIsoDateUtc(zoned.year, zoned.month, zoned.day);

  const beforeCutoff =
    zoned.hour < cutoffHour ||
    (zoned.hour === cutoffHour && zoned.minute < cutoffMinute);

  return beforeCutoff ? addDaysToIsoDate(today, -1) : today;
}

export function serviceDateWindowToUtc(
  startServiceDate: string,
  endServiceDateExclusive: string,
  timeZone: string,
  cutoffTime: string,
): { startIso: string; endIso: string } {
  const cutoff = normalizeCutoffTime(cutoffTime);
  const startIso = fromZonedTime(
    `${startServiceDate}T${cutoff}:00`,
    timeZone,
  ).toISOString();
  const endIso = fromZonedTime(
    `${endServiceDateExclusive}T${cutoff}:00`,
    timeZone,
  ).toISOString();

  return { startIso, endIso };
}

function parseIsoDateRange(value: string): ParsedDateFilter {
  const [startRaw, endRaw] = value.split("/");
  if (!startRaw || !endRaw || !ISO_DATE_RE.test(startRaw) || !ISO_DATE_RE.test(endRaw)) {
    throw new Error(
      "Invalid date range format. Use YYYY-MM-DD/YYYY-MM-DD.",
    );
  }

  if (startRaw > endRaw) {
    throw new Error("Date range start must be before or equal to end.");
  }

  return {
    label: value,
    startServiceDate: startRaw,
    endServiceDateExclusive: addDaysToIsoDate(endRaw, 1),
  };
}

function thisWeekendRange(currentServiceDate: string): ParsedDateFilter {
  const dow = dayOfWeek(currentServiceDate);
  let friday = currentServiceDate;

  if (dow >= 1 && dow <= 4) {
    friday = addDaysToIsoDate(currentServiceDate, 5 - dow);
  } else if (dow === 6) {
    friday = addDaysToIsoDate(currentServiceDate, -1);
  } else if (dow === 0) {
    friday = addDaysToIsoDate(currentServiceDate, -2);
  }

  return {
    label: "this_weekend",
    startServiceDate: friday,
    endServiceDateExclusive: addDaysToIsoDate(friday, 3),
  };
}

export function parseDateFilter(
  dateFilter: string | undefined,
  now: Date,
  timeZone: string,
  cutoffTime: string,
): ParsedDateFilter | undefined {
  if (!dateFilter) {
    return undefined;
  }

  const value = dateFilter.trim().toLowerCase();
  const currentServiceDate = getCurrentServiceDate(now, timeZone, cutoffTime);

  if (value === "tonight") {
    return {
      label: "tonight",
      startServiceDate: currentServiceDate,
      endServiceDateExclusive: addDaysToIsoDate(currentServiceDate, 1),
    };
  }

  if (value === "this_weekend") {
    return thisWeekendRange(currentServiceDate);
  }

  if (value.includes("/")) {
    return parseIsoDateRange(value);
  }

  if (ISO_DATE_RE.test(value)) {
    return {
      label: value,
      startServiceDate: value,
      endServiceDateExclusive: addDaysToIsoDate(value, 1),
    };
  }

  throw new Error(
    "Invalid date filter. Use 'tonight', 'this_weekend', 'YYYY-MM-DD', or 'YYYY-MM-DD/YYYY-MM-DD'.",
  );
}

export function isCutoffPassedForServiceDate(
  now: Date,
  serviceDate: string,
  timeZone: string,
  cutoffTime: string,
): boolean {
  const currentServiceDate = getCurrentServiceDate(now, timeZone, cutoffTime);

  if (serviceDate < currentServiceDate) {
    return true;
  }
  if (serviceDate > currentServiceDate) {
    return false;
  }

  const zoned = getZonedParts(now, timeZone);
  const { hour: cutoffHour, minute: cutoffMinute } = parseCutoff(cutoffTime);
  return (
    zoned.hour > cutoffHour ||
    (zoned.hour === cutoffHour && zoned.minute >= cutoffMinute)
  );
}

