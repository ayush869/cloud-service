import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain error with a stable machine-readable code, rendered as
 * { success: false, error: { code, message, details? } }.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  notFound: (resource: string) =>
    new AppException(`${resource.toUpperCase()}_NOT_FOUND`, `${capitalize(resource)} not found`, HttpStatus.NOT_FOUND),
  unauthorized: (message = 'Authentication required') =>
    new AppException('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED),
  forbidden: (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
    new AppException(code, message, HttpStatus.FORBIDDEN),
  conflict: (code: string, message: string) => new AppException(code, message, HttpStatus.CONFLICT),
  badRequest: (code: string, message: string, details?: unknown) =>
    new AppException(code, message, HttpStatus.BAD_REQUEST, details),
  validation: (message: string, details?: unknown) =>
    new AppException('VALIDATION_ERROR', message, HttpStatus.BAD_REQUEST, details),
  quotaExceeded: () =>
    new AppException('QUOTA_EXCEEDED', 'Storage quota exceeded', HttpStatus.PAYLOAD_TOO_LARGE),
  fileTooLarge: (max: number) =>
    new AppException('FILE_TOO_LARGE', `File exceeds the maximum allowed size of ${max} bytes`, HttpStatus.PAYLOAD_TOO_LARGE),
  unsupportedType: (message: string) =>
    new AppException('UNSUPPORTED_FILE_TYPE', message, HttpStatus.UNPROCESSABLE_ENTITY),
};

function capitalize(s: string): string {
  const words = s.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
