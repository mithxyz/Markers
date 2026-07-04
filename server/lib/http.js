/** Wrap an async route handler so rejections reach the Express error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Throwable error carrying an HTTP status + client-safe message. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}

export const badRequest = (msg = 'Bad request') => new ApiError(400, msg);
export const unauthorized = (msg = 'Not authenticated') => new ApiError(401, msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const conflict = (msg = 'Conflict') => new ApiError(409, msg);
