// post.service.ts
import { randomUUID } from "node:crypto";
import { FlattenMaps, HydratedDocument, Types } from "mongoose";
import { CommentRepository, PostRepository, UserRepository } from "../../DB/repository";
import { BadRequestException, ForbiddenException, NotFoundException } from "../../common/exceptions";
import { s3Service, S3Service } from "../../common/services";
import { IPagination, IPost, IUser } from "../../common/interfaces";
import { escapeRegex } from "../../common/utils";
import {
  POST_POPULATE,
  getVisibility,
  PostHelper,
  postHelper,
  AddReactionUpdate,
  RemoveReactionUpdate,
} from "./post.helper";
import { PaginationDto } from "../../common/validation";
import { CreatePostDto, PostIdParamDto, ReactAtPostDto, SharePostDto, UpdatePostDto } from "./post.validation";
import { PostVisibilityEnum, RoleEnum } from "../../common/enums";

export class PostService {
  private readonly MAX_ATTACHMENTS = 10;

  private readonly postRepository: PostRepository;
  private readonly commentRepository: CommentRepository;
  private readonly userRepository: UserRepository;
  private readonly s3: S3Service;
  private readonly postHelper: PostHelper;

  constructor(
    postRepository = new PostRepository(),
    commentRepository = new CommentRepository(),
    userRepository = new UserRepository(),
    s3 = s3Service,
    postHelperInstance = postHelper,
  ) {
    this.postRepository = postRepository;
    this.commentRepository = commentRepository;
    this.userRepository = userRepository;
    this.s3 = s3;
    this.postHelper = postHelperInstance;
  }



  // Create

