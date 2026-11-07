import { Router, type Request, type Response } from "express";
import { RoleEnum } from "../../common/enums";
import { successResponse } from "../../common/response";
import { notificationsService } from "../../common/services";
import { authentication, authorization, validation } from "../../middleware";
import * as validators from "./notification.validation";
const router = Router();


// Get in-app notifications
router.get(
  "/",
  authentication(),
  async (req: Request, res: Response) => {
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const page = parseInt((req.query.page as string) || "1", 10);
    const queryParams: { page?: number; limit?: number; after?: string } = { page, limit };
    if (req.query.after) {
      queryParams.after = String(req.query.after);
    }

    const data = await notificationsService.getUserNotifications(
      req.user._id.toString(),
      queryParams,
    );

    return successResponse({
      message: "Notifications fetched successfully",
      res,
      data,
    });
  },
);

// Get unread notification count
router.get(
  "/unread-count",
  authentication(),
  async (req: Request, res: Response) => {
    const data = await notificationsService.getUnreadCount(
      req.user._id.toString(),
    );

    return successResponse({
      res,
      data,
    });
  },
);

// Mark a notification as read
router.patch(
  "/:messageId/read",
  authentication(),
  async (req: Request, res: Response) => {
    await notificationsService.markAsRead(req.params.messageId as string);

    return successResponse({
      message: "Notification marked as read",
      res,
    });
  },
);

// Mark all notifications as read
router.patch(
  "/read-all",
  authentication(),
  async (req: Request, res: Response) => {
    await notificationsService.markAllAsRead(req.user._id.toString());

    return successResponse({
      message: "All notifications marked as read",
      res,
    });
  },
);

router.post(
  "/fcm-token",
  authentication(),
  validation(validators.fcmTokenSchema),
  async (req: Request, res: Response) => {
    const { token } = req.body;

    await notificationsService.sendUserFcmToken(
      req.user._id.toString(),
      token,
    );

    return successResponse({
      message: "FCM token registered successfully",
      res,
    });
  },
);

router.delete(
  "/fcm-token",
  authentication(),
  validation(validators.fcmTokenSchema),
  async (req: Request, res: Response) => {
    const { token } = req.body;

    await notificationsService.removeUserFcmToken(
      req.user._id.toString(),
      token,
    );

    return successResponse({
      message: "FCM token unregistered successfully",
      res,
    });
  },
);

router.post(
  "/notifyNewMessage",
  authentication(),
  authorization([RoleEnum.Admin]),
  validation(validators.notifyNewMessageSchema),
  async (req: Request, res: Response) => {
    const { recipientId, message } = req.body;

    await notificationsService.notifyNewMessage({
      recipientId,
      message,
    });

    return successResponse({
      message: "New message notification sent successfully",
      res,
    });
  },
);

export default router;