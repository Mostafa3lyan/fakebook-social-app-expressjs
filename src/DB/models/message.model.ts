import { Model, model, Schema } from "mongoose";
import { MessageTypeEnum } from "../../common/enums";
import {
  IMessage,
  IMessageAttachment,
  IMessageReceipt,
} from "../../common/interfaces";

const attachmentSchema = new Schema<IMessageAttachment>(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
  },
  { _id: false },
);

const receiptSchema = new Schema<IMessageReceipt>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessage, Model<IMessage>>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(MessageTypeEnum),
      default: MessageTypeEnum.TEXT,
      required: true,
    },
    content: {
      type: String,
      default: "",
      trim: true,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    deliveredTo: {
      type: [receiptSchema],
      default: [],
    },
    readBy: {
      type: [receiptSchema],
      default: [],
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    hiddenFor: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    clientTempId: {
      type: String,
    },
  },
  {
    timestamps: true,
    strict: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, any>) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
    strictQuery: true,
  },
);

// High-speed indices for message history & unread counters
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, "readBy.user": 1 });
messageSchema.index({ clientTempId: 1 }, { sparse: true });

export const MessageModel: Model<IMessage> = model<IMessage>(
  "Message",
  messageSchema,
);