  async createPost({ content, visibility, tags, location }: CreatePostDto, files: Express.Multer.File[] = [], user: HydratedDocument<IUser>) {

    if (files.length > this.MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum ${this.MAX_ATTACHMENTS} attachments allowed`);
    }

    const mentions = tags?.length ? await this.postHelper.resolveMentions(tags) : [];

    const folderId = randomUUID();
    const attachments = files.length
      ? await this.s3.uploadMultipleAssets({ files, path: `posts/${folderId}` })
      : [];

    let post: HydratedDocument<IPost>;
    try {
      post = await this.postRepository.createOne({
        data: { createdBy: user._id, content, visibility, tags: mentions, location, folderId, attachments },
      });
    } catch (err) {
      await this.postHelper.safeDeleteAssets(attachments);
      throw err;
    }

    await this.postHelper.notifyNewlyTagged(undefined, mentions, user, "post", {
      entityId: post._id.toString(),
      actionUrl: `/?postId=${post._id.toString()}`,
    });

    return post;
  }

    async sharePost(
    { content, visibility, tags }: SharePostDto,
    { postId }: PostIdParamDto,
    user: HydratedDocument<IUser>,
  ){
    const post = await this.postRepository.findById({ id: postId });
    if (!post) throw new NotFoundException("Post not found");

    if (post.visibility !== PostVisibilityEnum.PUBLIC) {
      throw new ForbiddenException("You are not allowed to share this post");
    }

    // Resolve the original root post (flatten chained shares like Facebook)
    const rootPostId = (post.sharedFrom?.originalPostId ?? postId) as unknown as Types.ObjectId;
    const rootAuthorId = (post.sharedFrom?.originalAuthorId ?? post.createdBy) as unknown as Types.ObjectId;

    // Resolve mentions / tags
    const mentions = tags?.length ? await this.postHelper.resolveMentions(tags) : [];

    const folderId = randomUUID();
    const sharedPost = await this.postRepository.createOne({
      data: {
        createdBy: user._id,
        folderId,
        content: content || undefined,
        visibility,
        tags: mentions,
        attachments: [],
        sharedFrom: {
          originalPostId: rootPostId,
          originalAuthorId: rootAuthorId,
        },
      },
    });

    // Increment shareCount on the root post
    await this.postRepository.updateOne({
      filter: { _id: rootPostId.toString() },
      update: { $inc: { shareCount: 1 } },
    });

    // Notify tagged users and root author (best effort)
    await this.postHelper.notifyNewlyTagged(undefined, mentions, user, "post", {
      entityId: sharedPost._id.toString(),
      actionUrl: `/?postId=${sharedPost._id.toString()}`,
    });
    await this.postHelper.notifyAuthor(rootAuthorId, user, "shared your post", {
      entityType: "post",
      entityId: rootPostId.toString(),
      actionUrl: `/?postId=${rootPostId.toString()}`,
    });

    return sharedPost;
  }

  // Read

  async getPosts(
    { page, limit, search }: PaginationDto,
    user: HydratedDocument<IUser>,
  ): Promise<IPagination<FlattenMaps<IPost>>> {
    return this.postRepository.paginate({
      filter: {
        $or: getVisibility(user),
        ...(search && { content: { $regex: escapeRegex(search), $options: "i" } }),
      },
      populate: POST_POPULATE,
      projection: { comments: 0 },
      page,
      limit,
      sort: { createdAt: -1 },
    });
  }

  async getPostById({ postId }: PostIdParamDto, user: HydratedDocument<IUser>): Promise<FlattenMaps<IPost>> {
    const post = await this.postRepository.findOne({
      filter: { _id: postId, $or: getVisibility(user) },
      populate: POST_POPULATE,
    });

    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  async getUserPosts(
    targetUserId: string,
    { page, limit, search }: PaginationDto,
    viewer: HydratedDocument<IUser>,
  ): Promise<IPagination<FlattenMaps<IPost>>> {
    const targetUser = await this.userRepository.findById({ id: targetUserId });
    if (!targetUser) {
      throw new NotFoundException("User not found");
    }

    const isAuthor = viewer._id.toString() === targetUserId;

    if (!isAuthor) {
      const viewerBlocked = (viewer.blockedUsers || []).map(String);
      const targetBlocked = (targetUser.blockedUsers || []).map(String);
      if (viewerBlocked.includes(targetUserId) || targetBlocked.includes(viewer._id.toString())) {
        throw new NotFoundException("User not found");
      }
    }

    const isFriend = (viewer.friends || []).map(String).includes(targetUserId);

    let visibilityFilter: Record<string, any>;
    if (isAuthor) {
      visibilityFilter = { createdBy: targetUserId };
    } else if (isFriend) {
      visibilityFilter = {
        createdBy: targetUserId,
        $or: [
          { visibility: { $in: [PostVisibilityEnum.PUBLIC, PostVisibilityEnum.FRIENDS] } },
          { tags: { $in: [viewer._id] } },
        ],
      };
    } else {
      visibilityFilter = {
        createdBy: targetUserId,
        $or: [
          { visibility: PostVisibilityEnum.PUBLIC },
          { tags: { $in: [viewer._id] } },
        ],
      };
    }

    return this.postRepository.paginate({
      filter: {
        ...visibilityFilter,
        ...(search && { content: { $regex: escapeRegex(search), $options: "i" } }),
      },
      populate: POST_POPULATE,
      projection: { comments: 0 },
      page,
      limit,
      sort: { createdAt: -1 },
    });
  }

  // Update

  async updatePost(
    { content, visibility, tags, location, removeAttachments = [] }: UpdatePostDto,
    files: Express.Multer.File[] = [],
    { postId }: PostIdParamDto,
    user: HydratedDocument<IUser>,
  ) {
    const post = await this.postRepository.findById({ id: postId });
    if (!post) throw new NotFoundException("Post not found");

    if (post.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException("You are not allowed to update this post");
    }

    // ── attachments: compute resulting state and validate before any side effect ──
    const current = post.attachments ?? [];
    const toRemove = new Set(removeAttachments);
    const removedKeys = current.filter((key) => toRemove.has(key));
    const survivors = current.filter((key) => !toRemove.has(key));
    const totalAttachments = survivors.length + files.length;

    if (!(content ?? post.content) && totalAttachments === 0 && !post.sharedFrom) {
      throw new BadRequestException("Post must have either content or at least one attachment");
    }
    if (totalAttachments > this.MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum ${this.MAX_ATTACHMENTS} attachments allowed`);
    }

