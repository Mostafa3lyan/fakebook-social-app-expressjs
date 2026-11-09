import type { Request, Response, NextFunction } from "express";
import { TooManyRequestsException } from "../common/exceptions";
import { redisService } from "../common/services/redis.service";

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
  message?: string;
}

export interface UserActionRateLimitOptions {
  action: string;
  limit: number;
  windowSeconds: number;
  message?: string;
}

/**
 * Extracts the real client IP, respecting X-Forwarded-For when behind a proxy/BFF.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}

/**
 * General HTTP IP Rate Limiter (e.g., 100 requests per minute per IP).
 * Protects against flood attacks, aggressive scraping, and DDoS.
 */
export const globalIpRateLimiter = (options: RateLimitOptions = {}) => {
  const limit = options.limit ?? (process.env.NODE_ENV === "test" ? 1000 : 100);
  const windowSeconds = options.windowSeconds ?? 60;
  const message = options.message ?? "Too many requests from this IP. Please slow down and try again later.";

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIp(req);
    const key = `RateLimit::IP::${ip}`;

    try {
      const count = await redisService.incr(key);

      if (count <= 0) {
        // Redis client is closed or unavailable, fail open
        return next();
      }

      if (count === 1) {
        await redisService.expire(key, windowSeconds);
      }

      res.setHeader("X-RateLimit-Limit", String(limit));

      if (count > limit) {
        const remainingTtl = await redisService.ttl(key);
        const retryAfter = Math.max(1, remainingTtl);
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-RateLimit-Remaining", "0");
        throw new TooManyRequestsException(message);
      }

      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
      return next();
    } catch (err) {
      if (err instanceof TooManyRequestsException) {
        throw err;
      }
      // If Redis has a transient error, fail open to avoid taking down the service
      console.warn("Global IP rate limiter encountered Redis error, failing open:", err);
      return next();
    }
  };
};

/**
 * Action-based Rate Limiter keyed by Authenticated User ID.
 * Prevents spam on actions like creating posts, comments, messages, or friend requests.
 */
export const userActionRateLimiter = ({
  action,
  limit,
  windowSeconds,
  message,
}: UserActionRateLimitOptions) => {
  const effectiveLimit = process.env.NODE_ENV === "test" ? Math.max(limit, 100) : limit;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?._id?.toString() || getClientIp(req);
    const key = `RateLimit::Action::${action}::${userId}`;

    try {
      const count = await redisService.incr(key);

      if (count <= 0) {
        // Redis client is closed or unavailable, fail open
        return next();
      }

      if (count === 1) {
        await redisService.expire(key, windowSeconds);
      }

      res.setHeader(`X-RateLimit-${action}-Limit`, String(limit));

      if (count > effectiveLimit) {
        const remainingTtl = await redisService.ttl(key);
        const retryAfter = Math.max(1, remainingTtl);
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader(`X-RateLimit-${action}-Remaining`, "0");
        const defaultMsg = `You are performing '${action}' too fast. Please wait ${retryAfter} seconds.`;
        throw new TooManyRequestsException(message || defaultMsg);
      }

      res.setHeader(`X-RateLimit-${action}-Remaining`, String(Math.max(0, limit - count)));
      return next();
    } catch (err) {
      if (err instanceof TooManyRequestsException) {
        throw err;
      }
      console.warn(`User action rate limiter for '${action}' encountered Redis error, failing open:`, err);
      return next();
    }
  };
};
