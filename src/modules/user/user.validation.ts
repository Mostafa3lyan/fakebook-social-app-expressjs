import { z } from "zod";
import { GenderEnum, LogoutEnum } from "../../common/enums";
import { fileFieldValidation } from "../../common/utils/multer";
import { file, objectId, password, email, name, phone, dateOfBirth } from "../../common/validation";

// Schemas
export const logoutSchema = {
  // Defaults to a single-session logout so an empty body is valid.
  body: z.object({
    flag: z.enum(LogoutEnum).default(LogoutEnum.current),
  }),
};

export const shareProfile = {
  params: z.strictObject({
    userId: objectId,
  }),
};

export const targetUserParamSchema = {
  params: z.strictObject({
    targetUserId: objectId,
  }),
};

export const profileImage = {
  file: file(fileFieldValidation.image),
};

export const profileCoverImage = {
  files: z.array(file(fileFieldValidation.image)).min(1).max(5),
};

// Request body for S3 pre-signed image uploads (profile picture & cover image)
export const presignedImageSchema = {
  body: z.strictObject({
    contentType: z
      .string("contentType is required")
      .refine((type) => fileFieldValidation.image.includes(type), "invalid file format"),
    originalname: z
      .string("originalname is required")
      .trim()
      .min(1, "originalname is required")
      .max(200, "originalname is too long"),
  }),
};

export const profileAttachments = {
  files: z.object({
    firstAttachment: z.array(file(fileFieldValidation.image)).length(1),
    secondAttachment: z.array(file(fileFieldValidation.image)).min(1).max(5),
  }),
};

export const changePasswordSchema = {
  body: z
    .object({
      oldPassword: password,
      newPassword: password,
      confirmNewPassword: z.string("confirm password is required"),
    })
    .refine((data) => data.newPassword !== data.oldPassword, {
      message: "New password must be different from the old password",
      path: ["newPassword"],
    })
    .refine((data) => data.newPassword === data.confirmNewPassword, {
      message: "Confirm password does not match",
      path: ["confirmNewPassword"],
    }),
};

export const restoreAccountSchema = {
  body: z.object({
    email,
    password,
  }),
};

export const updateProfileSchema = {
  body: z
    .object({
      firstName: name("First name").optional(),
      lastName: name("Last name").optional(),
      phone: phone.optional(),
      dateOfBirth: dateOfBirth.optional(),
      gender: z.enum(GenderEnum).optional(),
    })
    .refine(
      (data) => Object.values(data).some((val) => val !== undefined),
      { message: "At least one field must be provided to update profile" },
    ),
};

export const searchUserSchema = {
  query: z.object({
    search: z.string().trim().min(1, "Search query is required"),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
  }),
};

// Inferred types
export type LogoutDto = z.infer<typeof logoutSchema.body>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema.body>;
export type ShareProfileDto = z.infer<typeof shareProfile.params>;
export type TargetUserParamDto = z.infer<typeof targetUserParamSchema.params>;
export type ProfileImageDto = z.infer<typeof profileImage.file>;
export type ProfileCoverImageDto = z.infer<typeof profileCoverImage.files>;
export type PresignedImageDto = z.infer<typeof presignedImageSchema.body>;
export type ProfileAttachmentsDto = z.infer<typeof profileAttachments.files>;
export type RestoreAccountDto = z.infer<typeof restoreAccountSchema.body>;
export type UpdateProfileDto = z.infer<typeof updateProfileSchema.body>;
export type SearchUserDto = z.infer<typeof searchUserSchema.query>;
