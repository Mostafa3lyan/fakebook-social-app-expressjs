import { Router, type NextFunction, type Request, type Response } from "express";
import { RoleEnum, TokenTypeEnum } from "../../common/enums";
import { successResponse } from "../../common/response";
import { tokenService } from "../../common/services";
import { decodedTypes } from "../../common/types/user.types";
import { PaginationDto, paginationValidationSchema } from "../../common/validation";
import { authentication, authorization, validation } from "../../middleware";
import { userService } from "./user.service";
import * as validators from "./user.validation";

const router = Router();

// User Profile
router.get("/",
  authentication(),
  authorization([RoleEnum.User, RoleEnum.Admin]),
  async (req: Request, res: Response) => {
    const profile = await userService.profile(req.user);
    return successResponse({
      res,
      data: { profile },
    });
  },
);

// Update Profile
router.patch(
  "/profile",
  authentication(),
  validation(validators.updateProfileSchema),
  async (req: Request, res: Response) => {
    const profile = await userService.updateProfile(req.body, req.user);
    return successResponse({
      message: "Profile updated successfully",
      res,
      data: { profile },
    });
  },
);

// Search Users
router.get(
  "/search",
  authentication(),
  validation(validators.searchUserSchema),
  async (req: Request, res: Response) => {
    const result = await userService.searchUsers(
      req.query as unknown as validators.SearchUserDto,
      req.user,
    );
    return successResponse({
      res,
      data: { users: result },
    });
  },
);

// Get Blocked Users List
router.get(
  "/blocked",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const result = await userService.getBlockedUsers(
      req.user,
      req.query as PaginationDto,
    );
    return successResponse({
      res,
      data: { blockedUsers: result },
    });
  },
);

// Block User
router.post(
  "/block/:targetUserId",
  authentication(),
  validation(validators.targetUserParamSchema),
  async (req: Request, res: Response) => {
    const result = await userService.blockUser(
      req.user,
      req.params.targetUserId as string,
    );
    return successResponse({
      message: result.message,
      res,
    });
  },
);

// Unblock User
router.delete(
  "/unblock/:targetUserId",
  authentication(),
  validation(validators.targetUserParamSchema),
  async (req: Request, res: Response) => {
    const result = await userService.unblockUser(
      req.user,
      req.params.targetUserId as string,
    );
    return successResponse({
      message: result.message,
      res,
    });
  },
);

// Logout
router.post(
  "/logout",
  authentication(),
  validation(validators.logoutSchema),
  async (req: Request, res: Response) => {
    const status = await userService.logout(req.body, req.user, req.decoded as decodedTypes);
    return successResponse({ res, status });
  },
);

// Rotate Token
router.post(
  "/rotate-token",
  authentication(TokenTypeEnum.refresh),
  async (req: Request, res: Response) => {
    const credentials = await userService.rotateToken(
      req.user,
      req.decoded as decodedTypes,
      `${req.protocol}://${req.host}`,
    );
    return successResponse({
      res,
      status: 201,
      data: { ...credentials },
    });
  },
);

// Share User Profile
router.get(
  "/:userId/share-profile",
  async (req: Request, res: Response, next: NextFunction) => {
    if (req?.headers?.authorization) {
      const { user, decoded } = await tokenService.decodeToken({
        token: req.headers.authorization.split(" ")[1] as string,
        tokenType: TokenTypeEnum.access,
      });

      req.user = user;
      req.decoded = decoded;
    }
    return next();
  },
  validation(validators.shareProfile),
  async (req: Request, res: Response) => {
    const account = await userService.shareProfile(req.params.userId as unknown as validators.ShareProfileDto, req.user);
    return successResponse({
      res,
      data: { account },
    });
  },
);



// Request pre-signed S3 URL for a new profile image.
// The returned `key` is stored as `profilePicture`; the client then PUTs the
// binary directly to `url`.
router.patch(
  "/profile-image",
  authentication(),
  validation(validators.presignedImageSchema),
  async (req: Request, res: Response) => {
    const data = await userService.profileImage(
      req.body as validators.PresignedImageDto,
      req.user,
    );
    return successResponse({ res, data });
  },
);

// remove Profile Image
router.delete(
  "/remove-profile-image",
  authentication(),
  async (req: Request, res: Response) => {
    const user = await userService.removeProfileImage(req.user);
    return successResponse({
      message: "Profile image removed successfully",
      res,
      data: { user },
    });
  },
);

// Request pre-signed S3 URL for a new cover image.
// The returned `key` replaces `profileCoverPictures`; the client then PUTs the
// binary directly to `url`.
router.patch(
  "/profile-cover-image",
  authentication(),
  validation(validators.presignedImageSchema),
  async (req: Request, res: Response) => {
    const data = await userService.profileCoverImage(
      req.body as validators.PresignedImageDto,
      req.user,
    );
    return successResponse({ res, data });
  },
);

// remove Cover Image
router.delete(
  "/remove-profile-cover-image",
  authentication(),
  async (req: Request, res: Response) => {
    const user = await userService.removeProfileCoverImage(req.user);
    return successResponse({
      message: "Cover image removed successfully",
      res,
      data: { user },
    });
  },
);

// Change Password
router.patch(
  "/change-password",
  authentication(),
  validation(validators.changePasswordSchema),
  async (req: Request, res: Response) => {
    const credentials = await userService.changePassword(
      req.body,
      req.user,
      `${req.protocol}://${req.host}`,
    );
    return successResponse({
      res,
      data: { ...credentials },
    });
  },
);


// Soft delete account (deactivate with 30-day restore window)
router.delete(
  "/soft-delete",
  authentication(),
  async (req: Request, res: Response) => {
    const result = await userService.softDeleteAccount(req.user);
    return successResponse({
      message: result.message,
      res,
    });
  },
);

// Restore deactivated account
router.patch(
  "/restore-account",
  validation(validators.restoreAccountSchema),
  async (req: Request, res: Response) => {
    const credentials = await userService.restoreAccount(
      req.body,
      `${req.protocol}://${req.host}`,
    );
    return successResponse({
      message: "Account restored successfully",
      res,
      data: { ...credentials },
    });
  },
);

// Hard delete account (permanent purge with full cascade)
router.delete(
  "/delete-account",
  authentication(),
  async (req: Request, res: Response) => {
    const result = await userService.hardDeleteAccount(req.user);
    return successResponse({
      message: result.message,
      res,
    });
  },
);

export default router;