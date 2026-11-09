import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import {
  directConversationParamSchema,
  createGroupSchema,
  conversationIdParamSchema,
  updateGroupSchema,
  addMembersSchema,
  removeMemberSchema,
} from "../../src/modules/conversation/conversation.validation";
import {
  sendMessageSchema,
  editMessageSchema,
  deleteMessageSchema,
  getMessagesSchema,
} from "../../src/modules/message/message.validation";
import {
  createPostSchema,
  reactAtPostSchema,
  updatePostSchema,
} from "../../src/modules/post/post.validation";
import {
  createCommentSchema,
  replyOnCommentSchema,
} from "../../src/modules/comment/comment.validation";
import {
  receiverParamSchema,
  requestIdParamSchema,
} from "../../src/modules/friends/friends.validation";
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  otpSchema,
} from "../../src/modules/auth/auth.validation";
import {
  targetUserParamSchema,
} from "../../src/modules/user/user.validation";
import { paginationValidationSchema } from "../../src/common/validation";
import { detectBufferMimeType, sanitizeFileName } from "../../src/common/utils/multer";
import { MessageDeleteModeEnum, GenderEnum } from "../../src/common/enums";

describe("Backend Validation Schemas (Zod)", () => {
  describe("Auth Module Validations", () => {
    it("should accept valid signup payload", () => {
      const valid = signupSchema.body.safeParse({
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        password: "Password123!",
        confirmPassword: "Password123!",
        gender: GenderEnum.Male,
        dateOfBirth: "2000-01-01",
        phone: "+201012345678",
      });
      expect(valid.success).toBe(true);
    });

    it("should reject signup when passwords do not match", () => {
      const result = signupSchema.body.safeParse({
        firstName: "John",
        lastName: "Doe",
        email: "john.doe@example.com",
        password: "Password123!",
        confirmPassword: "DifferentPassword123!",
        gender: GenderEnum.Male,
        dateOfBirth: "2000-01-01",
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid login payload", () => {
      const valid = loginSchema.body.safeParse({
        email: "john@example.com",
        password: "Password123!",
      });
      expect(valid.success).toBe(true);
    });

    it("should accept valid forgot password payload", () => {
      const valid = forgotPasswordSchema.body.safeParse({
        email: "john@example.com",
        method: "otp",
      });
      expect(valid.success).toBe(true);
    });

    it("should accept valid OTP payload", () => {
      const valid = otpSchema.body.safeParse({
        otp: "123456",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("User Module Validations", () => {
    it("should validate target user params with valid ObjectId", () => {
      const valid = targetUserParamSchema.params.safeParse({
        targetUserId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should reject target user with invalid ObjectId", () => {
      const result = targetUserParamSchema.params.safeParse({
        targetUserId: "invalid-id",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Friends Module Validations", () => {
    it("should validate send friend request receiver param", () => {
      const valid = receiverParamSchema.params.safeParse({
        receiverId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should validate accept friend request requestId param", () => {
      const valid = requestIdParamSchema.params.safeParse({
        requestId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Post Module Validations", () => {
    it("should accept post creation with content and visibility", () => {
      const valid = createPostSchema.body.safeParse({
        content: "Hello Fakebook!",
        visibility: "public",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate post reaction toggle", () => {
      const valid = reactAtPostSchema.body.safeParse({
        reaction: "like",
      });
      expect(valid.success).toBe(true);
    });

    it("should accept post update with new content", () => {
      const valid = updatePostSchema.body.safeParse({
        content: "Updated post content",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Comment Module Validations", () => {
    it("should accept comment creation with content", () => {
      const valid = createCommentSchema.body.safeParse({
        content: "Nice post!",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate reply to comment", () => {
      const valid = replyOnCommentSchema.body.safeParse({
        content: "Thanks!",
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("Conversation & Message Validations", () => {
    it("should accept direct conversation with valid recipientId", () => {
      const valid = directConversationParamSchema.params.safeParse({
        recipientId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should accept group conversation with title and at least 2 members", () => {
      const valid = createGroupSchema.body.safeParse({
        title: "Test Group",
        participantIds: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
      });
      expect(valid.success).toBe(true);
    });

    it("should reject group conversation without title", () => {
      const result = createGroupSchema.body.safeParse({
        participantIds: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
      });
      expect(result.success).toBe(false);
    });

    it("should validate conversationId param schema", () => {
      const valid = conversationIdParamSchema.params.safeParse({
        conversationId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should validate update group title schema", () => {
      const valid = updateGroupSchema.body.safeParse({
        title: "Renamed Group",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate add group members schema", () => {
      const valid = addMembersSchema.body.safeParse({
        memberIds: [new Types.ObjectId().toString()],
      });
      expect(valid.success).toBe(true);
    });

    it("should validate remove group member schema", () => {
      const valid = removeMemberSchema.params.safeParse({
        conversationId: new Types.ObjectId().toString(),
        memberId: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should validate send message with content and clientTempId", () => {
      const valid = sendMessageSchema.body.safeParse({
        content: "Test Message",
        clientTempId: "temp-987",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate edit message with new content", () => {
      const valid = editMessageSchema.body.safeParse({
        content: "Edited text",
      });
      expect(valid.success).toBe(true);
    });

    it("should validate delete message query mode (everyone vs self)", () => {
      const validEveryone = deleteMessageSchema.query.safeParse({
        mode: MessageDeleteModeEnum.EVERYONE,
      });
      const validSelf = deleteMessageSchema.query.safeParse({
        mode: MessageDeleteModeEnum.SELF,
      });
      const invalid = deleteMessageSchema.query.safeParse({
        mode: "invalid_mode",
      });
      expect(validEveryone.success).toBe(true);
      expect(validSelf.success).toBe(true);
      expect(invalid.success).toBe(false);
    });

    it("should validate get messages query with limit and before cursor", () => {
      const valid = getMessagesSchema.query.safeParse({
        limit: 25,
        before: new Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it("should accept valid pagination query within bounds", () => {
      const valid = paginationValidationSchema.query.safeParse({
        page: "2",
        limit: "25",
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.page).toBe(2);
        expect(valid.data.limit).toBe(25);
      }
    });

    it("should reject pagination query when limit exceeds 50 (DoS prevention)", () => {
      const result = paginationValidationSchema.query.safeParse({
        page: "1",
        limit: "100",
      });
      expect(result.success).toBe(false);
    });

    it("should reject pagination query when page is less than 1", () => {
      const result = paginationValidationSchema.query.safeParse({
        page: "0",
        limit: "10",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("File Upload & Asset Security (VULN-BE-09, VULN-BE-10)", () => {
    it("should sanitize filenames with directory traversal and control characters", () => {
      expect(sanitizeFileName("../../secret/passwords.txt")).not.toContain("../");
      expect(sanitizeFileName("foo\\bar/baz.png")).toBe("foo_bar_baz.png");
      expect(sanitizeFileName("malicious\r\nheader.png")).toBe("maliciousheader.png");
      expect(sanitizeFileName("   avatar.jpeg   ")).toBe("avatar.jpeg");
      expect(sanitizeFileName("")).toBe("file");
    });

    it("should correctly detect JPEG magic bytes", () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(detectBufferMimeType(jpegBuffer)).toBe("image/jpeg");
    });

    it("should correctly detect PNG magic bytes", () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectBufferMimeType(pngBuffer)).toBe("image/png");
    });

    it("should correctly detect GIF magic bytes", () => {
      const gifBuffer = Buffer.from("GIF89a...");
      expect(detectBufferMimeType(gifBuffer)).toBe("image/gif");
    });

    it("should correctly detect WebP magic bytes", () => {
      const webpBuffer = Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from("WEBP"),
      ]);
      expect(detectBufferMimeType(webpBuffer)).toBe("image/webp");
    });

    it("should correctly detect PDF magic bytes", () => {
      const pdfBuffer = Buffer.from("%PDF-1.7...");
      expect(detectBufferMimeType(pdfBuffer)).toBe("application/pdf");
    });

    it("should reject non-image disguised payload (HTML, JS, shell)", () => {
      const htmlBuffer = Buffer.from("<script>alert(1)</script>");
      expect(detectBufferMimeType(htmlBuffer)).toBeNull();

      const shBuffer = Buffer.from("#!/bin/bash\nrm -rf /");
      expect(detectBufferMimeType(shBuffer)).toBeNull();
    });
  });
});
