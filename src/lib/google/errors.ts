// src/lib/google/errors.ts
// Typed Drive API error classes for the import-drive route.
// Pure — no imports. Client-safe (no Node.js APIs).

export class DriveUnsupportedTypeError extends Error {
  constructor(public readonly mimeType: string) {
    super(`drive_unsupported_type: ${mimeType}`);
    this.name = 'DriveUnsupportedTypeError';
  }
}

export class DriveFileNotFoundError extends Error {
  constructor() {
    super('drive_file_not_found');
    this.name = 'DriveFileNotFoundError';
  }
}

export class DriveAccessDeniedError extends Error {
  constructor() {
    super('drive_access_denied');
    this.name = 'DriveAccessDeniedError';
  }
}
