import { resolve } from "node:path";
import dotenv from "dotenv";

export const NODE_ENV = (process.env.NODE_ENV || "development") as "development" | "production";

const loadEnv = dotenv?.config || (dotenv as any)?.default?.config;
if (typeof loadEnv === "function") {
  loadEnv({ path: resolve(`./.env.${NODE_ENV}`) });
}

export const port = process.env.PORT ?? 7000;

export const APP_NAME = process.env.APP_NAME as string;

// DB Uri
export const DB_URI = process.env.DB_URI as string;

// Redis Uri
export const REDIS_URI = process.env.REDIS_URI as string;

export const SALT_ROUND = parseInt(process.env.SALT_ROUND ?? "10");
export const IV_LENGTH = parseInt(process.env.IV_LENGTH ?? "16");
export const ENC_SECRET_KEY = Buffer.from(process.env.ENC_SECRET_KEY || "");
export const Encryption_ALGORITHM = process.env.Encryption_ALGORITHM as string;

// Token
export const ACCESS_TOKEN_SECRET_KEY = process.env.ACCESS_TOKEN_SECRET_KEY as string;
export const REFRESH_TOKEN_SECRET_KEY = process.env.REFRESH_TOKEN_SECRET_KEY as string;
export const SYSTEM_ACCESS_TOKEN_SECRET_KEY = process.env.SYSTEM_ACCESS_TOKEN_SECRET_KEY as string;
export const SYSTEM_REFRESH_TOKEN_SECRET_KEY = process.env.SYSTEM_REFRESH_TOKEN_SECRET_KEY as string;
export const ACCESS_TOKEN_EXPIRES_IN = parseInt(process.env.ACCESS_TOKEN_EXPIRES_IN || "1800");
export const REFRESH_TOKEN_EXPIRES_IN = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "31536000");

// Google
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string;

// Nodemailer
export const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD as string;
export const Email_USER = process.env.Email_USER as string;

export const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET as string;
export const CLIENT_URL = process.env.CLIENT_URL as string;

// AWS S3
export const AWS_BUCKET_NAME = process.env.AWS_BUCKET_NAME as string;
export const AWS_REGION = process.env.AWS_REGION as string;
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID as string;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY as string;
export const AWS_ExPIRES_IN = parseInt(process.env.AWS_ExPIRES_IN || "3600");

// Knock Notifications
export const KNOCK_API_KEY = process.env.KNOCK_API_KEY as string;
export const KNOCK_FCM_CHANNEL_ID = process.env.KNOCK_FCM_CHANNEL_ID as string;
export const KNOCK_IN_APP_CHANNEL_ID = (process.env.KNOCK_IN_APP_CHANNEL_ID || "aae66285-aca5-4ce2-8365-e5c0b9fae5ef") as string;