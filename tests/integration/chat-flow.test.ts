import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { UserModel } from "../../src/DB/models/user.model";
import { conversationService } from "../../src/modules/conversation/conversation.service";
import { messageService } from "../../src/modules/message/message.service";

describe("Live Database Chat & Messenger E2E Integration Suite", () => {
  let userA: any;
  let userB: any;
  let conversationId: string;
  let sentMessageId: string;

  beforeAll(async () => {
    const dbUri = process.env.DB_URI;
    if (dbUri && mongoose.connection.readyState === 0) {
      await mongoose.connect(dbUri);
    }
    const users = await UserModel.find({ emailConfirmedAt: { $exists: true } }).limit(2);
    userA = users[0];
    userB = users[1];
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it("should find at least 2 users for live testing", () => {
    expect(userA).toBeDefined();
    expect(userB).toBeDefined();
  });

  it("should create or retrieve direct conversation between User A and User B", async () => {
    if (!userA || !userB) return;
    const { conversation } = await conversationService.createOrGetDirectConversation(
      userA,
      userB._id.toString()
    );
    expect(conversation).toBeDefined();
    expect(conversation._id).toBeDefined();
    conversationId = conversation._id.toString();
  });

  it("should send a message from User A to User B", async () => {
    if (!userA || !conversationId) return;
    const testContent = `Automated Vitest Message ${Date.now()}`;
    const clientTempId = `temp-${Date.now()}`;
    const message = await messageService.sendMessage(
      userA,
      conversationId,
      { content: testContent, clientTempId },
      []
    );
    expect(message).toBeDefined();
    expect(message.content).toBe(testContent);
    sentMessageId = message._id.toString();
  });

  it("should retrieve message in User B's conversation history", async () => {
    if (!userB || !conversationId || !sentMessageId) return;
    const history = await messageService.getMessages(userB, conversationId, { limit: 10 });
    const exists = history.messages.some((m) => m._id.toString() === sentMessageId);
    expect(exists).toBe(true);
  });

  it("should track unread count for User B and reset on mark-as-read", async () => {
    if (!userB || !conversationId || !sentMessageId) return;
    const inbox = await conversationService.getConversations(userB, { limit: 10 });
    const conv = inbox.data.find((c: any) => c._id.toString() === conversationId);
    expect(conv?.unreadCount).toBeGreaterThanOrEqual(1);

    await messageService.markAsRead(userB, conversationId, sentMessageId);

    const inboxAfter = await conversationService.getConversations(userB, { limit: 10 });
    const convAfter = inboxAfter.data.find((c: any) => c._id.toString() === conversationId);
    expect(convAfter?.unreadCount).toBe(0);
  });

  it("should allow User A to edit their sent message", async () => {
    if (!userA || !conversationId || !sentMessageId) return;
    const updatedContent = `Updated Content ${Date.now()}`;
    const edited = await messageService.editMessage(userA, conversationId, sentMessageId, updatedContent);
    expect(edited.content).toBe(updatedContent);
    expect(edited.isEdited).toBe(true);
  });

  it("should allow User A to unsend message for everyone", async () => {
    if (!userA || !conversationId || !sentMessageId) return;
    const result = await messageService.deleteMessage(userA, conversationId, sentMessageId, "everyone");
    expect(result.message).toContain("everyone");
  });
});

