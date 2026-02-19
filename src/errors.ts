export type NightlifeErrorCode =
  | "INVALID_DATE_FILTER"
  | "INVALID_EVENT_ID"
  | "UNSUPPORTED_EVENT_ID"
  | "EVENT_NOT_FOUND"
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
