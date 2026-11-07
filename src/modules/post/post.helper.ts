import { HydratedDocument, Types } from "mongoose";
import { PostVisibilityEnum, ReactionTypeEnum } from "../../common/enums";
import { IUser } from "../../common/interfaces";
import { NotFoundException } from "../../common/exceptions";
import { notificationsService, NotificationsService, s3Service, S3Service } from "../../common/services";
import { UserRepository } from "../../DB/repository/user.repository";

export const USER_PUBLIC_FIELDS = "firstName lastName profilePicture";

export const AUTHOR_POPULATE = [{ path: "createdBy", select: USER_PUBLIC_FIELDS }];

export const POST_POPULATE = [
  ...AUTHOR_POPULATE,
  { path: "updatedBy", select: USER_PUBLIC_FIELDS },
  { path: "tags", select: USER_PUBLIC_FIELDS },
  { path: "sharedFrom.originalAuthorId", select: USER_PUBLIC_FIELDS },
  {
    path: "sharedFrom.originalPostId",
    populate: [
      ...AUTHOR_POPULATE,
      { path: "tags", select: USER_PUBLIC_FIELDS },
    ],
  },
];

export const getVisibility = (user: HydratedDocument<IUser>) => {
  const blockedUsers = (user.blockedUsers || []).map((b) =>
    typeof b === "object" && "_id" in b ? (b as any)._id : b,
  );
  const notBlockedFilter = blockedUsers.length ? { createdBy: { $nin: blockedUsers } } : {};

  return [
    { visibility: PostVisibilityEnum.PUBLIC, ...notBlockedFilter },
    { visibility: PostVisibilityEnum.ONLY_ME, createdBy: user._id },
    { visibility: PostVisibilityEnum.FRIENDS, createdBy: { $in: [user._id, ...(user.friends || [])] }, ...notBlockedFilter },
    { tags: { $in: [user._id] }, ...notBlockedFilter },
  ];
};

export const AddReactionUpdate = (userId: Types.ObjectId, reactionType: ReactionTypeEnum | string) => ({
  $push: { reactions: { reactionType, createdBy: userId, createdAt: new Date() } },
  $inc: { reactionsCount: 1, [`reactionsBreakdown.${reactionType}`]: 1 },
});

export const RemoveReactionUpdate = (userId: Types.ObjectId, reactionType: ReactionTypeEnum | string) => ({
  $pull: { reactions: { createdBy: userId } },
  $inc: { reactionsCount: -1, [`reactionsBreakdown.${reactionType}`]: -1 },
});

export class PostHelper {
  private readonly userRepository: UserRepository;
  private readonly notificationsService: NotificationsService;
  private readonly s3Service: S3Service;

  constructor(
    userRepository: UserRepository = new UserRepository(),
    notifications: NotificationsService = notificationsService,
    s3: S3Service = s3Service,
  ) {
    this.userRepository = userRepository;
    this.notificationsService = notifications;
    this.s3Service = s3;
  }

  /** Dedupe tagged IDs and ensure every tagged user exists. */
  public async resolveMentions(tags: Types.ObjectId[]): Promise<Types.ObjectId[]> {
    const unique = [...new Map(tags.map((id) => [id.toString(), id])).values()];
    if (!unique.length) return [];

    const accounts = await this.userRepository.find({
      filter: { _id: { $in: unique } },
      options: { lean: true },
    });
    if (accounts.length !== unique.length) {
      throw new NotFoundException("One or more tagged users not found");
    }

    return unique;
  }

  /** Notify users who were not previously tagged. */
  public async notifyNewlyTagged(
    previous: Types.ObjectId[] | undefined,
    next: Types.ObjectId[] | undefined,
    actor: HydratedDocument<IUser>,
    target: "post" | "comment" = "post",
    extraData?: Record<string, unknown>,
  ) {
    if (!next?.length) return;

    const existing = new Set((previous ?? []).map(String));
    const actorIdStr = actor._id.toString();
    const newlyTagged = next.filter(
      (id) => !existing.has(id.toString()) && id.toString() !== actorIdStr,
    );

    await Promise.allSettled(
      newlyTagged.map((id) =>
        this.notificationsService.notifyNewMessage({
          recipientId: id.toString(),
          message: `${actor.firstName} ${actor.lastName} mentioned you in a ${target}`,
          data: {
            actorId: actorIdStr,
            actorName: `${actor.firstName} ${actor.lastName}`,
            actorAvatar: actor.profilePicture ?? null,
            entityType: target,
            ...(extraData || {}),
          },
        }),
      ),
    );
  }

  /** Notify post/comment owner/author if not the acting user (best effort). */
  public async notifyAuthor(
    ownerId: Types.ObjectId | IUser,
    actor: HydratedDocument<IUser>,
    message: string,
    extraData?: Record<string, unknown>,
  ) {
    const recipientId = (ownerId as { _id?: Types.ObjectId })._id?.toString() ?? ownerId.toString();
    if (recipientId === actor._id.toString()) return;
    try {
      await this.notificationsService.notifyNewMessage({
        recipientId,
        message: `${actor.firstName} ${actor.lastName} ${message}`,
        data: {
          actorId: actor._id.toString(),
          actorName: `${actor.firstName} ${actor.lastName}`,
          actorAvatar: actor.profilePicture ?? null,
          ...(extraData || {}),
        },
      });
    } catch (err) {
      console.error("Failed to send notification:", err);
    }
  }

  /** Best-effort S3 cleanup (never fails the request). */
  public async safeDeleteAssets(keys: string[]) {
    if (!keys.length) return;
    try {
      await this.s3Service.deleteMultipleAssets({ keys });
    } catch (err) {
      console.error("Failed to delete S3 assets:", keys, err);
    }
  }
}

export const postHelper = new PostHelper();