    // ── tags: undefined = untouched, [] = clear, [...] = replace ──
    const mentions = tags === undefined ? undefined : await this.postHelper.resolveMentions(tags);

    // ── upload new files ──
    const newAttachments = files.length
      ? await this.s3.uploadMultipleAssets({ files, path: `posts/${post.folderId}` })
      : [];

    const attachmentsChanged = files.length > 0 || removedKeys.length > 0;

    const contentChanged = content !== undefined || attachmentsChanged;

    // ── commit; roll back uploads on any failure ──
    let updatedPost: HydratedDocument<IPost> | null;
    try {
      updatedPost = await this.postRepository.findOneAndUpdate({
        filter: { _id: postId, createdBy: user._id },
        update: {
          ...(content !== undefined && { content }),
          ...(visibility !== undefined && { visibility }),
          ...(mentions !== undefined && { tags: mentions }),
          ...(location !== undefined && location !== null && { location }),
          ...(location === null && { $unset: { location: 1 } }),
          ...(attachmentsChanged && { attachments: [...survivors, ...newAttachments] }),
          updatedBy: user._id,
          ...(contentChanged && { isEdited: true }),
        },
      });
    } catch (err) {
      await this.postHelper.safeDeleteAssets(newAttachments);
      throw err;
    }

    if (!updatedPost) {
      await this.postHelper.safeDeleteAssets(newAttachments);
      throw new NotFoundException("Post not found");
    }

    // ── post-commit side effects must never fail the request ──
    await this.postHelper.safeDeleteAssets(removedKeys);
    await this.postHelper.notifyNewlyTagged(
      post.tags as Types.ObjectId[] | undefined,
      mentions,
      user,
      "post",
      {
        entityId: postId,
        postId,
        actionUrl: `/?postId=${postId}`,
      },
    );

