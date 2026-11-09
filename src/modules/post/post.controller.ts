import { Router, type Request, type Response } from "express";
import { authentication, userActionRateLimiter, validation } from "../../middleware";
import { successResponse } from "../../common/response";
import { postService } from "./post.service";
import * as validators from "./post.validation";
import { cloudFileUpload, fileFieldValidation } from "../../common/utils/multer";
import { PaginationDto, paginationValidationSchema } from "../../common/validation";

// post.controller.ts

const router = Router();

// Create post
router.post(
  "/",
  authentication(),
  userActionRateLimiter({
    action: "create_post",
    limit: 5,
    windowSeconds: 60,
    message: "You can only create up to 5 posts per minute. Please slow down.",
  }),
  cloudFileUpload({ validation: fileFieldValidation.image }).array("attachments", 10),
  validation(validators.createPostSchema),
  async (req: Request, res: Response) => {
    const post = await postService.createPost(req.body, req.files as Express.Multer.File[], req.user);
    return successResponse({ res, status: 201, data: { post } });
  },
);

// List posts (folder / author feed)
router.get(
  "/",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const posts = await postService.getPosts(req.query as PaginationDto, req.user);
    return successResponse({ res, data: { posts } });
  },
);

// Get posts by user
router.get(
  "/user/:userId",
  authentication(),
  validation(validators.userIdParamSchema),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const posts = await postService.getUserPosts(
      req.params.userId as string,
      req.query as PaginationDto,
      req.user,
    );
    return successResponse({ res, data: { posts } });
  },
);

// Get single post
router.get(
  "/:postId",
  authentication(),
  validation(validators.postParamSchema),
  async (req: Request, res: Response) => {
    const post = await postService.getPostById(req.params as validators.PostIdParamDto, req.user);
    return successResponse({ res, data: { post } });
  },
);

// Share post
router.post(
  "/:postId/share",
  authentication(),
  validation(validators.sharePostSchema),
  async (req: Request, res: Response) => {
    const post = await postService.sharePost(
      req.body as validators.SharePostDto,
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, status: 201, data: { post } });
  },
);

// Update post
router.patch(
  "/:postId",
  authentication(),
  cloudFileUpload({ validation: fileFieldValidation.image }).array("attachments", 10),
  validation(validators.updatePostSchema),
  async (req: Request, res: Response) => {
    const post = await postService.updatePost(
      req.body,
      req.files as Express.Multer.File[],
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { post } });
  },
);

// React at post
router.post(
  "/:postId/react",
  authentication(),
  validation(validators.reactAtPostSchema),
  async (req: Request, res: Response) => {
    const post = await postService.reactAtPost(
      req.body,
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { post } });
  },
);

// Soft delete (author or admin)
router.delete(
  "/:postId/soft-delete",
  authentication(),
  validation(validators.postParamSchema),
  async (req: Request, res: Response) => {
    const post = await postService.softDeletePost(
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { post } });
  },
);

// Restore (author or admin)
router.patch(
  "/:postId/restore",
  authentication(),
  validation(validators.postParamSchema),
  async (req: Request, res: Response) => {
    const post = await postService.restorePost(
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { post } });
  },
);

// Hard delete (author or admin)
router.delete(
  "/:postId",
  authentication(),
  validation(validators.postParamSchema),
  async (req: Request, res: Response) => {
    const post = await postService.hardDeletePost(
      req.params as validators.PostIdParamDto,
      req.user,
    );
    return successResponse({ res, data: { post } });
  },
);

export default router;