import dotenv from "dotenv";
import path from "node:path";

process.env.NODE_ENV = "development";
const loadEnv = dotenv?.config || (dotenv as any)?.default?.config;
if (typeof loadEnv === "function") {
  loadEnv({ path: path.resolve(process.cwd(), ".env.development") });
}
