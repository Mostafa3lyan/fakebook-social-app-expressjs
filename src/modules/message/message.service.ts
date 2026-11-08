import { HydratedDocument, Types } from "mongoose";
import { MessageTypeEnum } from "../../common/enums";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "../../common/exceptions";
import { IMessage, IMessageAttachment, IUser } from "../../common/interfaces";
import { s3Service, S3Service, socketService, SocketService } from "../../common/services";
import { ConversationModel, MessageModel, UserModel } from "../../DB/models";
import {
  GetMessagesQueryDto,
  SendMessageBodyDto,
} from "./message.validation";

export class MessageService {
  private readonly s3Service: S3Service;
  private readonly socketService: SocketService;

  constructor(
    s3: S3Service = s3Service,
    socket: SocketService = socketService,
  ) {
    this.s3Service = s3;
    this.socketService = socket;
  }

  // 1. Get messages history with backward cursor pagination
  public async getMessages(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    query: GetMessagesQueryDto,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const filter: Record<string, any> = {
      conversationId: new Types.ObjectId(conversationId),
      hiddenFor: { $ne: currentUser._id },
    };

    if (query.before) {
      if (Types.ObjectId.isValid(query.before)) {
        const cursorMsg = await MessageModel.findById(query.before).select("createdAt");
        if (cursorMsg) {
          filter.createdAt = { $lt: cursorMsg.createdAt };
        }
      } else {
        const parsedDate = new Date(query.before);
        if (!isNaN(parsedDate.getTime())) {
          filter.createdAt = { $lt: parsedDate };
        }
      }
    }

    const rawMessages = await MessageModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("sender", "_id firstName lastName profilePicture")
      .lean();

    const hasMore = rawMessages.length > limit;
    const paginated = hasMore ? rawMessages.slice(0, limit) : rawMessages;

    // Return in chronological order (oldest to newest)
    const messages = paginated.reverse();
    const nextCursor =
      hasMore && messages.length > 0 && messages[0] && "_id" in messages[0]
        ? String((messages[0] as any)._id)
        : null;

    return {
      messages,
      hasMore,
      nextCursor,
    };
  }

