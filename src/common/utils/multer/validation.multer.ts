import { Request } from "express";
import { FileFilterCallback } from "multer";
import { BadRequestException } from "../../exceptions";

export const fileFieldValidation = {
  image: ["image/jpeg", "image/png", "image/jpg", "image/webp"],
  video: ["video/mp4", "video/mpeg", "video/quicktime"],
  audio: ["audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  excel: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ],
  powerpoint: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ],
  zip: [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
  ],
};

export const fileFilter = (validation: string[] = []) => {
  return function (req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
    if (!validation.includes(file.mimetype)) {
      return cb(new BadRequestException("Invalid file format"));
    }
    return cb(null, true);
  };
};

/**
 * Sanitizes original filenames to prevent path traversal, control characters,
 * or unsafe characters in headers and S3 keys.
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== "string") return "file";
  return (
    name
      .trim()
      .replace(/[/\\]+/g, "_")
      .replace(/[\r\n\0]/g, "")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-100) || "file"
  );
}

/**
 * Inspects binary buffer headers (magic bytes) to verify the actual file format
 * rather than blindly trusting client-supplied Content-Type or file extension.
 */
export function detectBufferMimeType(buffer: Buffer): string | null {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  // JPEG: Starts with FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: Starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: Starts with GIF87a or GIF89a (47 49 46 38)
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP: RIFF (52 49 46 46) + 4 bytes size + WEBP (57 45 42 50)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // PDF: %PDF (25 50 44 46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  // MP4: offset 4 is "ftyp" (66 74 79 70)
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return "video/mp4";
  }

  return null;
}
