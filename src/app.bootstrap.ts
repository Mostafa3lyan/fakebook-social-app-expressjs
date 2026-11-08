import http from "node:http";
import connectDB from "./DB/connection.db";
import express from "express";
import type { Express, Request, Response, NextFunction } from "express"
import { authRouter, userRouter, notificationsRouter, postRouter, commentRouter, friendsRouter, conversationRouter, messageRouter } from "./modules";
import { createHandler } from "graphql-http/lib/use/express";
import { schema, graphQLContext, type GraphQLContext, depthLimit } from "./modules/graphql";
import { authentication, globalErrorHandler } from "./middleware";
import { port } from "./config/config.service";
import { redisService } from "./common/services/redis.service";
import cors from "cors";
import { successResponse } from "./common/response";
import { s3Service, socketService } from "./common/services";
import { promisify } from "node:util";
import { pipeline } from "node:stream";
import { NotFoundException } from "./common/exceptions";

const s3WriteStream = promisify(pipeline);

const bootstrap = async () => {
  const app: Express = express();

  app.use(express.json(), cors());

  // GraphQL endpoint
  app.all("/graphql", createHandler<GraphQLContext>({
    schema,
    context: graphQLContext,
    validationRules: [depthLimit(6)],
  }));

  //application routing
  app.use("/auth", authRouter);
  app.use("/user", userRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/friends", friendsRouter);
  app.use("/post/:postId/comment", commentRouter);
  app.use("/post", postRouter);
  app.use("/conversation/:conversationId/messages", messageRouter);
  app.use("/conversation", conversationRouter);


  app.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.send("Hello World! Welcome to Fakebook");
  });

  app.get("/uploads/*path", authentication(), async (req: Request, res: Response, next: NextFunction) => {
    const { download, fileName } = req.query;
    const path = req.params.path as string[];
    const key = path.join("/");
    const { Body, ContentType } = await s3Service.getAsset({ key });

    if (!Body) {
      throw new NotFoundException("Asset not found");
    }

    res.setHeader(
      "Content-Type",
      ContentType || "application/octet-stream"
    );
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    if (download === "true") {
      res.setHeader("Content-Disposition", `attachment; filename="${fileName || key.split("/").pop()}"`);
    }

    return await s3WriteStream(Body as NodeJS.ReadableStream, res);
  })

  app.get("/pre-signed/*path", authentication(), async (req: Request, res: Response, next: NextFunction) => {
    const { download, fileName } = req.query as { download: string, fileName: string };
    const path = req.params.path as string[];
    const key = path.join("/");
    const url = await s3Service.getPreSignedUrl({ key, download, fileName });

    return successResponse({ res, data: { url } });
  })

  //invalid routing
  app.use("{/*dummy}", (req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({ message: "Invalid application routing" });
  });

  // error-handling
  app.use(globalErrorHandler);

  await connectDB();
  await redisService.connect();

  const httpServer = http.createServer(app);
  socketService.init(httpServer);

  httpServer.listen(port, () => console.log(`Fakebook app (HTTP + Socket.io) listening on port ${port}!`));

}

export default bootstrap;