import { Model, model, Schema } from "mongoose";
import {
  ConversationStatusEnum,
  ConversationTypeEnum,
  ParticipantRoleEnum,
} from "../../common/enums";
import { IConversation, IConversationParticipant } from "../../common/interfaces";

const participantSchema = new Schema<IConversationParticipant>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(ParticipantRoleEnum),
      default: ParticipantRoleEnum.MEMBER,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastReadAt: {
      type: Date,
    },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
  },
  { _id: false },
);

const conversationSchema = new Schema<IConversation, Model<IConversation>>(
  {
    type: {
      type: String,
      enum: Object.values(ConversationTypeEnum),
      default: ConversationTypeEnum.DIRECT,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ConversationStatusEnum),
      default: ConversationStatusEnum.ACCEPTED,
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    avatar: {
      type: String,
    },
    participants: {
      type: [participantSchema],
      required: true,
      validate: [
        (val: IConversationParticipant[]) => val && val.length >= 2,
        "A conversation must have at least 2 participants",
      ],
    },
    admins: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    requestedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isDeletedFor: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
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

// Indexes for high performance inbox queries
conversationSchema.index({ "participants.user": 1, lastMessageAt: -1 });
conversationSchema.index({ "participants.user": 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ requestedTo: 1, status: 1, lastMessageAt: -1 });

export const ConversationModel: Model<IConversation> = model<IConversation>(
  "Conversation",
  conversationSchema,
);

