import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { HydratedDocument } from "mongoose";
import { TokenTypeEnum } from "../enums";
import { IUser } from "../interfaces";
import { tokenService } from "./token.service";

export interface AuthenticatedSocket extends Socket {
  data: {
    user: HydratedDocument<IUser>;
    userId: string;
  };
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export class SocketService {
  private io: SocketIOServer | null = null;

  public init(httpServer: HttpServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: true,
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Authentication middleware
    this.io.use(async (socket: Socket, next) => {
      try {
        let rawToken: string | null =
          (typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null) ||
          (typeof socket.handshake.headers?.authorization === "string"
            ? socket.handshake.headers.authorization
            : null) ||
          parseCookieValue(socket.handshake.headers?.cookie, "fb_access_token");

        if (!rawToken) {
          return next(new Error("Authentication token required"));
        }

        if (rawToken.startsWith("Bearer ")) {
          rawToken = rawToken.slice(7).trim();
        }

        const { user } = await tokenService.decodeToken({
          token: rawToken,
          tokenType: TokenTypeEnum.access,
        });

        socket.data.user = user;
        socket.data.userId = user._id.toString();
        next();
      } catch (err) {
        next(new Error(err instanceof Error ? err.message : "Invalid authentication token"));
      }
    });

    this.io.on("connection", (socket: Socket) => {
      const userId = socket.data.userId as string | undefined;
      if (!userId) {
        socket.disconnect(true);
        return;
      }

      const userRoom = `user:${userId}`;
      socket.join(userRoom);

      socket.on("disconnect", () => {
        // Room cleanup is handled automatically by Socket.io
      });
    });

    return this.io;
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  public sendToUser(userId: string, event: string, payload: unknown): void {
    if (!this.io || !userId) return;
    this.io.to(`user:${userId.toString()}`).emit(event, payload);
  }

  public sendToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.io || !userIds?.length) return;
    const rooms = userIds.map((id) => `user:${id.toString()}`);
    this.io.to(rooms).emit(event, payload);
  }
}

export const socketService = new SocketService();

