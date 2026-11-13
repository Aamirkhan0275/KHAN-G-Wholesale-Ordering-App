export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export const bad = (code: string, details?: unknown) => new ApiError(400, code, code, details);
export const forbidden = (code = 'forbidden') => new ApiError(403, code);
export const notFound = (code = 'not_found') => new ApiError(404, code);
export const conflict = (code: string) => new ApiError(409, code);

/** Map PostgreSQL errors to safe API errors. Never leak SQL or row data. */
export function fromPgError(err: any): ApiError | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const msg: string = String(err.message ?? '');
  switch (err.code) {
    case '42501':
      return new ApiError(403, msg.startsWith('role') || msg.startsWith('protected') ? msg : 'forbidden');
    case '22023': {
      const [code, detail] = msg.split(':');
      return new ApiError(400, code, code, detail ? { productId: detail } : undefined);
    }
    case 'P0002':
      return new ApiError(404, 'not_found');
    case '23505':
      return new ApiError(409, 'duplicate', 'duplicate', { constraint: err.constraint_name });
    case '23514':
    case '22P02':
    case '22001':
    case '23502':
    case '22003':
      return new ApiError(400, 'invalid_input', 'invalid_input', { constraint: err.constraint_name });
    case '23503':
      return new ApiError(409, 'in_use');
    default:
      return null;
  }
}
