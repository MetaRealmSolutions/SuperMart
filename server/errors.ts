export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'MODULE_DISABLED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'STOCK_BLOCKED'
  | 'PAYMENT_FAILED'
  | 'INVALID_STATE'
  | 'APPROVAL_REQUIRED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get httpStatus(): number {
    switch (this.code) {
      case 'UNAUTHENTICATED':
        return 401;
      case 'FORBIDDEN':
      case 'MODULE_DISABLED':
      case 'APPROVAL_REQUIRED':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'INTERNAL':
        return 500;
      case 'CONFLICT':
      case 'INVALID_STATE':
        return 409;
      default:
        return 400;
    }
  }
}

export const fail = (code: ErrorCode, message: string, details?: unknown): never => {
  throw new AppError(code, message, details);
};
