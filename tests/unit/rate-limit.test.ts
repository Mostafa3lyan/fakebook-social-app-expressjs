import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  getClientIp,
  globalIpRateLimiter,
  userActionRateLimiter,
} from "../../src/middleware/rate-limit.middleware";
import { redisService } from "../../src/common/services/redis.service";
import { TooManyRequestsException } from "../../src/common/exceptions";

describe("Rate Limiting Middleware (General & User Action)", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;
  const headersSet: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key in headersSet) delete headersSet[key];

    mockReq = {
      headers: {},
      ip: "192.168.1.10",
      socket: { remoteAddress: "192.168.1.10" } as any,
    };

    mockRes = {
      setHeader: vi.fn((key: string, value: string) => {
        headersSet[key] = value;
      }) as any,
    };

    nextFn = vi.fn();
  });

  describe("getClientIp", () => {
    it("should extract client IP from X-Forwarded-For header", () => {
      mockReq.headers = {
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      };
      const ip = getClientIp(mockReq as Request);
      expect(ip).toBe("203.0.113.195");
    });

    it("should fall back to req.ip when X-Forwarded-For is absent", () => {
      mockReq.headers = {};
      mockReq.ip = "10.0.0.5";
      const ip = getClientIp(mockReq as Request);
      expect(ip).toBe("10.0.0.5");
    });
  });

  describe("globalIpRateLimiter", () => {
    it("should allow request and set rate limit headers when under limit", async () => {
      vi.spyOn(redisService, "incr").mockResolvedValue(1);
      vi.spyOn(redisService, "expire").mockResolvedValue(1);

      const limiter = globalIpRateLimiter({ limit: 100, windowSeconds: 60 });
      await limiter(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(headersSet["X-RateLimit-Limit"]).toBe("100");
      expect(headersSet["X-RateLimit-Remaining"]).toBe("99");
    });

    it("should block request and throw TooManyRequestsException when limit exceeded", async () => {
      vi.spyOn(redisService, "incr").mockResolvedValue(101);
      vi.spyOn(redisService, "ttl").mockResolvedValue(45);

      const limiter = globalIpRateLimiter({ limit: 100, windowSeconds: 60 });
      await expect(limiter(mockReq as Request, mockRes as Response, nextFn)).rejects.toThrow(
        TooManyRequestsException,
      );

      expect(headersSet["X-RateLimit-Limit"]).toBe("100");
      expect(headersSet["X-RateLimit-Remaining"]).toBe("0");
      expect(headersSet["Retry-After"]).toBe("45");
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe("userActionRateLimiter", () => {
    it("should allow user action when within limit", async () => {
      vi.spyOn(redisService, "incr").mockResolvedValue(3);
      vi.spyOn(redisService, "expire").mockResolvedValue(1);

      mockReq.user = { _id: "507f1f77bcf86cd799439011" } as any;

      // In test mode, effectively limits are relaxed for app suites, but here we invoke with custom limit
      const limiter = userActionRateLimiter({
        action: "create_post",
        limit: 5,
        windowSeconds: 60,
      });

      await limiter(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(headersSet["X-RateLimit-create_post-Limit"]).toBe("5");
    });

    it("should throw TooManyRequestsException when user exceeds limit", async () => {
      vi.spyOn(redisService, "incr").mockResolvedValue(101);
      vi.spyOn(redisService, "ttl").mockResolvedValue(20);

      mockReq.user = { _id: "507f1f77bcf86cd799439011" } as any;

      const limiter = userActionRateLimiter({
        action: "create_post",
        limit: 5,
        windowSeconds: 60,
        message: "You can only create up to 5 posts per minute.",
      });

      await expect(limiter(mockReq as Request, mockRes as Response, nextFn)).rejects.toThrow(
        "You can only create up to 5 posts per minute.",
      );

      expect(headersSet["X-RateLimit-create_post-Remaining"]).toBe("0");
      expect(headersSet["Retry-After"]).toBe("20");
      expect(nextFn).not.toHaveBeenCalled();
    });
  });
});

