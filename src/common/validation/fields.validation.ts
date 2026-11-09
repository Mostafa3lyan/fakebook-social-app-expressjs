import { z } from "zod";
import { calculateAge } from "../utils";
import { Types } from "mongoose";

const MIN_AGE = 13;

/**
 * Zod primitives shared across modules. Compose them with `.optional()`,
 * `.default()`, `.extend()`, ... at the call site.
 */

export const email = z.email("invalid email address");

export const password = z.string("password is required").min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,30}$/);

export const otp = z.string("otp is required").length(6).regex(/^\d+$/);

// Takes the label so the messages read naturally for whichever name it validates.
export const name = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(50, `${label} is too long`)
    .regex(/^[\p{L}'-]+$/u, `${label} must be one word`);

export const phone = z.string("phone is required").regex(/^(?:\+20|0)?1[0125]\d{8}$/);

export const dateOfBirth = z.coerce
  .date({ error: "date of birth is required or invalid" })
  .refine((d) => d <= new Date(), { message: "Date of birth cannot be in the future" })
  .refine((d) => d >= new Date("1900-01-01"), { message: "Date of birth is not valid" })
  .refine((d) => calculateAge(d) >= MIN_AGE, { message: `You must be at least ${MIN_AGE} years old` });

export const id = z.string("id is required").regex(/^[0-9a-fA-F]{24}$/, "invalid id");
export const objectId = z
  .string()
  .refine((val) => Types.ObjectId.isValid(val), { message: "Invalid ObjectId" })
  .transform((val) => new Types.ObjectId(val))

// Loose so multer's own extras (buffer, path, finalPath, ...) survive parsing.
export const file = (allowedMimetypes: string[]) =>
  z.looseObject({
    fieldname: z.string(),
    originalname: z.string(),
    mimetype: z.string().refine((mimetype) => allowedMimetypes.includes(mimetype), "invalid file format"),
    size: z.number().positive(),
    path: z.string().optional(),
    buffer: z.instanceof(Buffer).optional(),
  }).superRefine((data, ctx) => {
    if (!data.path && !data.buffer) {
      ctx.addIssue({ code: "custom", message: "buffer is required", path: ["buffer"] });
    }
  });

export const paginationValidationSchema = {
  query: z.strictObject({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    search: z.string().optional(),
  }),
};


export type PaginationDto = z.infer<typeof paginationValidationSchema.query>;
