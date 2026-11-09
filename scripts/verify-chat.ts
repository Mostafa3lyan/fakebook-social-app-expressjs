import { Types } from "mongoose";
import {
  directConversationParamSchema,
  createGroupSchema,
  conversationIdParamSchema,
  updateGroupSchema,
  addMembersSchema,
  removeMemberSchema,
} from "../src/modules/conversation/conversation.validation";
import {
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  getMessagesSchema,
} from "../src/modules/message/message.validation";
import { ConversationModel } from "../src/DB/models/conversation.model";
import { MessageModel } from "../src/DB/models/message.model";
import {
  ConversationTypeEnum,
  ConversationStatusEnum,
  ParticipantRoleEnum,
  MessageTypeEnum,
  MessageDeleteModeEnum,
} from "../src/common/enums";

console.log("=== Running Chat Verification Suite ===");
let passed = 0;
let failed = 0;

function assert(desc: string, cond: boolean) {
  if (cond) {
    console.log(`[PASS] ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${desc}`);
    failed++;
  }
}

// 1. Zod Validations
try {
  const validDirect = directConversationParamSchema.params.safeParse({
    recipientId: new Types.ObjectId().toString(),
  });
  assert("Direct conversation validation succeeds with valid recipientId", validDirect.success);

  const invalidDirect = directConversationParamSchema.params.safeParse({
    recipientId: "not-an-id",
  });
  assert("Direct conversation validation rejects non-ObjectId", !invalidDirect.success);

  const validGroup = createGroupSchema.body.safeParse({
    title: "Developers Chat",
    participantIds: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
  });
  assert("Group conversation validation succeeds with title and members", validGroup.success);

  const invalidGroupNoTitle = createGroupSchema.body.safeParse({
    participantIds: [new Types.ObjectId().toString()],
  });
  assert("Group conversation validation fails when title is missing", !invalidGroupNoTitle.success);

  const validConvId = conversationIdParamSchema.params.safeParse({
    conversationId: new Types.ObjectId().toString(),
  });
  assert("Conversation ID param schema succeeds with valid ObjectId", validConvId.success);

  const validUpdateGroup = updateGroupSchema.body.safeParse({
    title: "New Team Name",
  });
  assert("Update group schema succeeds with new title", validUpdateGroup.success);

  const validAddMembers = addMembersSchema.body.safeParse({
    memberIds: [new Types.ObjectId().toString()],
  });
  assert("Add members schema succeeds with member list", validAddMembers.success);

  const validRemoveMember = removeMemberSchema.params.safeParse({
    conversationId: new Types.ObjectId().toString(),
    memberId: new Types.ObjectId().toString(),
  });
  assert("Remove member schema succeeds with conversation and member Id", validRemoveMember.success);

  const validMessage = sendMessageSchema.body.safeParse({
    content: "Hello world!",
    clientTempId: "temp-12345",
  });
  assert("Send message validation succeeds with content and clientTempId", validMessage.success);

  const validEdit = editMessageSchema.body.safeParse({
    content: "Updated message text",
  });
  assert("Edit message validation succeeds with updated content", validEdit.success);

  const validDeleteEveryone = deleteMessageSchema.query.safeParse({
    mode: MessageDeleteModeEnum.EVERYONE,
  });
  assert("Delete message validation accepts 'everyone' mode", validDeleteEveryone.success);

  const validDeleteSelf = deleteMessageSchema.query.safeParse({
    mode: MessageDeleteModeEnum.SELF,
  });
  assert("Delete message validation accepts 'self' mode", validDeleteSelf.success);

  const invalidDeleteMode = deleteMessageSchema.query.safeParse({
    mode: "unknown_mode",
  });
  assert("Delete message validation rejects invalid mode", !invalidDeleteMode.success);

  const validCursorQuery = getMessagesSchema.query.safeParse({
    limit: 30,
    before: new Types.ObjectId().toString(),
  });
  assert("Get messages query schema parses cursor and limit correctly", validCursorQuery.success);
} catch (e: unknown) {
  console.error("Zod suite error:", e);
  failed++;
}

// 2. Mongoose Schemas & Indexes
try {
  const convIndexes = ConversationModel.schema.indexes();
  assert("ConversationModel defines schema indexes", convIndexes.length > 0);

  const msgIndexes = MessageModel.schema.indexes();
  assert("MessageModel defines schema indexes", msgIndexes.length > 0);

  const convPaths = Object.keys(ConversationModel.schema.paths);
  assert("ConversationModel contains participants path", convPaths.includes("participants"));
  assert("ConversationModel contains status path", convPaths.includes("status"));
  assert("ConversationModel contains type path", convPaths.includes("type"));
  assert("ConversationModel contains lastMessage path", convPaths.includes("lastMessage"));

  const msgPaths = Object.keys(MessageModel.schema.paths);
  assert("MessageModel contains conversationId path", msgPaths.includes("conversationId"));
  assert("MessageModel contains sender path", msgPaths.includes("sender"));
  assert("MessageModel contains deliveredTo path", msgPaths.includes("deliveredTo"));
  assert("MessageModel contains readBy path", msgPaths.includes("readBy"));
  assert("MessageModel contains hiddenFor path", msgPaths.includes("hiddenFor"));
} catch (e: unknown) {
  console.error("Mongoose schema suite error:", e);
  failed++;
}

// 3. Enum definitions
assert(
  "ConversationTypeEnum has DIRECT and GROUP",
  ConversationTypeEnum.DIRECT === "direct" && ConversationTypeEnum.GROUP === "group"
);
assert(
  "ConversationStatusEnum has ACCEPTED, REQUEST, and REJECTED",
  ConversationStatusEnum.ACCEPTED === "accepted" &&
    ConversationStatusEnum.REQUEST === "request" &&
    ConversationStatusEnum.REJECTED === "rejected"
);
assert(
  "ParticipantRoleEnum has ADMIN and MEMBER",
  ParticipantRoleEnum.ADMIN === "admin" && ParticipantRoleEnum.MEMBER === "member"
);
assert(
  "MessageTypeEnum has TEXT, IMAGE, FILE",
  MessageTypeEnum.TEXT === "text" &&
    MessageTypeEnum.IMAGE === "image" &&
    MessageTypeEnum.FILE === "file"
);

console.log(`\n=== Verification Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
