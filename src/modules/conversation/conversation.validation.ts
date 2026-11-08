import { z } from "zod";
import { id } from "../../common/validation";

export const directConversationParamSchema = {
  params: z.strictObject({
    recipientId: id,
  }),
};

export const createGroupSchema = {
  body: z.strictObject({
    title: z.string().trim().min(1, "Group title is required").max(100, "Group title is too long"),
    participantIds: z
      .array(id)
      .min(2, "A group must have at least 2 other members")
      .max(50, "A group cannot have more than 50 members"),
  }),
};

export const conversationIdParamSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
};

export const updateGroupSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  body: z.strictObject({
    title: z.string().trim().min(1, "Title cannot be empty").max(100).optional(),
    avatar: z.string().optional(),
  }),
};

export const addMembersSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  body: z.strictObject({
    memberIds: z
      .array(id)
      .min(1, "Provide at least one member to add")
      .max(50, "Cannot add more than 50 members at once"),
  }),
};

export const removeMemberSchema = {
  params: z.strictObject({
    conversationId: id,
    memberId: id,
  }),
};

export const deleteConversationSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  query: z.strictObject({
    disband: z.enum(["true", "false"]).optional(),
  }),
};

export const getConversationsQuerySchema = {
  query: z.strictObject({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    search: z.string().trim().optional(),
  }),
};

export type DirectConversationParamDto = z.infer<typeof directConversationParamSchema.params>;
export type CreateGroupDto = z.infer<typeof createGroupSchema.body>;
export type ConversationIdParamDto = z.infer<typeof conversationIdParamSchema.params>;
export type UpdateGroupDto = z.infer<typeof updateGroupSchema.body>;
export type AddMembersDto = z.infer<typeof addMembersSchema.body>;
export type RemoveMemberParamDto = z.infer<typeof removeMemberSchema.params>;
export type DeleteConversationQueryDto = z.infer<typeof deleteConversationSchema.query>;

