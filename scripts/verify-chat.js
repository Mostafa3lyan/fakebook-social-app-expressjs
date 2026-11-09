"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const conversation_validation_1 = require("../src/modules/conversation/conversation.validation");
const message_validation_1 = require("../src/modules/message/message.validation");
const conversation_model_1 = require("../src/DB/models/conversation.model");
const message_model_1 = require("../src/DB/models/message.model");
const enums_1 = require("../src/common/enums");
console.log("=== Running Chat Verification Suite ===");
let passed = 0;
let failed = 0;
function assert(desc, cond) {
    if (cond) {
        console.log(`[PASS] ${desc}`);
        passed++;
    }
    else {
        console.error(`[FAIL] ${desc}`);
        failed++;
    }
}
// 1. Zod Validations
try {
    const validDirect = conversation_validation_1.directConversationParamSchema.params.safeParse({
        recipientId: new mongoose_1.Types.ObjectId().toString(),
    });
    assert("Direct conversation validation succeeds with valid recipientId", validDirect.success);
    const invalidDirect = conversation_validation_1.directConversationParamSchema.params.safeParse({
        recipientId: "not-an-id",
    });
    assert("Direct conversation validation rejects non-ObjectId", !invalidDirect.success);
    const validGroup = conversation_validation_1.createGroupSchema.body.safeParse({
        title: "Developers Chat",
        participantIds: [new mongoose_1.Types.ObjectId().toString(), new mongoose_1.Types.ObjectId().toString()],
    });
    assert("Group conversation validation succeeds with title and members", validGroup.success);
    const invalidGroupNoTitle = conversation_validation_1.createGroupSchema.body.safeParse({
        participantIds: [new mongoose_1.Types.ObjectId().toString()],
    });
    assert("Group conversation validation fails when title is missing", !invalidGroupNoTitle.success);
    const validConvId = conversation_validation_1.conversationIdParamSchema.params.safeParse({
        conversationId: new mongoose_1.Types.ObjectId().toString(),
    });
    assert("Conversation ID param schema succeeds with valid ObjectId", validConvId.success);
    const validUpdateGroup = conversation_validation_1.updateGroupSchema.body.safeParse({
        title: "New Team Name",
    });
    assert("Update group schema succeeds with new title", validUpdateGroup.success);
    const validAddMembers = conversation_validation_1.addMembersSchema.body.safeParse({
        memberIds: [new mongoose_1.Types.ObjectId().toString()],
    });
    assert("Add members schema succeeds with member list", validAddMembers.success);
    const validRemoveMember = conversation_validation_1.removeMemberSchema.params.safeParse({
        conversationId: new mongoose_1.Types.ObjectId().toString(),
        memberId: new mongoose_1.Types.ObjectId().toString(),
    });
    assert("Remove member schema succeeds with conversation and member Id", validRemoveMember.success);
    const validMessage = message_validation_1.sendMessageSchema.body.safeParse({
        content: "Hello world!",
        clientTempId: "temp-12345",
    });
    assert("Send message validation succeeds with content and clientTempId", validMessage.success);
    const validEdit = message_validation_1.editMessageSchema.body.safeParse({
        content: "Updated message text",
    });
    assert("Edit message validation succeeds with updated content", validEdit.success);
    const validDeleteEveryone = message_validation_1.deleteMessageSchema.query.safeParse({
        mode: enums_1.MessageDeleteModeEnum.EVERYONE,
    });
    assert("Delete message validation accepts 'everyone' mode", validDeleteEveryone.success);
    const validDeleteSelf = message_validation_1.deleteMessageSchema.query.safeParse({
        mode: enums_1.MessageDeleteModeEnum.SELF,
    });
    assert("Delete message validation accepts 'self' mode", validDeleteSelf.success);
    const invalidDeleteMode = message_validation_1.deleteMessageSchema.query.safeParse({
        mode: "unknown_mode",
    });
    assert("Delete message validation rejects invalid mode", !invalidDeleteMode.success);
    const validCursorQuery = message_validation_1.getMessagesSchema.query.safeParse({
        limit: 30,
        before: new mongoose_1.Types.ObjectId().toString(),
    });
    assert("Get messages query schema parses cursor and limit correctly", validCursorQuery.success);
}
catch (e) {
    console.error("Zod suite error:", e);
    failed++;
}
// 2. Mongoose Schemas & Indexes
try {
    const convIndexes = conversation_model_1.ConversationModel.schema.indexes();
    assert("ConversationModel defines schema indexes", convIndexes.length > 0);
    const msgIndexes = message_model_1.MessageModel.schema.indexes();
    assert("MessageModel defines schema indexes", msgIndexes.length > 0);
    const convPaths = Object.keys(conversation_model_1.ConversationModel.schema.paths);
    assert("ConversationModel contains participants path", convPaths.includes("participants"));
    assert("ConversationModel contains status path", convPaths.includes("status"));
    assert("ConversationModel contains type path", convPaths.includes("type"));
    assert("ConversationModel contains lastMessage path", convPaths.includes("lastMessage"));
    const msgPaths = Object.keys(message_model_1.MessageModel.schema.paths);
    assert("MessageModel contains conversationId path", msgPaths.includes("conversationId"));
    assert("MessageModel contains sender path", msgPaths.includes("sender"));
    assert("MessageModel contains deliveredTo path", msgPaths.includes("deliveredTo"));
    assert("MessageModel contains readBy path", msgPaths.includes("readBy"));
    assert("MessageModel contains hiddenFor path", msgPaths.includes("hiddenFor"));
}
catch (e) {
    console.error("Mongoose schema suite error:", e);
    failed++;
}
// 3. Enum definitions
assert("ConversationTypeEnum has DIRECT and GROUP", enums_1.ConversationTypeEnum.DIRECT === "direct" && enums_1.ConversationTypeEnum.GROUP === "group");
assert("ConversationStatusEnum has ACCEPTED, REQUEST, and REJECTED", enums_1.ConversationStatusEnum.ACCEPTED === "accepted" &&
    enums_1.ConversationStatusEnum.REQUEST === "request" &&
    enums_1.ConversationStatusEnum.REJECTED === "rejected");
assert("ParticipantRoleEnum has ADMIN and MEMBER", enums_1.ParticipantRoleEnum.ADMIN === "admin" && enums_1.ParticipantRoleEnum.MEMBER === "member");
assert("MessageTypeEnum has TEXT, IMAGE, FILE", enums_1.MessageTypeEnum.TEXT === "text" &&
    enums_1.MessageTypeEnum.IMAGE === "image" &&
    enums_1.MessageTypeEnum.FILE === "file");
console.log(`\n=== Verification Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
    process.exit(1);
}
else {
    process.exit(0);
}
