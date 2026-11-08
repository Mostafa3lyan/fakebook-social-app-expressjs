import { Types } from "mongoose";
import {
  ConversationStatusEnum,
  ConversationTypeEnum,
  ParticipantRoleEnum,
} from "../enums";
import { IUser } from "./user.interface";

export interface IConversationParticipant {
  user: Types.ObjectId | IUser;
  role: ParticipantRoleEnum;
  joinedAt: Date;
  lastReadAt?: Date | undefined;
  lastReadMessageId?: Types.ObjectId | undefined;
}

export interface IConversation {
  _id: Types.ObjectId;
  type: ConversationTypeEnum;
  status: ConversationStatusEnum;
  title?: string | undefined;
  avatar?: string | undefined;
  participants: IConversationParticipant[];
  admins: Types.ObjectId[];
  requestedBy?: Types.ObjectId | IUser | undefined;
  requestedTo?: Types.ObjectId | IUser | undefined;
  lastMessage?: Types.ObjectId | any | undefined;
  lastMessageAt?: Date | undefined;
  isDeletedFor?: Types.ObjectId[] | undefined;
  createdAt: Date;
  updatedAt: Date;
}
