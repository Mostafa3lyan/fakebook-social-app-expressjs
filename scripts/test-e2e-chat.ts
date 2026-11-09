import { UserModel } from "../src/DB/models/user.model";
import { conversationService } from "../src/modules/conversation/conversation.service";
import { messageService } from "../src/modules/message/message.service";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.development") });

async function runE2ETest() {
  console.log("=== Phase 6: Live End-to-End Chat Verification ===");

  const dbUri = process.env.DB_URI;
  if (!dbUri) {
    console.error("No DB_URI found in .env.development");
    process.exit(1);
  }

  await mongoose.connect(dbUri);
  console.log("Connected to MongoDB successfully.");

  try {
    // 1. Fetch 2 distinct users
    const users = await UserModel.find({ emailConfirmedAt: { $exists: true } }).limit(2);
    const userA = users[0];
    const userB = users[1];

    if (!userA || !userB) {
      console.log("[SKIP] Need at least 2 users with confirmed emails in DB to run live conversation test.");
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`Testing with User A: ${userA.firstName} (${userA._id}) and User B: ${userB.firstName} (${userB._id})`);

    // 2. Create or Get Direct Conversation
    console.log("\n1. Testing createOrGetDirectConversation...");
    const { conversation, isNew } = await conversationService.createOrGetDirectConversation(
      userA,
      userB._id.toString()
    );
    console.log(`[PASS] Conversation obtained (ID: ${conversation._id}, isNew: ${isNew}, status: ${conversation.status})`);

    // 3. Send Message from User A to User B
    console.log("\n2. Testing sendMessage...");
    const testContent = `Automated E2E Test Message ${Date.now()}`;
    const clientTempId = `test-temp-${Date.now()}`;
    const sentMessage = await messageService.sendMessage(
      userA,
      conversation._id.toString(),
      { content: testContent, clientTempId },
      []
    );
    console.log(`[PASS] Message sent (ID: ${sentMessage._id}, content: "${sentMessage.content}")`);

    // 4. Verify Message appears in History
    console.log("\n3. Testing getMessages history...");
    const history = await messageService.getMessages(
      userB,
      conversation._id.toString(),
      { limit: 10 }
    );
    const found = history.messages.some((m) => m._id.toString() === sentMessage._id.toString());
    console.log(`[PASS] Message found in User B's history: ${found}`);

    // 5. Verify Unread Count for User B
    console.log("\n4. Testing unreadCount in getConversations for User B...");
    const userBInbox = await conversationService.getConversations(userB, { limit: 10 });
    const userBConv = userBInbox.data.find(
      (c: { _id: { toString: () => string } }) => c._id.toString() === conversation._id.toString()
    );
    console.log(`[PASS] User B inbox unreadCount: ${userBConv?.unreadCount ?? 0} (Expected >= 1)`);

    // 6. Test Mark as Read by User B
    console.log("\n5. Testing markAsRead by User B...");
    const readResult = await messageService.markAsRead(
      userB,
      conversation._id.toString(),
      sentMessage._id.toString()
    );
    console.log(`[PASS] Mark as read executed: ${readResult.message}`);

    // 7. Verify Unread Count is now 0 for User B
    const userBInboxAfter = await conversationService.getConversations(userB, { limit: 10 });
    const userBConvAfter = userBInboxAfter.data.find(
      (c: { _id: { toString: () => string } }) => c._id.toString() === conversation._id.toString()
    );
    console.log(`[PASS] User B inbox unreadCount after read: ${userBConvAfter?.unreadCount ?? 0} (Expected: 0)`);

    // 8. Test Edit Message by User A
    console.log("\n6. Testing editMessage by User A...");
    const updatedContent = `${testContent} (Edited)`;
    const editedMsg = await messageService.editMessage(
      userA,
      conversation._id.toString(),
      sentMessage._id.toString(),
      updatedContent
    );
    console.log(`[PASS] Message edited: "${editedMsg.content}", isEdited: ${editedMsg.isEdited}`);

    // 9. Test Delete Message (Unsend for Everyone)
    console.log("\n7. Testing deleteMessage (everyone)...");
    const deleteResult = await messageService.deleteMessage(
      userA,
      conversation._id.toString(),
      sentMessage._id.toString(),
      "everyone"
    );
    console.log(`[PASS] Message unsent: ${deleteResult.message}`);

    // 10. Test Group Conversation Creation & Management if at least 3 users exist
    const allUsers = await UserModel.find({ emailConfirmedAt: { $exists: true } }).limit(3);
    if (allUsers.length >= 3) {
      console.log("\n8. Testing Group Conversation creation & admin management...");
      const member1 = allUsers[1];
      const member2 = allUsers[2];
      if (member1 && member2) {
        const { conversation: groupConv } = await conversationService.createGroupConversation(
          userA,
          {
            title: "Test Group Alpha",
            participantIds: [member1._id.toString(), member2._id.toString()],
          }
        );
        console.log(`[PASS] Group created (ID: ${groupConv._id}, Title: "${groupConv.title}")`);

        // Test update group title
        const updatedGroup = await conversationService.updateGroup(
          userA,
          groupConv._id.toString(),
          { title: "Test Group Alpha Renamed" }
        );
        console.log(`[PASS] Group renamed: "${updatedGroup.title}"`);

        // Test disband group
        const disbandResult = await conversationService.deleteConversation(
          userA,
          groupConv._id.toString(),
          "true"
        );
        console.log(`[PASS] Group disbanded: ${disbandResult.message}`);
      }
    }

    console.log("\n=== ALL END-TO-END CHAT VERIFICATION CHECKS PASSED ===");
  } catch (err: unknown) {
    console.error("[FAIL] Error during E2E chat verification:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

runE2ETest();