    return updatedPost;
  }

  // Reactions

  async reactAtPost({ reaction }: ReactAtPostDto, { postId }: PostIdParamDto, user: HydratedDocument<IUser>) {
    const post = await this.postRepository.findById({ id: postId });
    if (!post) throw new NotFoundException("Post not found");

    const existingReaction = post.reactions?.find((r) => r.createdBy.toString() === user._id.toString());

    // same reaction again = toggle off
    if (existingReaction?.reactionType === reaction) {
      await this.postRepository.updateOne({
        filter: { _id: postId, "reactions.createdBy": user._id },
        update: RemoveReactionUpdate(user._id, reaction),
      });
    } else if (existingReaction) {
      // different reaction = swap (reactionsCount stays constant, breakdown shifts)
      await this.postRepository.updateOne({
        filter: { _id: postId, "reactions.createdBy": user._id },
        update: {
          $pull: { reactions: { createdBy: user._id } },
          $inc: { [`reactionsBreakdown.${existingReaction.reactionType}`]: -1 },
        },
      });
      await this.postRepository.updateOne({
        filter: { _id: postId },
        update: {
          $push: { reactions: { reactionType: reaction, createdBy: user._id, createdAt: new Date() } },
          $inc: { [`reactionsBreakdown.${reaction}`]: 1 },
        },
      });
    } else {
      // new reaction = add with concurrency guard to avoid duplicates
      await this.postRepository.updateOne({
        filter: { _id: postId, "reactions.createdBy": { $ne: user._id } },
        update: AddReactionUpdate(user._id, reaction),
      });

      // Notify post author (if not self)
      await this.postHelper.notifyAuthor(
        post.createdBy,
        user,
        `reacted with ${reaction} to your post`,
        {
          entityType: "post",
          entityId: postId,
          actionUrl: `/?postId=${postId}`,
        },
      );
    }

    const updatedPost = await this.postRepository.findById({
      id: postId,
      projection: { reactionsCount: 1, reactionsBreakdown: 1 },
    });
    if (!updatedPost) throw new NotFoundException("Post not found");

    return updatedPost;
  }

  // Delete / restore

  async softDeletePost({ postId }: PostIdParamDto, user: HydratedDocument<IUser>) {
    const post = await this.postRepository.findById({ id: postId });
    if (!post) throw new NotFoundException("Post not found");

    const isAllowed = user.role === RoleEnum.Admin || post.createdBy.toString() === user._id.toString();
    if (!isAllowed) throw new ForbiddenException("You are not allowed to delete this post");

    const deletedPost = await this.postRepository.findOneAndUpdate({
      filter: { _id: postId },
      update: { deletedAt: new Date(), updatedBy: user._id },
    });

    if (!deletedPost) throw new NotFoundException("Post not found");

    if (deletedPost.sharedFrom?.originalPostId) {
      const rootId =
        (deletedPost.sharedFrom.originalPostId as { _id?: Types.ObjectId })._id?.toString() ??
        deletedPost.sharedFrom.originalPostId.toString();
      await this.postRepository.updateOne({
        filter: { _id: rootId },
        update: { $inc: { shareCount: -1 } },
      });
    }

    return deletedPost;
  }

  async restorePost({ postId }: PostIdParamDto, user: HydratedDocument<IUser>) {
    const post = await this.postRepository.findOne({
      filter: { _id: postId, paranoid: false },
    });
    if (!post) throw new NotFoundException("Post not found");

    const isAllowed = user.role === RoleEnum.Admin || post.createdBy.toString() === user._id.toString();
    if (!isAllowed) throw new ForbiddenException("You are not allowed to restore this post");

    const restoredPost = await this.postRepository.findOneAndUpdate({
      filter: { _id: postId, paranoid: false },
      update: { restoredAt: new Date(), updatedBy: user._id },
    });

    if (!restoredPost) throw new NotFoundException("Post not found");

    if (restoredPost.sharedFrom?.originalPostId) {
      const rootId =
        (restoredPost.sharedFrom.originalPostId as { _id?: Types.ObjectId })._id?.toString() ??
        restoredPost.sharedFrom.originalPostId.toString();
      await this.postRepository.updateOne({
        filter: { _id: rootId },
        update: { $inc: { shareCount: 1 } },
      });
    }

    return restoredPost;
  }

  /**
   * Cascade cleanup for a post: decrement root share count if shared, delete comments, and clean up S3 assets/folder.
   */
