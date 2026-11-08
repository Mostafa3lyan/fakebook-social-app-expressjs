import { HydratedDocument, Types } from "mongoose";
import {
  ConversationStatusEnum,
  ConversationTypeEnum,
  ParticipantRoleEnum,
} from "../../common/enums";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "../../common/exceptions";
import { IConversation, IUser } from "../../common/interfaces";
import { socketService, SocketService } from "../../common/services";
import { ConversationModel, MessageModel } from "../../DB/models";
import { UserRepository } from "../../DB/repository";
import { PaginationDto } from "../../common/validation";
import {
  CreateGroupDto,
  UpdateGroupDto,
} from "./conversation.validation";

export class ConversationService {
  private readonly userRepository: UserRepository;
  private readonly socketService: SocketService;

  constructor(
    userRepository: UserRepository = new UserRepository(),
    socket: SocketService = socketService,
  ) {
    this.userRepository = userRepository;
    this.socketService = socket;
  }

  // 1. Create or retrieve direct (1-on-1) conversation
  public async createOrGetDirectConversation(
    currentUser: HydratedDocument<IUser>,
    recipientId: string,
  ): Promise<{ conversation: IConversation; isNew: boolean }> {
    const currentUserIdStr = currentUser._id.toString();

    if (currentUserIdStr === recipientId) {
      throw new BadRequestException("You cannot start a conversation with yourself");
    }

    const recipient = await this.userRepository.findById({ id: recipientId });
    if (!recipient) {
      throw new NotFoundException("Recipient user not found");
    }

    // Check mutual blocking
    const currentBlocked = (currentUser.blockedUsers || []).map(String);
    const recipientBlocked = (recipient.blockedUsers || []).map(String);
    if (currentBlocked.includes(recipientId) || recipientBlocked.includes(currentUserIdStr)) {
      throw new ForbiddenException("Cannot start conversation with this user");
    }

    // Check if a direct conversation already exists between these two users
    const existingConv = await ConversationModel.findOne({
      type: ConversationTypeEnum.DIRECT,
      "participants.user": {
        $all: [currentUser._id, new Types.ObjectId(recipientId)],
      },
    })
      .populate("participants.user", "_id firstName lastName profilePicture email")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "_id firstName lastName profilePicture" },
      });

    if (existingConv) {
      // If conversation was soft-deleted for currentUser, restore it
      const deletedForIds = (existingConv.isDeletedFor || []).map(String);
      if (deletedForIds.includes(currentUserIdStr)) {
        await ConversationModel.updateOne(
          { _id: existingConv._id },
          { $pull: { isDeletedFor: currentUser._id } },
        );
        existingConv.isDeletedFor = (existingConv.isDeletedFor || []).filter(
          (id) => id.toString() !== currentUserIdStr,
        );
      }
      return { conversation: existingConv.toObject(), isNew: false };
    }

    // Check friendship to determine status
    const currentFriendIds = (currentUser.friends || []).map((f) =>
      typeof f === "object" && f !== null && "_id" in f
        ? String((f as { _id: unknown })._id)
        : String(f),
    );
    const isFriend = currentFriendIds.includes(recipientId);

    const status = isFriend ? ConversationStatusEnum.ACCEPTED : ConversationStatusEnum.REQUEST;

    const newConversationDoc = await ConversationModel.create({
      type: ConversationTypeEnum.DIRECT,
      status,
      participants: [
        {
          user: currentUser._id,
          role: ParticipantRoleEnum.MEMBER,
          joinedAt: new Date(),
          lastReadAt: new Date(),
        },
        {
          user: new Types.ObjectId(recipientId),
          role: ParticipantRoleEnum.MEMBER,
          joinedAt: new Date(),
        },
      ],
      admins: [],
      ...(status === ConversationStatusEnum.REQUEST && {
        requestedBy: currentUser._id,
        requestedTo: new Types.ObjectId(recipientId),
      }),
      lastMessageAt: new Date(),
    });

    const populated = await ConversationModel.findById(newConversationDoc._id)
      .populate("participants.user", "_id firstName lastName profilePicture email")
      .lean();

    if (!populated) {
      throw new NotFoundException("Conversation could not be created");
    }

    // Notify recipient
    if (status === ConversationStatusEnum.REQUEST) {
      this.socketService.sendToUser(recipientId, "chat:request_received", {
        conversation: populated,
        sender: {
          _id: currentUserIdStr,
          firstName: currentUser.firstName,
          lastName: currentUser.lastName,
          profilePicture: currentUser.profilePicture,
        },
      });
    } else {
      this.socketService.sendToUser(recipientId, "chat:conversation_created", {
        conversation: populated,
      });
    }

    return { conversation: populated as unknown as IConversation, isNew: true };
  }

  // 2. Create group conversation
  public async createGroupConversation(
    currentUser: HydratedDocument<IUser>,
    data: CreateGroupDto,
  ): Promise<{ conversation: IConversation }> {
    const currentUserIdStr = currentUser._id.toString();

    // Deduplicate participant IDs and remove currentUser if passed
    const rawIds = Array.from(new Set(data.participantIds.map(String))).filter(
      (id) => id !== currentUserIdStr,
    );

    if (rawIds.length < 2) {
      throw new BadRequestException("A group conversation requires at least 2 other members");
    }

    // Check blocked users
    const currentBlocked = (currentUser.blockedUsers || []).map(String);
    for (const memberId of rawIds) {
      if (currentBlocked.includes(memberId)) {
        throw new ForbiddenException(`Cannot add blocked user to the group`);
      }
    }

    // Verify all participants exist
    const users = await this.userRepository.find({
      filter: { _id: { $in: rawIds.map((id) => new Types.ObjectId(id)) } },
    });

    if (users.length !== rawIds.length) {
      throw new NotFoundException("One or more participant users could not be found");
    }

    // Verify no participant has blocked currentUser
    for (const u of users) {
      const blocked = ((u as any).blockedUsers || []).map(String);
      if (blocked.includes(currentUserIdStr)) {
        throw new ForbiddenException(`User ${u.firstName} has blocked interactions`);
      }
    }

    const participants = [
      {
        user: currentUser._id,
        role: ParticipantRoleEnum.ADMIN,
        joinedAt: new Date(),
        lastReadAt: new Date(),
      },
      ...rawIds.map((id) => ({
        user: new Types.ObjectId(id),
        role: ParticipantRoleEnum.MEMBER,
        joinedAt: new Date(),
      })),
    ];

    const groupDoc = await ConversationModel.create({
      type: ConversationTypeEnum.GROUP,
      status: ConversationStatusEnum.ACCEPTED,
      title: data.title.trim(),
      participants,
      admins: [currentUser._id],
      lastMessageAt: new Date(),
    });

    const populated = await ConversationModel.findById(groupDoc._id)
      .populate("participants.user", "_id firstName lastName profilePicture email")
      .lean();

    if (!populated) {
      throw new NotFoundException("Group conversation could not be created");
    }

    // Notify all other members
    this.socketService.sendToUsers(rawIds, "chat:conversation_created", {
      conversation: populated,
    });

    return { conversation: populated as unknown as IConversation };
  }

  // 3. List active conversations (Inbox)
  public async getConversations(
    currentUser: HydratedDocument<IUser>,
    pagination: PaginationDto,
  ) {
    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(pagination.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {
      "participants.user": currentUser._id,
      status: ConversationStatusEnum.ACCEPTED,
      isDeletedFor: { $ne: currentUser._id },
    };

    if (pagination.search) {
      filter.$or = [
        { title: { $regex: pagination.search, $options: "i" } },
      ];
    }

    const [total, conversations] = await Promise.all([
      ConversationModel.countDocuments(filter),
      ConversationModel.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("participants.user", "_id firstName lastName profilePicture email")
        .populate({
          path: "lastMessage",
          populate: { path: "sender", select: "_id firstName lastName profilePicture" },
        })
        .lean(),
    ]);

    // Calculate unread count for each conversation
    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const participant = conv.participants.find(
          (p) => p.user && (p.user as any)._id?.toString() === currentUser._id.toString(),
        );
        const lastReadAt = participant?.lastReadAt || conv.createdAt;

        const unreadCount = await MessageModel.countDocuments({
          conversationId: conv._id,
          createdAt: { $gt: lastReadAt },
          sender: { $ne: currentUser._id },
          hiddenFor: { $ne: currentUser._id },
        });

        return {
          ...conv,
          unreadCount,
        };
      }),
    );

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      total,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      data: conversationsWithUnread,
    };
  }

  // 4. List pending message requests
  public async getMessageRequests(
    currentUser: HydratedDocument<IUser>,
    pagination: PaginationDto,
  ) {
    const page = Math.max(1, Number(pagination.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(pagination.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {
      requestedTo: currentUser._id,
      status: ConversationStatusEnum.REQUEST,
      isDeletedFor: { $ne: currentUser._id },
    };

    const [total, conversations] = await Promise.all([
      ConversationModel.countDocuments(filter),
      ConversationModel.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("participants.user", "_id firstName lastName profilePicture email")
        .populate({
          path: "lastMessage",
          populate: { path: "sender", select: "_id firstName lastName profilePicture" },
        })
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      total,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      data: conversations,
    };
  }

  // 5. Accept message request
  public async acceptMessageRequest(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      requestedTo: currentUser._id,
      status: ConversationStatusEnum.REQUEST,
    });

    if (!conversation) {
      throw new NotFoundException("Message request not found");
    }

    conversation.status = ConversationStatusEnum.ACCEPTED;
    await conversation.save();

    // Mark current user's lastReadAt
    await ConversationModel.updateOne(
      { _id: conversation._id, "participants.user": currentUser._id },
      { $set: { "participants.$.lastReadAt": new Date() } },
    );

    // Notify requester
    if (conversation.requestedBy) {
      this.socketService.sendToUser(
        conversation.requestedBy.toString(),
        "chat:request_accepted",
        {
          conversationId: conversation._id.toString(),
          acceptedBy: currentUser._id.toString(),
        },
      );
    }

    return { conversationId: conversation._id.toString() };
  }

  // 6. Reject message request
  public async rejectMessageRequest(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      requestedTo: currentUser._id,
      status: ConversationStatusEnum.REQUEST,
    });

    if (!conversation) {
      throw new NotFoundException("Message request not found");
    }

    conversation.status = ConversationStatusEnum.REJECTED;
    if (!conversation.isDeletedFor?.includes(currentUser._id)) {
      conversation.isDeletedFor = conversation.isDeletedFor || [];
      conversation.isDeletedFor.push(currentUser._id);
    }
    await conversation.save();

    return { message: "Message request rejected" };
  }

  // 7. Get conversation details by ID
  public async getConversationById(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
  ): Promise<IConversation> {
    const conv = await ConversationModel.findOne({
      _id: conversationId,
      "participants.user": currentUser._id,
    })
      .populate("participants.user", "_id firstName lastName profilePicture email")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "_id firstName lastName profilePicture" },
      })
      .lean();

    if (!conv) {
      throw new NotFoundException("Conversation not found");
    }

    return conv as unknown as IConversation;
  }

  // 8. Update group title or avatar
  public async updateGroup(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    data: UpdateGroupDto,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      type: ConversationTypeEnum.GROUP,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Group conversation not found");
    }

    const adminIds = (conversation.admins || []).map(String);
    if (!adminIds.includes(currentUser._id.toString())) {
      throw new ForbiddenException("Only group admins can update group details");
    }

    if (data.title) conversation.title = data.title.trim();
    if (data.avatar) conversation.avatar = data.avatar;

    await conversation.save();

    const participantIds = conversation.participants.map((p) => p.user.toString());
    this.socketService.sendToUsers(participantIds, "chat:conversation_updated", {
      conversationId: conversation._id.toString(),
      title: conversation.title,
      avatar: conversation.avatar,
    });

    return conversation.toObject();
  }

  // 9. Add group members
  public async addGroupMembers(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    memberIds: string[],
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      type: ConversationTypeEnum.GROUP,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Group conversation not found");
    }

    const adminIds = (conversation.admins || []).map(String);
    if (!adminIds.includes(currentUser._id.toString())) {
      throw new ForbiddenException("Only group admins can add members");
    }

    const existingMemberIds = conversation.participants.map((p) => p.user.toString());
    const newMemberIds = Array.from(new Set(memberIds)).filter(
      (id) => !existingMemberIds.includes(id),
    );

    if (newMemberIds.length === 0) {
      throw new BadRequestException("All specified users are already in the group");
    }

    // Verify users exist
    const users = await this.userRepository.find({
      filter: { _id: { $in: newMemberIds.map((id) => new Types.ObjectId(id)) } },
    });

    if (users.length !== newMemberIds.length) {
      throw new NotFoundException("One or more users not found");
    }

    for (const u of users) {
      const userDocId = (u as any)._id as Types.ObjectId;
      conversation.participants.push({
        user: userDocId,
        role: ParticipantRoleEnum.MEMBER,
        joinedAt: new Date(),
      });
    }

    await conversation.save();

    const updated = await ConversationModel.findById(conversation._id)
      .populate("participants.user", "_id firstName lastName profilePicture email")
      .lean();

    const allMemberIds = conversation.participants.map((p) => p.user.toString());
    this.socketService.sendToUsers(allMemberIds, "chat:conversation_updated", {
      conversation: updated,
    });

    return updated;
  }

  // 10. Remove group member or leave group
  public async removeGroupMember(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    memberId: string,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      type: ConversationTypeEnum.GROUP,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Group conversation not found");
    }

    const currentUserIdStr = currentUser._id.toString();
    const isSelf = currentUserIdStr === memberId;
    const adminIds = (conversation.admins || []).map(String);

    if (!isSelf && !adminIds.includes(currentUserIdStr)) {
      throw new ForbiddenException("Only group admins can remove other members");
    }

    conversation.participants = conversation.participants.filter(
      (p) => p.user.toString() !== memberId,
    );
    conversation.admins = conversation.admins.filter((id) => id.toString() !== memberId);

    // If no admins remain and participants exist, promote oldest member
    if (conversation.admins.length === 0 && conversation.participants.length > 0) {
      const firstMember = conversation.participants[0];
      if (firstMember) {
        firstMember.role = ParticipantRoleEnum.ADMIN;
        conversation.admins.push(new Types.ObjectId(firstMember.user.toString()));
      }
    }

    await conversation.save();

    const remainingIds = conversation.participants.map((p) => p.user.toString());
    this.socketService.sendToUsers([...remainingIds, memberId], "chat:member_removed", {
      conversationId: conversation._id.toString(),
      memberId,
    });

    return { message: "Member removed successfully" };
  }

  // 11. Delete conversation
  public async deleteConversation(
    currentUser: HydratedDocument<IUser>,
    conversationId: string,
    disband?: string,
  ) {
    const conversation = await ConversationModel.findOne({
      _id: conversationId,
      "participants.user": currentUser._id,
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    const currentUserIdStr = currentUser._id.toString();

    // If group disband requested by admin
    if (disband === "true" && conversation.type === ConversationTypeEnum.GROUP) {
      const adminIds = (conversation.admins || []).map(String);
      if (!adminIds.includes(currentUserIdStr)) {
        throw new ForbiddenException("Only group admins can disband the group");
      }

      const allMemberIds = conversation.participants.map((p) => p.user.toString());
      await ConversationModel.deleteOne({ _id: conversation._id });
      await MessageModel.deleteMany({ conversationId: conversation._id });

      this.socketService.sendToUsers(allMemberIds, "chat:conversation_deleted", {
        conversationId,
        disbanded: true,
      });

      return { message: "Group disbanded successfully", disbanded: true };
    }

    // Default: Soft-delete for current user
    await ConversationModel.updateOne(
      { _id: conversation._id },
      { $addToSet: { isDeletedFor: currentUser._id } },
    );

    return { message: "Conversation deleted from your inbox", disbanded: false };
  }
}

export const conversationService = new ConversationService();
