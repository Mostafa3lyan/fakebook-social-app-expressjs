import { createClient, RedisClientType } from "redis";
import { Types } from "mongoose";
import { REDIS_URI } from "../../config/config.service";
import { EmailSubjectEnum } from "../enums";

type RedisValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[];

export type RedisOtpKey = {
  email: string;
  subject: EmailSubjectEnum;
};

export class RedisService {
  private readonly client: RedisClientType;

  constructor() {
    this.client = createClient({ url: REDIS_URI });
    this.handleEvents();
  }

  private handleEvents() {
    this.client.on("ready", () => {
      console.log("✅ Redis client ready");
    });

    this.client.on("error", (error) => {
      console.error("Redis client error:", error);
    });
  }

  async connect() {
    if (!this.client.isOpen) {
      await this.client.connect();
      console.log("✅ Connected to Redis");
    }
  }

  // ===========================
  // Key Builders
  // ===========================

  // revoke all keys for a user
  revokeTokenPrefix(userId: Types.ObjectId | string) {
    return `RevokeToken::${userId}`;
  }

  // revoke one key for a specific token (jti) of a user
  revokeTokenKey({
    userId,
    jti,
  }: {
    userId: Types.ObjectId | string;
    jti: string;
  }) {
    return `${this.revokeTokenPrefix(userId)}::${jti}`;
  }

  otpKey({ email, subject }: RedisOtpKey): string {
    return `Otp::User::${email}::${subject}`;
  }

  otpAttemptsKey({ email, subject }: RedisOtpKey): string {
    return `Otp::Attempts::${email}::${subject}`;
  }

  otpBlockKey({ email, subject }: RedisOtpKey): string {
    return `Otp::Blocked::${email}::${subject}`;
  }

  otpVerifyAttemptsKey({ email, subject }: RedisOtpKey): string {
    return `Otp::VerifyAttempts::${email}::${subject}`;
  }

  twoFaKey(userId: Types.ObjectId | string): string {
    return `TwoFA::Request::${userId}`;
  }

  twoFaAttemptsKey(userId: Types.ObjectId | string): string {
    return `TwoFA::Attempts::${userId}`;
  }

  twoFaBlockKey(userId: Types.ObjectId | string): string {
    return `TwoFA::Blocked::${userId}`;
  }

  twoFaVerifyAttemptsKey(userId: Types.ObjectId | string): string {
    return `TwoFA::VerifyAttempts::${userId}`;
  }

  magicLinkRevokeKey(token: string): string {
    return `MagicLink::Revoked::${token}`;
  }

  resetTokenKey(token: string): string {
    return `ResetToken::${token}`;
  }

  loginAttemptsKey(email: string): string {
    return `Login::Attempts::${email.trim().toLowerCase()}`;
  }

  loginBlockKey(email: string): string {
    return `Login::Blocked::${email.trim().toLowerCase()}`;
  }

  magicLinkRateKey(email: string): string {
    return `MagicLink::Rate::${email.trim().toLowerCase()}`;
  }

  // ===========================
  // CRUD
  // ===========================

  async set(key: string, value: RedisValue, ttl?: number | undefined): Promise<string | null> {
    try {
      const data =
        typeof value === "string" ? value : JSON.stringify(value);

      return ttl
        ? await this.client.set(key, data, { EX: ttl })
        : await this.client.set(key, data);
    } catch (error) {
      console.error("Failed to set Redis key:", error);
      return null;
    }
  }

async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await this.client.set(key, value, { EX: ttlSeconds, NX: true });
  return result === "OK";
}

  async update(key: string, value: RedisValue, ttl?: number | undefined): Promise<string | null> {
    try {
      const data =
        typeof value === "string" ? value : JSON.stringify(value);

      return ttl
        ? await this.client.set(key, data, {
          XX: true,
          EX: ttl,
        })
        : await this.client.set(key, data, {
          XX: true,
        });
    } catch (error) {
      console.error("Failed to update Redis key:", error);
      return null;
    }
  }

  async get<T = string>(key: string): Promise<T | string | null> {
    try {
      const value = await this.client.get(key);

      if (!value) return null;

      try {
        return JSON.parse(value) as T;
      } catch {
        return value;
      }
    } catch (error) {
      console.error("Failed to get Redis key:", error);
      return null;
    }
  }

  async mGet(keys: string[] = []): Promise<(string | null)[]> {
    try {
      if (!keys.length) return [];

      return await this.client.mGet(keys);
    } catch (error) {
      console.error("Failed to mGet Redis keys:", error);
      return [];
    }
  }

  async del(key: string | string[]): Promise<number> {
    try {
      if (!key || (Array.isArray(key) && key.length === 0)) return 0;

      return await this.client.del(key);
    } catch (error) {
      console.error("Failed to delete Redis key:", error);
      return 0;
    }
  }

  async exists(key: string): Promise<number> {
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error("Failed to check Redis key:", error);
      return 0;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    try {
      return await this.client.expire(key, ttlSeconds);
    } catch (error) {
      console.error("Failed to set Redis TTL:", error);
      return -2;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error("Failed to get Redis TTL:", error);
      return -2; // -2 indicates the key does not exist
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      console.error("Failed to increment Redis key:", error);
      return -2;
    }
  }

  /**
   * ⚠ Avoid using in production on large datasets.
   * Prefer SCAN for better performance.
   */
  async keys(prefix: string): Promise<string[]> {
    try {
      return await this.client.keys(`${prefix}*`);
    } catch (error) {
      console.error("Failed to get Redis keys:", error);
      return [];
    }
  }

  async scanKeys(prefix: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = "0";
    do {
      const reply = await this.client.scan(cursor, {
        MATCH: `${prefix}*`,
        COUNT: 100,
      });
      cursor = reply.cursor;
      found.push(...reply.keys);
    } while (cursor !== "0");
    return found;
  }

}

export const redisService = new RedisService();