public async cleanUpPostCascade(post: {
  _id: Types.ObjectId | string;
  attachments?: string[] | undefined;
  folderId?: string | undefined;
  deletedAt?: Date | undefined;
  sharedFrom?: { originalPostId: Types.ObjectId | { _id?: Types.ObjectId } } | undefined;
}) {
  // 1. Decrement the original post's share count (best effort)
  if (post.sharedFrom?.originalPostId && !post.deletedAt) {
    try {
      const rootId =
        (post.sharedFrom.originalPostId as { _id?: Types.ObjectId })._id?.toString() ??
        post.sharedFrom.originalPostId.toString();

      await this.postRepository.updateOne({
        filter: { _id: rootId, shareCount: { $gt: 0 } },
        update: { $inc: { shareCount: -1 } },
      });
    } catch (err) {
      console.error("Failed to decrement shareCount for original post:", err);
    }
  }

  // 2. Collect comment attachments
  let comments: { attachments?: string[] | undefined}[] = [];
  try {
    comments = await this.commentRepository.find({
      filter: { postId: post._id },
      projection: { attachments: 1 },
    });
  } catch (err) {
    console.error("Failed to load comments for post cleanup:", err);
  }

  // 3. Delete assets and S3 folder independently so one failure doesn't block the other
  const allAssetKeys = [
    ...new Set([
      ...(post.attachments ?? []),
      ...comments.flatMap((c) => c.attachments ?? []),
    ]),
  ];

  const tasks: Promise<unknown>[] = [];

  if (allAssetKeys.length > 0) {
    tasks.push(this.postHelper.safeDeleteAssets(allAssetKeys));
  }

  if (post.folderId) {
    tasks.push(
      this.s3.deleteFolderByPrefix({
        prefix: `posts/${post.folderId}/`,
      }),
    );
  }

  const results = await Promise.allSettled(tasks);
  const assetsFailed = results.some((r) => r.status === "rejected");
  results.forEach((r) => {
    if (r.status === "rejected") {
      console.error("Failed to clean up post assets:", r.reason);
    }
  });

  // 4. Delete comments last, and only if asset cleanup succeeded,
  //    so a retry can still find the attachment keys
  if (!assetsFailed) {
    try {
      await this.commentRepository.deleteMany({ filter: { postId: post._id } });
    } catch (err) {
      console.error("Failed to delete comments for post:", err);
    }
  }
}

  async hardDeletePost({ postId }: PostIdParamDto, user: HydratedDocument<IUser>) {
    const post = await this.postRepository.findById({ id: postId });
    if (!post) throw new NotFoundException("Post not found");

    const isAllowed = user.role === RoleEnum.Admin || post.createdBy.toString() === user._id.toString();
    if (!isAllowed) throw new ForbiddenException("You are not allowed to delete this post");

    const deletedPost = await this.postRepository.findOneAndDelete({
      filter: { _id: postId },
    });

    if (!deletedPost) throw new NotFoundException("Post not found");

    await this.cleanUpPostCascade(deletedPost);

    return deletedPost;
  }

  /** Delete all posts created by a specific user with full cascade cleanup. */
  async deleteUserPosts(userId: Types.ObjectId | string) {
    const userPosts = await this.postRepository.find({
      filter: { createdBy: userId, paranoid: false },
      projection: { _id: 1, folderId: 1, attachments: 1, sharedFrom: 1, deletedAt: 1 },
      options: { lean: true },
    });

    if (!userPosts.length) return;

    for (const post of userPosts) {
      await this.cleanUpPostCascade(post as any);
    }

    await this.postRepository.deleteMany({
      filter: { createdBy: userId, force: true },
    });
  }

  /** Soft delete all posts authored by a user. */
  async softDeleteUserPosts(userId: Types.ObjectId | string) {
    await this.postRepository.updateMany({
      filter: { createdBy: userId },
      update: { deletedAt: new Date() },
    });
  }

  /** Restore all soft-deleted posts authored by a user. */
  async restoreUserPosts(userId: Types.ObjectId | string) {
    await this.postRepository.updateMany({
      filter: { createdBy: userId, paranoid: false },
      update: { restoredAt: new Date() },
    });
  }

  /** Remove all reactions created by a specific user from other posts and adjust counters. */
  async removeUserReactions(userId: Types.ObjectId | string) {
    const posts = await this.postRepository.find({
      filter: { "reactions.createdBy": userId },
      projection: { _id: 1, reactions: 1 },
      options: { lean: true },
    });

    if (!posts.length) return;

    const operations = posts.map((post) => {
      const reaction = post.reactions?.find((r) => r.createdBy.toString() === userId.toString());
      const reactionType = reaction?.reactionType;
      return {
        updateOne: {
          filter: { _id: post._id, "reactions.createdBy": userId },
          update: {
            $pull: { reactions: { createdBy: userId } },
            $inc: {
              reactionsCount: -1,
              ...(reactionType ? { [`reactionsBreakdown.${reactionType}`]: -1 } : {}),
            },
          },
        },
      };
    });

    await this.postRepository.bulkWrite({ operations: operations as any });
  }
}

export const postService = new PostService();