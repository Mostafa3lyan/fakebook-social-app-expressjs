import { Router, type Request, type Response } from "express";
import { successResponse } from "../../common/response";
import { PaginationDto, paginationValidationSchema } from "../../common/validation";
import { authentication, userActionRateLimiter, validation } from "../../middleware";
import { friendsService } from "./friends.service";
import * as validators from "./friends.validation";

const router = Router();

// Send friend request
router.post(
  "/request/:receiverId",
  authentication(),
  userActionRateLimiter({
    action: "send_friend_request",
    limit: 20,
    windowSeconds: 3600,
    message: "You have reached the limit of 20 friend requests per hour. Please try again later.",
  }),
  validation(validators.receiverParamSchema),
  async (req: Request, res: Response) => {
    const request = await friendsService.sendFriendRequest(
      req.user,
      req.params.receiverId as string,
    );
    return successResponse({
      message: "Friend request sent successfully",
      status: 201,
      res,
      data: { request },
    });
  },
);

// Accept friend request
router.patch(
  "/accept/:requestId",
  authentication(),
  validation(validators.requestIdParamSchema),
  async (req: Request, res: Response) => {
    const result = await friendsService.acceptFriendRequest(
      req.user,
      req.params.requestId as string,
    );
    return successResponse({
      message: result.message,
      res,
    });
  },
);

router.patch(
  "/reject/:requestId",
  authentication(),
  validation(validators.requestIdParamSchema),
  async (req: Request, res: Response) => {
  const result = await friendsService.rejectFriendRequest(
    req.user,
    req.params.requestId as string,
  );
  return successResponse({
    message: result.message,
    res,
  });
  }
);

// Cancel outgoing friend request
router.delete(
  "/cancel/:requestId",
  authentication(),
  validation(validators.requestIdParamSchema),
  async (req: Request, res: Response) => {
    const result = await friendsService.cancelFriendRequest(
      req.user,
      req.params.requestId as string,
    );
    return successResponse({
      message: result.message,
      res,
    });
  },
);

// Remove friend
router.delete(
  "/unfriend/:friendId",
  authentication(),
  validation(validators.friendIdParamSchema),
  async (req: Request, res: Response) => {
    const result = await friendsService.removeFriend(
      req.user,
      req.params.friendId as string,
    );
    return successResponse({
      message: result.message,
      res,
    });
  },
);

// Get incoming pending friend requests
router.get(
  "/requests/received",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const requests = await friendsService.getIncomingRequests(
      req.user,
      req.query as PaginationDto,
    );
    return successResponse({
      res,
      data: { requests },
    });
  },
);

// Get outgoing pending friend requests
router.get(
  "/requests/sent",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const requests = await friendsService.getOutgoingRequests(
      req.user,
      req.query as PaginationDto,
    );
    return successResponse({
      res,
      data: { requests },
    });
  },
);

// Get relationship status with target user
router.get(
  "/status/:targetUserId",
  authentication(),
  validation(validators.targetUserParamSchema),
  async (req: Request, res: Response) => {
    const status = await friendsService.getRelationshipStatus(
      req.user,
      req.params.targetUserId as string,
    );
    return successResponse({
      res,
      data: { status },
    });
  },
);

// Get logged-in user's friends list
router.get(
  "/",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const friends = await friendsService.getFriends(
      req.user._id.toString(),
      req.query as PaginationDto,
    );
    return successResponse({
      res,
      data: { friends },
    });
  },
);

// Get any user's friends list
router.get(
  "/user/:userId",
  authentication(),
  validation(paginationValidationSchema),
  async (req: Request, res: Response) => {
    const friends = await friendsService.getFriends(
      req.params.userId as string,
      req.query as PaginationDto,
    );
    return successResponse({
      res,
      data: { friends },
    });
  },
);

export default router;
