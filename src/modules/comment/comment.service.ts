// comment.service.ts
import { FlattenMaps, HydratedDocument, Types } from "mongoose";
import { CommentRepository, PostRepository } from "../../DB/repository";
import { BadRequestException, ForbiddenException, NotFoundException } from "../../common/exceptions";
import { s3Service, S3Service } from "../../common/services";
import { IComment, IPagination, IPost, IUser } from "../../common/interfaces";
import { escapeRegex } from "../../common/utils";
import {
  AUTHOR_POPULATE,
  getVisibility,
  PostHelper,
  postHelper,
  AddReactionUpdate,
  RemoveReactionUpdate,
} from "../post/post.helper";
import { PaginationDto } from "../../common/validation";
import { RoleEnum } from "../../common/enums";
import {
  CommentIdParamDto,
  CreateCommentDto,
  PostIdParamDto,
  ReactAtCommentDto,
  UpdateCommentDto,
} from "./comment.validation";

export class CommentService {
  private readonly MAX_ATTACHMENTS = 2;

  private readonly postRepository: PostRepository;
  private readonly commentRepository: CommentRepository;
  private readonly s3: S3Service;
  private readonly postHelper: PostHelper;

  constructor(
    commentRepository = new CommentRepository(),
    postRepository = new PostRepository(),
    s3 = s3Service,
    postHelperInstance = postHelper,
  ) {
    this.commentRepository = commentRepository;
    this.postRepository = postRepository;
    this.s3 = s3;
    this.postHelper = postHelperInstance;
  }

  // Private helpers

  /** A user can only interact with comments of a post they are allowed to see. */
  private async getVisiblePost(postId: string, user: HydratedDocument<IUser>) {
    const post = await this.postRepository.findOne({
      filter: { _id: postId, $or: getVisibility(user) },
      projection: { folderId: 1, createdBy: 1 },
    });
    if (!post) throw new NotFoundException("Post not found");
    return post as unknown as HydratedDocument<IPost>;
  }

