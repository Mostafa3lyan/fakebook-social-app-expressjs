import { Router, type Request, type Response } from "express";
import { successResponse } from "../../common/response";
import { cloudFileUpload, fileFieldValidation } from "../../common/utils/multer";
import { authentication, validation } from "../../middleware";
import { messageService } from "./message.service";
import * as validators from "./message.validation";

// Mounted at /conversation/:conversationId/messages — mergeParams exposes :conversationId
const router = Router({ mergeParams: true });

const allowedChatMimetypes = [
  ...fileFieldValidation.image,
  ...fileFieldValidation.document,
];

// 1. Get messages history
router.get(
  "/",
  authentication(),
  validation(validators.getMessagesSchema),
  async (req: Request, res: Response) => {
    const data = await messageService.getMessages(
      req.user,
      req.params.conversationId as string,
      req.query as validators.GetMessagesQueryDto,
    );
    return successResponse({
      res,
      data,
    });
  },
);

// 2. Send message
router.post(
  "/",
  authentication(),
  cloudFileUpload({ validation: allowedChatMimetypes }).array("attachments", 5),
  validation(validators.sendMessageSchema),
  async (req: Request, res: Response) => {
    const message = await messageService.sendMessage(
      req.user,
      req.params.conversationId as string,
      req.body as validators.SendMessageBodyDto,
      req.files as Express.Multer.File[],
    );
    return successResponse({
      res,
      status: 201,
      data: { message },
    });
  },
);

// 3. Edit message
router.patch(
  "/:messageId",
  authentication(),
  validation(validators.editMessageSchema),
  async (req: Request, res: Response) => {
    const message = await messageService.editMessage(
      req.user,
      req.params.conversationId as string,
      req.params.messageId as string,
      req.body.content as string,
    );
    return successResponse({
      res,
      data: { message },
    });
  },
);

// 4. Delete / unsend message
router.delete(
  "/:messageId",
  authentication(),
  validation(validators.deleteMessageSchema),
  async (req: Request, res: Response) => {
    const result = await messageService.deleteMessage(
      req.user,
      req.params.conversationId as string,
      req.params.messageId as string,
      req.query.mode as "everyone" | "self" | undefined,
    );
    return successResponse({
      res,
      message: result.message,
      data: { mode: result.mode },
    });
  },
);

// 5. Mark conversation messages as read
router.post(
  "/read",
  authentication(),
  validation(validators.markReadSchema),
  async (req: Request, res: Response) => {
    const result = await messageService.markAsRead(
      req.user,
      req.params.conversationId as string,
      req.body.lastMessageId as string | undefined,
    );
    return successResponse({
      res,
      message: result.message,
      data: { readAt: result.readAt },
    });
  },
);

export default router;
