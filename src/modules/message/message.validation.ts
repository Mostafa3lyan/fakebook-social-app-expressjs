import { z } from "zod";
import { id } from "../../common/validation";

export const getMessagesSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  query: z.strictObject({
    before: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

export const sendMessageSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  body: z.looseObject({
    content: z.string().max(5000, "Message cannot exceed 5000 characters").optional(),
    clientTempId: z.string().max(100).optional(),
    attachments: z.any().optional(),
  }),
};

export const editMessageSchema = {
  params: z.strictObject({
    conversationId: id,
    messageId: id,
  }),
  body: z.strictObject({
    content: z.string().trim().min(1, "Message content cannot be empty").max(5000, "Message cannot exceed 5000 characters"),
  }),
};

export const deleteMessageSchema = {
  params: z.strictObject({
    conversationId: id,
    messageId: id,
  }),
  query: z.strictObject({
    mode: z.enum(["everyone", "self"]).optional(),
  }),
};

export const markReadSchema = {
  params: z.strictObject({
    conversationId: id,
  }),
  body: z.strictObject({
    lastMessageId: id.optional(),
  }),
};

export type GetMessagesParamDto = z.infer<typeof getMessagesSchema.params>;
export type GetMessagesQueryDto = z.infer<typeof getMessagesSchema.query>;
export type SendMessageParamDto = z.infer<typeof sendMessageSchema.params>;
export type SendMessageBodyDto = z.infer<typeof sendMessageSchema.body>;
export type EditMessageParamDto = z.infer<typeof editMessageSchema.params>;
export type EditMessageBodyDto = z.infer<typeof editMessageSchema.body>;
export type DeleteMessageParamDto = z.infer<typeof deleteMessageSchema.params>;
export type DeleteMessageQueryDto = z.infer<typeof deleteMessageSchema.query>;
export type MarkReadParamDto = z.infer<typeof markReadSchema.params>;
export type MarkReadBodyDto = z.infer<typeof markReadSchema.body>;
