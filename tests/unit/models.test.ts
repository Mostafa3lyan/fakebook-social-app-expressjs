import { describe, it, expect } from "vitest";
import { UserModel } from "../../src/DB/models/user.model";
import { PostModel } from "../../src/DB/models/post.model";
import { CommentModel } from "../../src/DB/models/comment.model";
import { ConversationModel } from "../../src/DB/models/conversation.model";
import { MessageModel } from "../../src/DB/models/message.model";

describe("Mongoose Models & Schema Definitions", () => {
  describe("UserModel Schema", () => {
    it("should define required paths", () => {
      const paths = Object.keys(UserModel.schema.paths);
      expect(paths).toContain("firstName");
      expect(paths).toContain("lastName");
      expect(paths).toContain("email");
      expect(paths).toContain("password");
      expect(paths).toContain("provider");
      expect(paths).toContain("role");
      expect(paths).toContain("friends");
      expect(paths).toContain("blockedUsers");
    });

    it("should define email index", () => {
      const indexes = UserModel.schema.indexes();
      const hasEmailIndex = indexes.some(([indexDef]) => "email" in indexDef);
      expect(hasEmailIndex).toBe(true);
    });
  });

  describe("PostModel Schema", () => {
    it("should define required paths", () => {
      const paths = Object.keys(PostModel.schema.paths);
      expect(paths).toContain("createdBy");
      expect(paths).toContain("content");
      expect(paths).toContain("visibility");
      expect(paths).toContain("attachments");
      expect(paths).toContain("reactions");
    });
  });

  describe("CommentModel Schema", () => {
    it("should define required paths", () => {
      const paths = Object.keys(CommentModel.schema.paths);
      expect(paths).toContain("createdBy");
      expect(paths).toContain("postId");
      expect(paths).toContain("content");
    });
  });

  describe("ConversationModel Schema", () => {
    it("should define conversation paths and indexes", () => {
      const paths = Object.keys(ConversationModel.schema.paths);
      expect(paths).toContain("type");
      expect(paths).toContain("status");
      expect(paths).toContain("participants");
      expect(paths).toContain("lastMessage");
      expect(paths).toContain("lastMessageAt");
      expect(paths).toContain("isDeletedFor");

      const indexes = ConversationModel.schema.indexes();
      expect(indexes.length).toBeGreaterThan(0);
    });
  });

  describe("MessageModel Schema", () => {
    it("should define message paths and indexes", () => {
      const paths = Object.keys(MessageModel.schema.paths);
      expect(paths).toContain("conversationId");
      expect(paths).toContain("sender");
      expect(paths).toContain("type");
      expect(paths).toContain("content");
      expect(paths).toContain("attachments");
      expect(paths).toContain("deliveredTo");
      expect(paths).toContain("readBy");
      expect(paths).toContain("isEdited");
      expect(paths).toContain("isDeleted");
      expect(paths).toContain("hiddenFor");

      const indexes = MessageModel.schema.indexes();
      expect(indexes.length).toBeGreaterThan(0);
    });
  });
});
