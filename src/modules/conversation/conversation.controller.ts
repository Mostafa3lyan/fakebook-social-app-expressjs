import { Router, type Request, type Response } from "express";
import { successResponse } from "../../common/response";
import { authentication, validation } from "../../middleware";
import { conversationService } from "./conversation.service";
import * as validators from "./conversation.validation";
import { messageService } from "../message";

const router = Router();

// 1. Create or get direct conversation
router.post(
  "/direct/:recipientId",
  authentication(),
  validation(validators.directConversationParamSchema),
  async (req: Request, res: Response) => {
    const { conversation, isNew } = await conversationService.createOrGetDirectConversation(
      req.user,
      req.params.recipientId as string,
    );
    return successResponse({
      res,
      status: isNew ? 201 : 200,
      data: { conversation },
    });
  },
);

// 2. Create group conversation
router.post(
  "/group",
  authentication(),
  validation(validators.createGroupSchema),
  async (req: Request, res: Response) => {
    const { conversation } = await conversationService.createGroupConversation(
      req.user,
      req.body as validators.CreateGroupDto,
    );
    return successResponse({
      res,
      status: 201,
      data: { conversation },
    });
  },
);

// 3. List active conversations (Inbox)
router.get(
  "/",
  authentication(),
  validation(validators.getConversationsQuerySchema),
  async (req: Request, res: Response) => {
    const conversations = await conversationService.getConversations(
      req.user,
      req.query as any,
    );
    return successResponse({
      res,
      data: { conversations },
    });
  },
);

// 4. List message requests
router.get(
  "/requests",
  authentication(),
  validation(validators.getConversationsQuerySchema),
  async (req: Request, res: Response) => {
    const requests = await conversationService.getMessageRequests(
      req.user,
      req.query as any,
    );
    return successResponse({
      res,
      data: { requests },
    });
  },
);

// 5. Accept message request
router.patch(
  "/:conversationId/accept-request",
  authentication(),
  validation(validators.conversationIdParamSchema),
  async (req: Request, res: Response) => {
    const result = await conversationService.acceptMessageRequest(
      req.user,
      req.params.conversationId as string,
    );
    return successResponse({
      res,
      message: "Message request accepted",
      data: result,
    });
  },
);

// 6. Reject message request
router.patch(
  "/:conversationId/reject-request",
  authentication(),
  validation(validators.conversationIdParamSchema),
  async (req: Request, res: Response) => {
    const result = await conversationService.rejectMessageRequest(
      req.user,
      req.params.conversationId as string,
    );
    return successResponse({
      res,
      message: result.message,
    });
  },
);

// 7. Get conversation details by ID
router.get(
  "/:conversationId",
  authentication(),
  validation(validators.conversationIdParamSchema),
  async (req: Request, res: Response) => {
    const conversation = await conversationService.getConversationById(
      req.user,
      req.params.conversationId as string,
    );
    return successResponse({
      res,
      data: { conversation },
    });
  },
);

// 8. Update group details
router.patch(
  "/:conversationId",
  authentication(),
  validation(validators.updateGroupSchema),
  async (req: Request, res: Response) => {
    const conversation = await conversationService.updateGroup(
      req.user,
      req.params.conversationId as string,
      req.body as validators.UpdateGroupDto,
    );
    return successResponse({
      res,
      data: { conversation },
    });
  },
);

// 9. Add group members
router.post(
  "/:conversationId/members",
  authentication(),
  validation(validators.addMembersSchema),
  async (req: Request, res: Response) => {
    const members = await conversationService.addGroupMembers(
      req.user,
      req.params.conversationId as string,
      req.body.memberIds as string[],
    );
    return successResponse({
      res,
      data: { members },
    });
  },
);

// 10. Remove group member or leave group
router.delete(
  "/:conversationId/members/:memberId",
  authentication(),
  validation(validators.removeMemberSchema),
  async (req: Request, res: Response) => {
    const result = await conversationService.removeGroupMember(
      req.user,
      req.params.conversationId as string,
      req.params.memberId as string,
    );
    return successResponse({
      res,
      message: result.message,
    });
  },
);

// 11. Delete conversation
router.delete(
  "/:conversationId",
  authentication(),
  validation(validators.deleteConversationSchema),
  async (req: Request, res: Response) => {
    const result = await conversationService.deleteConversation(
      req.user,
      req.params.conversationId as string,
      req.query.disband as string | undefined,
    );
    return successResponse({
      res,
      message: result.message,
      data: { disbanded: result.disbanded },
    });
  },
);

// 12. Mark conversation as read
router.post(
  "/:conversationId/read",
  authentication(),
  validation(validators.conversationIdParamSchema),
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