  // 2. Send message
  public async sendMessage(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    body: SendMessageBodyDto,
    files?: Express.Multer.File[],
  ): Promise<IMessage> {
    const currentUserIdStr = currentUser._id.toString();

    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    // Check if blocked in direct conversation
    if (conversation.type === "direct") {
      const otherParticipant = conversation.participants.find(
        (p) => p.user.toString() !== currentUserIdStr,
      );
      if (otherParticipant) {
        const otherUser = await UserModel.findById(otherParticipant.user).select("blockedUsers");
        if (otherUser) {
          const otherBlocked = ((otherUser as any).blockedUsers || []).map(String);
          const currentBlocked = (currentUser.blockedUsers || []).map(String);
          if (
            otherBlocked.includes(currentUserIdStr) ||
            currentBlocked.includes(otherParticipant.user.toString())
          ) {
            throw new ForbiddenException("Cannot send message to this user");
          }
        }
      }
    }

    // Process attachments
    const attachments: IMessageAttachment[] = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const key = await this.s3Service.uploadAsset({
          file,
          path: `messages/${conversationId}`,
        });
        attachments.push({
          url: key,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        });
      }
    }

    const trimmedContent = body.content ? body.content.trim() : "";
    if (!trimmedContent && attachments.length === 0) {
      throw new BadRequestException("Message content or attachments required");
    }

    let messageType = MessageTypeEnum.TEXT;
    if (attachments.length > 0) {
      const isAllImages = attachments.every((a) => a.mimeType.startsWith("image/"));
      messageType = isAllImages ? MessageTypeEnum.IMAGE : MessageTypeEnum.FILE;
    }

    const now = new Date();
    const createData: Record<string, any> = {
      conversationId: conversation._id,
      sender: currentUser._id,
      type: messageType,
      content: trimmedContent,
      attachments,
      deliveredTo: [],
      readBy: [{ user: currentUser._id, timestamp: now }],
    };

    if (body.clientTempId) {
      createData.clientTempId = body.clientTempId;
    }

    const messageDoc = (await MessageModel.create(createData)) as any;
    const messageDocId = messageDoc._id as Types.ObjectId;

    // Update conversation metadata
    conversation.lastMessage = messageDocId;
    conversation.lastMessageAt = now;
    // Un-hide for any participant who previously deleted conversation
    conversation.isDeletedFor = [];

    // If conversation was a pending request and the recipient replied, accept it automatically
    if (
      conversation.status === "request" &&
      conversation.requestedTo?.toString() === currentUserIdStr
    ) {
      conversation.status = "accepted" as any;
    }

    // Update sender's last read mark
    const senderParticipant = conversation.participants.find(
      (p) => p.user.toString() === currentUserIdStr,
    );
    if (senderParticipant) {
      senderParticipant.lastReadAt = now;
      senderParticipant.lastReadMessageId = messageDocId;
    }

    await conversation.save();

    const populatedMessage = await MessageModel.findById(messageDocId)
      .populate("sender", "_id firstName lastName profilePicture")
      .lean();

    if (!populatedMessage) {
      throw new NotFoundException("Message could not be persisted");
    }

    // Broadcast in real-time
    const otherParticipantIds = conversation.participants
      .map((p) => p.user.toString())
      .filter((id) => id !== currentUserIdStr);

    // 1. Emit to active conversation room
    this.socketService
      .getIO()
      ?.to(`conversation:${conversationId}`)
      .emit("chat:new_message", {
        conversationId,
        message: populatedMessage,
        clientTempId: body.clientTempId,
      });

    // 2. Emit to personal rooms of other participants for background alerts & unread updates
    this.socketService.sendToUsers(otherParticipantIds, "chat:new_message", {
      conversationId,
      message: populatedMessage,
      clientTempId: body.clientTempId,
    });

    return populatedMessage as unknown as IMessage;
  }

  // 3. Edit message
  public async editMessage(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    messageId: string,
    content: string,
  ) {
    const message = await MessageModel.findOne({
      _id: messageId,
      conversationId,
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    if (message.sender.toString() !== currentUser._id.toString()) {
      throw new ForbiddenException("Only the author can edit this message");
    }

    if (message.isDeleted) {
      throw new BadRequestException("Cannot edit a deleted message");
    }

    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    const payload = {
      conversationId,
      messageId: message._id.toString(),
      content: message.content,
      isEdited: true,
      editedAt: message.editedAt.toISOString(),
    };

    // Emit to conversation room
    this.socketService
      .getIO()
      ?.to(`conversation:${conversationId}`)
      .emit("chat:message_edited", payload);

    return message.toObject();
  }

  // 4. Delete / Unsend message
  public async deleteMessage(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    messageId: string,
    mode: "everyone" | "self" = "everyone",
  ) {
    const message = await MessageModel.findOne({
      _id: messageId,
      conversationId,
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    const currentUserIdStr = currentUser._id.toString();

    if (mode === "everyone") {
      if (message.sender.toString() !== currentUserIdStr) {
        throw new ForbiddenException("Only the author can unsend this message for everyone");
      }

      message.isDeleted = true;
      message.deletedAt = new Date();
      message.content = "This message was deleted";
      message.attachments = [];
      await message.save();

      // Emit to conversation room
      this.socketService
        .getIO()
        ?.to(`conversation:${conversationId}`)
        .emit("chat:message_deleted", {
          conversationId,
          messageId: message._id.toString(),
          isDeleted: true,
        });

      return { message: "Message unsent for everyone", mode: "everyone" };
    }

    // mode === "self": Hide message locally for current user
    await MessageModel.updateOne(
      { _id: message._id },
      { $addToSet: { hiddenFor: currentUser._id } },
    );

    return { message: "Message removed for you", mode: "self" };
  }

  // 5. Mark conversation as read
  public async markAsRead(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    lastMessageId?: string,
  ) {
    const currentUserIdStr = currentUser._id.toString();
    const now = new Date();

    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    // Update participant lastReadAt
    await ConversationModel.updateOne(
      { _id: conversation._id, "participants.user": currentUser._id },
      {
        $set: {
          "participants.$.lastReadAt": now,
          ...(lastMessageId && Types.ObjectId.isValid(lastMessageId) && {
            "participants.$.lastReadMessageId": new Types.ObjectId(lastMessageId),
          }),
        },
      },
    );

    // Add currentUser to readBy array of messages
    const messageFilter: Record<string, any> = {
      conversationId: conversation._id,
      sender: { $ne: currentUser._id },
      "readBy.user": { $ne: currentUser._id },
    };

    if (lastMessageId && Types.ObjectId.isValid(lastMessageId)) {
      const targetMsg = await MessageModel.findById(lastMessageId).select("createdAt");
      if (targetMsg) {
        messageFilter.createdAt = { $lte: targetMsg.createdAt };
      }
    }

    await MessageModel.updateMany(messageFilter, {
      $addToSet: { readBy: { user: currentUser._id, timestamp: now } },
    });

    // Broadcast read receipt to room
    this.socketService
      .getIO()
      ?.to(`conversation:${conversationId}`)
      .emit("chat:message_read", {
        conversationId,
        userId: currentUserIdStr,
        messageId: lastMessageId,
        readAt: now.toISOString(),
      });

    return { message: "Marked as read", readAt: now.toISOString() };
  }
}

export const messageService = new MessageService();