  private async getCommentOfPost(postId: string, commentId: string) {
    const comment = await this.commentRepository.findOne({
      filter: { _id: commentId, postId },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    return comment as unknown as HydratedDocument<IComment>;
  }



  /** Shared create logic for top-level comments and replies. */
  private async insertComment(
    dto: CreateCommentDto,
    files: Express.Multer.File[],
    user: HydratedDocument<IUser>,
    post: HydratedDocument<IPost>,
    parent?: HydratedDocument<IComment>,
  ) {
    const { content, tags } = dto;

    if (files.length > this.MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum ${this.MAX_ATTACHMENTS} attachments allowed`);
    }

    const mentions = tags?.length ? await this.postHelper.resolveMentions(tags) : [];

    const attachments = files.length
      ? await this.s3.uploadMultipleAssets({ files, path: `posts/${post.folderId}/comments` })
      : [];

    let comment: HydratedDocument<IComment>;
    try {
      comment = await this.commentRepository.createOne({
        data: {
          postId: post._id,
          ...(parent && { commentId: parent._id }),
          createdBy: user._id,
          content,
          tags: mentions,
          attachments,
        },
      });
    } catch (err) {
      await this.postHelper.safeDeleteAssets(attachments);
      throw err;
    }

    // counters / notifications must never fail the request
    try {
      await this.postRepository.updateOne({ filter: { _id: post._id }, update: { $inc: { commentsCount: 1 } } });
      if (parent) {
        await this.commentRepository.updateOne({ filter: { _id: parent._id }, update: { $inc: { repliesCount: 1 } } });
      }
    } catch (err) {
      console.error("Failed to update counters:", err);
    }

    await this.postHelper.notifyNewlyTagged(undefined, mentions, user, "comment", {
      entityId: comment._id.toString(),
      postId: post._id.toString(),
      commentId: comment._id.toString(),
      ...(parent ? { parentCommentId: parent._id.toString() } : {}),
      actionUrl: parent
        ? `/?postId=${post._id.toString()}&commentId=${comment._id.toString()}&parentCommentId=${parent._id.toString()}`
        : `/?postId=${post._id.toString()}&commentId=${comment._id.toString()}`,
    });
    if (parent) {
      await this.postHelper.notifyAuthor(parent.createdBy, user, "replied to your comment", {
        entityType: "comment",
        entityId: comment._id.toString(),
        postId: post._id.toString(),
        commentId: comment._id.toString(),
        parentCommentId: parent._id.toString(),
        actionUrl: `/?postId=${post._id.toString()}&commentId=${comment._id.toString()}&parentCommentId=${parent._id.toString()}`,
      });
    } else {
      await this.postHelper.notifyAuthor(post.createdBy, user, "commented on your post", {
        entityType: "comment",
        entityId: comment._id.toString(),
        postId: post._id.toString(),
        commentId: comment._id.toString(),
        actionUrl: `/?postId=${post._id.toString()}&commentId=${comment._id.toString()}`,
      });
    }

    return comment;
  }

  // Create

  async createComment(
    dto: CreateCommentDto,
    files: Express.Multer.File[] = [],
    { postId }: PostIdParamDto,
    user: HydratedDocument<IUser>,
  ) {
    const post = await this.getVisiblePost(postId, user);
    return this.insertComment(dto, files, user, post);
  }

  async replyOnComment(
    dto: CreateCommentDto,
    files: Express.Multer.File[] = [],
    { postId, commentId }: CommentIdParamDto,
    user: HydratedDocument<IUser>,
  ) {
    const post = await this.getVisiblePost(postId, user);
    const parent = await this.getCommentOfPost(postId, commentId);
    return this.insertComment(dto, files, user, post, parent);
  }

  // Read

  async getComments(
    { postId }: PostIdParamDto,
    { page, limit, search }: PaginationDto,
    user: HydratedDocument<IUser>,
  ): Promise<IPagination<FlattenMaps<IComment>>> {
    await this.getVisiblePost(postId, user);

    return this.commentRepository.paginate({
      filter: {
        postId,
        commentId: { $exists: false },
        ...(search && { content: { $regex: escapeRegex(search), $options: "i" } }),
      },
      populate: AUTHOR_POPULATE,
      page,
      limit,
      sort: { createdAt: -1 },
    });
  }

  async getReplies(
    { postId, commentId }: CommentIdParamDto,
    { page, limit, search }: PaginationDto,
    user: HydratedDocument<IUser>,
  ): Promise<IPagination<FlattenMaps<IComment>>> {
    await this.getVisiblePost(postId, user);

    return this.commentRepository.paginate({
      filter: {
        postId,
        commentId,
        ...(search && { content: { $regex: escapeRegex(search), $options: "i" } }),
      },
      populate: AUTHOR_POPULATE,
      page,
      limit,
      sort: { createdAt: 1 },
    });
  }

  async getCommentById({ postId, commentId }: CommentIdParamDto, user: HydratedDocument<IUser>) {
    await this.getVisiblePost(postId, user);

    const comment = await this.commentRepository.findOne({
      filter: { _id: commentId, postId },
      populate: AUTHOR_POPULATE,
    });

    if (!comment) throw new NotFoundException("Comment not found");
    return comment;
  }

  // Update

  async updateComment(
    dto: UpdateCommentDto,
    files: Express.Multer.File[] = [],
    { postId, commentId }: CommentIdParamDto,
    user: HydratedDocument<IUser>,
  ) {
    const { content, tags, removeAttachments = [] } = dto;

    const comment = await this.getCommentOfPost(postId, commentId);

    if (comment.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException("You are not allowed to update this comment");
    }

    // ── attachments: compute resulting state and validate before any side effect ──
    const current = comment.attachments ?? [];
    const toRemove = new Set(removeAttachments);
    const removedKeys = current.filter((key) => toRemove.has(key));
    const survivors = current.filter((key) => !toRemove.has(key));
    const totalAttachments = survivors.length + files.length;

    if (!(content ?? comment.content) && totalAttachments === 0) {
      throw new BadRequestException("Comment must have either content or at least one attachment");
    }
    if (totalAttachments > this.MAX_ATTACHMENTS) {
      throw new BadRequestException(`Maximum ${this.MAX_ATTACHMENTS} attachments allowed`);
    }

    // ── tags: undefined = untouched, [] = clear, [...] = replace ──
    const mentions = tags === undefined ? undefined : await this.postHelper.resolveMentions(tags);

    // ── upload new files ──
    const post = await this.getVisiblePost(postId, user);
    const newAttachments = files.length
      ? await this.s3.uploadMultipleAssets({ files, path: `posts/${post.folderId}/comments` })
      : [];

    const attachmentsChanged = files.length > 0 || removedKeys.length > 0;

    // ── commit; roll back uploads on any failure ──
    let updatedComment: HydratedDocument<IComment> | null;
    try {
      updatedComment = await this.commentRepository.findOneAndUpdate({
        filter: { _id: commentId, postId, createdBy: user._id },
        update: {
          ...(content !== undefined && { content }),
          ...(mentions !== undefined && { tags: mentions }),
          ...(attachmentsChanged && { attachments: [...survivors, ...newAttachments] }),
          updatedBy: user._id,
          isEdited: true,
        },
      });
    } catch (err) {
      await this.postHelper.safeDeleteAssets(newAttachments);
      throw err;
    }

    if (!updatedComment) {
      await this.postHelper.safeDeleteAssets(newAttachments);
      throw new NotFoundException("Comment not found");
    }

    // ── post-commit side effects must never fail the request ──
    await this.postHelper.safeDeleteAssets(removedKeys);
    const parentIdStr = comment.commentId ? comment.commentId.toString() : undefined;
    await this.postHelper.notifyNewlyTagged(
      comment.tags as Types.ObjectId[] | undefined,
      mentions,
      user,
      "comment",
      {
        entityId: commentId,
        postId,
        commentId,
        ...(parentIdStr ? { parentCommentId: parentIdStr } : {}),
        actionUrl: parentIdStr
          ? `/?postId=${postId}&commentId=${commentId}&parentCommentId=${parentIdStr}`
          : `/?postId=${postId}&commentId=${commentId}`,
      },
    );

    return updatedComment;
  }

  // Reactions

  async reactAtComment(
    { reaction }: ReactAtCommentDto,
    { postId, commentId }: CommentIdParamDto,
    user: HydratedDocument<IUser>,
  ) {
    await this.getVisiblePost(postId, user);
    const comment = await this.getCommentOfPost(postId, commentId);

    const existingReaction = comment.reactions?.find((r) => r.createdBy.toString() === user._id.toString());

    // same reaction again = toggle off
    if (existingReaction?.reactionType === reaction) {
      await this.commentRepository.updateOne({
        filter: { _id: commentId, "reactions.createdBy": user._id },
        update: RemoveReactionUpdate(user._id, reaction),
      });
    } else if (existingReaction) {
      // different reaction = swap (reactionsCount stays constant, breakdown shifts)
      await this.commentRepository.updateOne({
        filter: { _id: commentId, "reactions.createdBy": user._id },
        update: {
          $pull: { reactions: { createdBy: user._id } },
          $inc: { [`reactionsBreakdown.${existingReaction.reactionType}`]: -1 },
        },
      });
      await this.commentRepository.updateOne({
        filter: { _id: commentId },
        update: {
          $push: { reactions: { reactionType: reaction, createdBy: user._id, createdAt: new Date() } },
          $inc: { [`reactionsBreakdown.${reaction}`]: 1 },
        },
      });
    } else {
      // new reaction = add with concurrency guard to avoid duplicates
      await this.commentRepository.updateOne({
        filter: { _id: commentId, "reactions.createdBy": { $ne: user._id } },
        update: AddReactionUpdate(user._id, reaction),
      });

      // Notify comment author (if not self)
      const parentIdStr = comment.commentId ? comment.commentId.toString() : undefined;
      await this.postHelper.notifyAuthor(
        comment.createdBy,
        user,
        `reacted with ${reaction} to your comment`,
        {
          entityType: "comment",
          entityId: commentId,
          postId,
          commentId,
          ...(parentIdStr ? { parentCommentId: parentIdStr } : {}),
          actionUrl: parentIdStr
            ? `/?postId=${postId}&commentId=${commentId}&parentCommentId=${parentIdStr}`
            : `/?postId=${postId}&commentId=${commentId}`,
        },
      );
    }

    const updatedComment = await this.commentRepository.findById({
      id: commentId,
      projection: { reactionsCount: 1, reactionsBreakdown: 1 },
    });
    if (!updatedComment) throw new NotFoundException("Comment not found");

    return updatedComment;
  }

  // Delete

  /** Comment author, post owner, or admin may delete a comment (replies are removed too). */
  async deleteComment({ postId, commentId }: CommentIdParamDto, user: HydratedDocument<IUser>) {
    const post = await this.getVisiblePost(postId, user);
    const comment = await this.getCommentOfPost(postId, commentId);

    const isAllowed =
      user.role === RoleEnum.Admin ||
      comment.createdBy.toString() === user._id.toString() ||
      post.createdBy.toString() === user._id.toString();
    if (!isAllowed) throw new ForbiddenException("You are not allowed to delete this comment");

    // collect the whole reply tree level by level (BFS)
    const descendants: { _id: Types.ObjectId; attachments?: string[] }[] = [];
    let frontier: Types.ObjectId[] = [comment._id];
    while (frontier.length) {
      const level = (await this.commentRepository.find({
        filter: { postId, commentId: { $in: frontier } },
        projection: { _id: 1, attachments: 1 },
        options: { lean: true },
      })) as unknown as { _id: Types.ObjectId; attachments?: string[] }[];
      descendants.push(...level);
      frontier = level.map((r) => r._id);
    }

    const deleted = await this.commentRepository.findOneAndDelete({ filter: { _id: commentId, postId } });
    if (!deleted) throw new NotFoundException("Comment not found");

    // cascade: replies + counters + assets (best effort)
    try {
      if (descendants.length) {
        await this.commentRepository.deleteMany({ filter: { _id: { $in: descendants.map((r) => r._id) } } });
      }

      await this.postHelper.safeDeleteAssets([
        ...(comment.attachments ?? []),
        ...descendants.flatMap((r) => r.attachments ?? []),
      ]);

      await this.postRepository.updateOne({
        filter: { _id: postId },
        update: { $inc: { commentsCount: -(1 + descendants.length) } },
      });
      if (comment.commentId) {
        await this.commentRepository.updateOne({
          filter: { _id: comment.commentId },
          update: { $inc: { repliesCount: -1 } },
        });
      }
    } catch (err) {
      console.error("Failed to cascade comment deletion:", err);
    }

    return deleted;
  }

  /**
   * Delete all comments and replies authored by a user across other posts,
   * cascade delete any replies to those comments, update post and parent comment counters,
   * and clean up S3 attachments.
   */
  async deleteUserComments(userId: Types.ObjectId | string) {
    try {
      const userComments = (await this.commentRepository.find({
        filter: { createdBy: userId },
        projection: { _id: 1, postId: 1, commentId: 1, attachments: 1 },
        options: { lean: true },
      })) as unknown as { _id: Types.ObjectId; postId: Types.ObjectId; commentId?: Types.ObjectId; attachments?: string[] }[];

      if (!userComments.length) return;

      // Collect reply subtrees for user's top-level comments (BFS)
      const topLevelIds = userComments.filter((c) => !c.commentId).map((c) => c._id);
      const descendants: { _id: Types.ObjectId; postId: Types.ObjectId; attachments?: string[] }[] = [];
      let frontier: Types.ObjectId[] = topLevelIds;
      while (frontier.length) {
        const level = (await this.commentRepository.find({
          filter: { commentId: { $in: frontier } },
          projection: { _id: 1, postId: 1, attachments: 1 },
          options: { lean: true },
        })) as unknown as { _id: Types.ObjectId; postId: Types.ObjectId; attachments?: string[] }[];
        descendants.push(...level);
        frontier = level.map((r) => r._id);
      }

      const allCommentsToDelete = [...userComments, ...descendants];
      const allCommentIds = Array.from(new Set(allCommentsToDelete.map((c) => c._id.toString()))).map((id) => new Types.ObjectId(id));
      const deletedIdsSet = new Set(allCommentIds.map((id) => id.toString()));

      // 1. Decrement commentsCount on target posts in bulk
      const postDecrements = new Map<string, number>();
      for (const c of allCommentsToDelete) {
        const pid = c.postId?.toString();
        if (pid) {
          postDecrements.set(pid, (postDecrements.get(pid) || 0) + 1);
        }
      }
      if (postDecrements.size > 0) {
        const postBulkOps = Array.from(postDecrements.entries()).map(([postId, count]) => ({
          updateOne: {
            filter: { _id: postId },
            update: { $inc: { commentsCount: -count } },
          },
        }));
        await this.postRepository.bulkWrite({ operations: postBulkOps as any });
      }

      // 2. Decrement repliesCount on parent comments if parent wasn't also deleted
      const parentDecrements = new Map<string, number>();
      for (const c of userComments) {
        if (c.commentId && !deletedIdsSet.has(c.commentId.toString())) {
          const parentId = c.commentId.toString();
          parentDecrements.set(parentId, (parentDecrements.get(parentId) || 0) + 1);
        }
      }
      if (parentDecrements.size > 0) {
        const commentBulkOps = Array.from(parentDecrements.entries()).map(([parentId, count]) => ({
          updateOne: {
            filter: { _id: parentId },
            update: { $inc: { repliesCount: -count } },
          },
        }));
        await this.commentRepository.bulkWrite({ operations: commentBulkOps as any });
      }

      // 3. Purge S3 attachments for deleted comments and replies
      const allAssetKeys = [
        ...userComments.flatMap((c) => c.attachments ?? []),
        ...descendants.flatMap((d) => d.attachments ?? []),
      ];
      if (allAssetKeys.length > 0) {
        await this.postHelper.safeDeleteAssets(allAssetKeys);
      }

      // 4. Delete comment documents
      await this.commentRepository.deleteMany({
        filter: { _id: { $in: allCommentIds } },
      });
    } catch (err) {
      console.error("Failed to delete user comments cascade:", err);
    }
  }

  /** Remove all reactions created by a specific user from comments and adjust counters. */
  async removeUserReactions(userId: Types.ObjectId | string) {
    try {
      const comments = (await this.commentRepository.find({
        filter: { "reactions.createdBy": userId },
        projection: { _id: 1, reactions: 1 },
        options: { lean: true },
      })) as unknown as { _id: Types.ObjectId; reactions?: { createdBy: Types.ObjectId; reactionType: string }[] }[];

      if (!comments.length) return;

      const operations = comments.map((comment) => {
        const reaction = comment.reactions?.find((r) => r.createdBy.toString() === userId.toString());
        const reactionType = reaction?.reactionType;
        return {
          updateOne: {
            filter: { _id: comment._id, "reactions.createdBy": userId },
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

      await this.commentRepository.bulkWrite({ operations: operations as any });
    } catch (err) {
      console.error("Failed to remove user comment reactions:", err);
    }
  }
}

export const commentService = new CommentService();