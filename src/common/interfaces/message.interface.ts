import { Types } from "mongoose";
import { MessageTypeEnum } from "../enums";
import { IUser } from "./user.interface";

export interface IMessageAttachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface IMessageReceipt {
  user: Types.ObjectId | IUser;
  timestamp: Date;
}

export interface IMessage {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  sender: Types.ObjectId | IUser;
  type: MessageTypeEnum;
  content: string;
  attachments: IMessageAttachment[];
  deliveredTo: IMessageReceipt[];
  readBy: IMessageReceipt[];
  isEdited: boolean;
  editedAt?: Date | undefined;
  isDeleted: boolean;
  deletedAt?: Date | undefined;
  hiddenFor?: Types.ObjectId[] | undefined;
  clientTempId?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}
