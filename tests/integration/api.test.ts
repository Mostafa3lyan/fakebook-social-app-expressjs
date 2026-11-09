import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.bootstrap";

describe("Backend HTTP API & Routing Integration Tests", () => {
  const app = createApp();

  describe("Root & Fallback Routing", () => {
    it("GET / should return 200 with welcome message", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Welcome to Fakebook");
    });

    it("GET /invalid-route should return 404 with standard message", async () => {
      const res = await request(app).get("/non-existent-endpoint-abc");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("message", "Invalid application routing");
    });
  });

  describe("Authentication Gateways & Route Protection", () => {
    it("POST /auth/login without body should return 400 Bad Request", async () => {
      const res = await request(app).post("/auth/login").send({});
      expect(res.status).toBe(400);
    });

    it("POST /auth/signup with mismatched passwords should return 400", async () => {
      const res = await request(app)
        .post("/auth/signup")
        .send({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          password: "Password123!",
          confirmPassword: "WrongPassword123!",
          gender: "male",
          dateOfBirth: "2000-01-01",
          phone: "+201012345678",
        });
      expect(res.status).toBe(400);
    });

    it("GET /conversation without token should return 401 Unauthorized", async () => {
      const res = await request(app).get("/conversation");
      expect(res.status).toBe(401);
    });

    it("GET /friends without token should return 401 Unauthorized", async () => {
      const res = await request(app).get("/friends");
      expect(res.status).toBe(401);
    });

    it("GET /post without token should return 401 Unauthorized", async () => {
      const res = await request(app).get("/post");
      expect(res.status).toBe(401);
    });

    it("GET /notifications without token should return 401 Unauthorized", async () => {
      const res = await request(app).get("/notifications");
      expect(res.status).toBe(401);
    });

    it("GET /user without token should return 401 Unauthorized", async () => {
      const res = await request(app).get("/user");
      expect(res.status).toBe(401);
    });
  });
});
