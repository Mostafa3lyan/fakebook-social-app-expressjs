// post.validation.ts
import { z } from "zod";
import { PostVisibilityEnum, ReactionTypeEnum } from "../../common/enums";
import { fileFieldValidation } from "../../common/utils/multer";
import { file, id, objectId } from "../../common/validation";

const locationSchema = z.object({
  name: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const postIdParamSchema = z.object({
  postId: id,
});

export const postParamSchema = {
  params: postIdParamSchema,
};

export const userIdParamSchema = {
  params: z.object({
    userId: id,
  }),
};


const jsonArrayField = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((val) => {
    if (typeof val !== "string") return val; // already an array (e.g. JSON body) — pass through untouched
    try {
      return JSON.parse(val);
    } catch {
      return val; // let the inner schema reject it with a proper array-type error
    }
  }, z.array(itemSchema));

const jsonObjectField = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.preprocess((val) => {
    if (typeof val !== "string") return val;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }, itemSchema);

export const createPostSchema = {
  body: z
    .object({
      content: z.string().max(63206).trim().optional(),
      attachments: z.array(file(fileFieldValidation.image)).max(10).optional(),
      removeAttachments: jsonArrayField(z.string()).optional(),
      visibility: z.enum(PostVisibilityEnum),
      tags: jsonArrayField(objectId).optional(),
      location: jsonObjectField(locationSchema).optional(),
    })
    .superRefine((data, ctx) => {
      if (!data.content && (!data.attachments || data.attachments.length === 0)) {
        ctx.addIssue({
          code: "custom",
          message: "Post must have either content or at least one attachment",
          path: ["content"],
        });
      }

      if (data.tags?.length) {
        const uniqueTags = new Set(data.tags.map((id) => id.toString()));
        if (uniqueTags.size !== data.tags.length) {
          ctx.addIssue({
            code: "custom",
            message: "Tagged user IDs must be unique",
            path: ["tags"],
          });
        }
      }
    }),
};

const updatePostBody = z
  .object({
    content: z.string().max(63206).trim().optional(),
    attachments: z.array(file(fileFieldValidation.image)).max(10).optional(),
    removeAttachments: jsonArrayField(z.string()).optional(),
    visibility: z.enum(PostVisibilityEnum).optional(),
    tags: jsonArrayField(objectId).optional(),
    location: jsonObjectField(locationSchema.nullable()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tags?.length) {
      const uniqueTags = new Set(data.tags.map((id) => id.toString()));
      if (uniqueTags.size !== data.tags.length) {
        ctx.addIssue({
          code: "custom",
          message: "Tagged user IDs must be unique",
          path: ["tags"],
        });
      }
    }

    const hasAnyField =
      data.content !== undefined ||
      (data.attachments && data.attachments.length > 0) ||
      (data.removeAttachments && data.removeAttachments.length > 0) ||
      data.visibility !== undefined ||
      data.tags !== undefined ||
      data.location !== undefined;

    if (!hasAnyField) {
      ctx.addIssue({
        code: "custom",
        message: "At least one field must be provided to update",
      });
    }
  });

export const updatePostSchema = {
  params: postIdParamSchema,
  body: updatePostBody,
};

export const reactAtPostSchema = {
  params: postIdParamSchema,
  body: z.strictObject({
    reaction: z.enum(ReactionTypeEnum),
  }),
};

export const sharePostSchema = {
  params: postIdParamSchema,
  body: z.object({
    content: z.string().max(63206).trim().optional(),
    visibility: z.enum(PostVisibilityEnum),
    tags: jsonArrayField(objectId).optional(),
  }),
};

// ── DTOs, inferred directly from the schemas above ──
export type PostIdParamDto = z.infer<typeof postIdParamSchema>;
export type UserIdParamDto = z.infer<typeof userIdParamSchema.params>;
export type CreatePostDto = z.infer<typeof createPostSchema.body>;
export type UpdatePostDto = z.infer<typeof updatePostSchema.body>;
export type ReactAtPostDto = z.infer<typeof reactAtPostSchema.body>;
export type SharePostDto = z.infer<typeof sharePostSchema.body>;
export type LocationDto = z.infer<typeof locationSchema>;