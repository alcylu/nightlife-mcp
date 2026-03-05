export type NightlifeErrorCode =
  | "INVALID_DATE_FILTER"
  | "INVALID_EVENT_ID"
  | "UNSUPPORTED_EVENT_ID"
  | "EVENT_NOT_FOUND"
  | "INVALID_VENUE_ID"
  | "VENUE_NOT_FOUND"
  | "INVALID_PERFORMER_ID"
  | "PERFORMER_NOT_FOUND"
  | "INVALID_BOOKING_REQUEST"
  | "BOOKING_REQUEST_NOT_FOUND"
  | "BOOKING_STATUS_UPDATE_FAILED"
  | "VIP_TASK_NOT_AVAILABLE"
  | "VIP_ALERT_UPDATE_FAILED"
  | "VIP_CLAIM_FAILED"
  | "INVALID_REQUEST"
  | "REQUEST_WRITE_FAILED"
  | "GUEST_LIST_NOT_AVAILABLE"
  | "GUEST_LIST_DUPLICATE"
  | "GUEST_LIST_ENTRY_NOT_FOUND"
  | "DEPOSIT_CREATION_FAILED"
  | "DEPOSIT_NOT_FOUND"
  | "DEPOSIT_REFUND_FAILED"
  | "STRIPE_ERROR"
  | "DB_QUERY_FAILED"
  | "INTERNAL_ERROR";

export class NightlifeError extends Error {
  readonly code: NightlifeErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: NightlifeErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "NightlifeError";
    this.code = code;
    this.details = details;
  }
}

export function toNightlifeError(
  error: unknown,
  fallbackCode: NightlifeErrorCode = "INTERNAL_ERROR",
): NightlifeError {
  if (error instanceof NightlifeError) {
    return error;
  }

  if (error instanceof Error) {
    return new NightlifeError(fallbackCode, error.message);
  }

  return new NightlifeError(fallbackCode, "Unknown error");
}

export function errorToHttpStatus(code: NightlifeErrorCode): number {
  switch (code) {
    case "INVALID_DATE_FILTER":
    case "INVALID_EVENT_ID":
    case "UNSUPPORTED_EVENT_ID":
    case "INVALID_VENUE_ID":
    case "INVALID_PERFORMER_ID":
    case "INVALID_REQUEST":
    case "INVALID_BOOKING_REQUEST":
      return 400;
    case "EVENT_NOT_FOUND":
    case "VENUE_NOT_FOUND":
    case "PERFORMER_NOT_FOUND":
    case "BOOKING_REQUEST_NOT_FOUND":
    case "GUEST_LIST_ENTRY_NOT_FOUND":
    case "DEPOSIT_NOT_FOUND":
      return 404;
    case "GUEST_LIST_NOT_AVAILABLE":
    case "GUEST_LIST_DUPLICATE":
      return 409;
    default:
      return 500;
  }
}

export function toolErrorResponse(
  error: NightlifeError,
): { error: { code: NightlifeErrorCode; message: string } } {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  };
}
