import { Router, type Request, type Response } from "express";
import { authentication, userActionRateLimiter, validation } from "../../middleware";
import { successResponse } from "../../common/response";
import { commentService } from "./comment.service";
import * as validators from "./comment.validation";
import { cloudFileUpload, fileFieldValidation } from "../../common/utils/multer";
import { PaginationDto, paginationValidationSchema } from "../../common/validation";

// comment.controller.ts
// Mounted at /post/:postId/comment — mergeParams exposes :postId here.

const router = Router({ mergeParams: true });

// Create comment
router.post(
  "/",
  authentication(),
  userActionRateLimiter({
    action: "create_comment",
    limit: 10,
    windowSeconds: 60,
    message: "You can only post up to 10 comments per minute. Please slow down.",
  }),
  cloudFileUpload({ validation: fileFieldValidation.image }).array("attachments", 10),
  validation(validators.createCommentSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.createComment(
      req.body,
      req.files as Express.Multer.File[],
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, status: 201, data: {comment} });
  },
);

// List top-level comments of a post
router.get(
  "/",
  authentication(),
  validation(validators.getCommentsSchema),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const comments = await commentService.getComments(
      req.params as validators.PostIdParamDto,
      req.query as PaginationDto,
      req.user,
    );
    return successResponse({ res, data: { comments } });
  },
);

// Get single comment
router.get(
  "/:commentId",
  authentication(),
  validation(validators.commentIdSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.getCommentById(req.params as validators.CommentIdParamDto, req.user);
    return successResponse({ res, data: { comment } });
  },
);

// Update comment
router.patch(
  "/:commentId",
  authentication(),
  cloudFileUpload({ validation: fileFieldValidation.image }).array("attachments", 10),
  validation(validators.updateCommentSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.updateComment(
      req.body,
      req.files as Express.Multer.File[],
      req.params as validators.CommentIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { comment } });
  },
);

// Reply on comment
router.post(
  "/:commentId/reply",
  authentication(),
  userActionRateLimiter({
    action: "create_comment",
    limit: 10,
    windowSeconds: 60,
    message: "You can only post up to 10 comments per minute. Please slow down.",
  }),
  cloudFileUpload({ validation: fileFieldValidation.image }).array("attachments", 10),
  validation(validators.replyOnCommentSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.replyOnComment(
      req.body,
      req.files as Express.Multer.File[],
      req.params as validators.CommentIdParamDto,
      req.user,
    );
    return successResponse({ res, status: 201, data: { comment } });
  },
);

// List replies of a comment
router.get(
  "/:commentId/reply",
  authentication(),
  validation(validators.commentIdSchema),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const replies = await commentService.getReplies(
      req.params as validators.CommentIdParamDto,
      req.query as PaginationDto,
      req.user,
    );
    return successResponse({ res, data: { replies } });
  },
);

// React at comment
router.post(
  "/:commentId/react",
  authentication(),
  validation(validators.reactAtCommentSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.reactAtComment(
      req.body,
      req.params as validators.CommentIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { comment } });
  },
);

// Delete (comment author, post owner, or admin)
router.delete(
  "/:commentId",
  authentication(),
  validation(validators.commentIdSchema),
  async (req: Request, res: Response) => {
    const comment = await commentService.deleteComment(req.params as validators.CommentIdParamDto, req.user);
    return successResponse({ res, data: { comment } });
  },
);

export default router;