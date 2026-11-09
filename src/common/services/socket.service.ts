import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { HydratedDocument, Types } from "mongoose";
import { TokenTypeEnum } from "../enums";
import { IUser } from "../interfaces";
import { tokenService } from "./token.service";
import { ConversationModel } from "../../DB/models/conversation.model";
import { CLIENT_URL } from "../../config/config.service";

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
  // Multi-tab / multi-device presence tracking: maps userId -> Set of active socket IDs
  private userConnections: Map<string, Set<string>> = new Map();

  public init(httpServer: HttpServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: CLIENT_URL ? [CLIENT_URL] : true,
        credentials: true,
      },
      allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        if (!origin) {
          return callback(null, true);
        }
        if (CLIENT_URL && origin !== CLIENT_URL) {
          return callback("Cross-origin connection denied", false);
        }
        callback(null, true);
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
      const user = socket.data.user as HydratedDocument<IUser> | undefined;
      if (!userId || !user) {
        socket.disconnect(true);
        return;
      }

      // 1. Join user's personal room
      const userRoom = `user:${userId}`;
      socket.join(userRoom);

      // 2. Track connection for presence
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      const sockets = this.userConnections.get(userId)!;
      const wasOffline = sockets.size === 0;
      sockets.add(socket.id);

      if (wasOffline) {
        // User came online — emit presence to confirmed friends only
        const friendIds = (user.friends || []).map((id) => id.toString());
        if (friendIds.length > 0) {
          this.sendToUsers(friendIds, "user:presence", {
            userId,
            status: "online",
          });
        }
      }

      // 3. Conversation room authorization: Join conversation room
      socket.on(
        "chat:join_conversation",
        async (
          data: { conversationId: string },
          callback?: (res: { success: boolean; error?: string }) => void,
        ) => {
          try {
            const { conversationId } = data || {};
            if (!conversationId || !Types.ObjectId.isValid(conversationId)) {
              callback?.({ success: false, error: "Invalid conversation ID" });
              return;
            }

            const isParticipant = await ConversationModel.exists({
              _id: conversationId,
              "participants.user": new Types.ObjectId(userId),
            });

            if (!isParticipant) {
              callback?.({
                success: false,
                error: "Unauthorized: You are not a participant in this conversation",
              });
              return;
            }

            const roomName = `conversation:${conversationId}`;
            socket.join(roomName);
            callback?.({ success: true });
          } catch (err) {
            callback?.({
              success: false,
              error: err instanceof Error ? err.message : "Failed to join conversation",
            });
          }
        },
      );

      // 4. Leave conversation room
      socket.on("chat:leave_conversation", (data: { conversationId: string }) => {
        const { conversationId } = data || {};
        if (conversationId) {
          socket.leave(`conversation:${conversationId}`);
        }
      });

      // 5. Typing start
      socket.on("chat:typing_start", (data: { conversationId: string }) => {
        const { conversationId } = data || {};
        if (
          conversationId &&
          Types.ObjectId.isValid(conversationId) &&
          socket.rooms.has(`conversation:${conversationId}`)
        ) {
          socket.to(`conversation:${conversationId}`).emit("chat:typing", {
            conversationId,
            userId,
            isTyping: true,
            user: {
              _id: userId,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          });
        }
      });

      // 6. Typing stop
      socket.on("chat:typing_stop", (data: { conversationId: string }) => {
        const { conversationId } = data || {};
        if (
          conversationId &&
          Types.ObjectId.isValid(conversationId) &&
          socket.rooms.has(`conversation:${conversationId}`)
        ) {
          socket.to(`conversation:${conversationId}`).emit("chat:typing", {
            conversationId,
            userId,
            isTyping: false,
            user: {
              _id: userId,
              firstName: user.firstName,
              lastName: user.lastName,
            },
          });
        }
      });

      // 7. Delivery acknowledgment
      socket.on(
        "chat:mark_delivered",
        (data: { conversationId: string; messageIds: string[] }) => {
          const { conversationId, messageIds } = data || {};
          if (
            conversationId &&
            Types.ObjectId.isValid(conversationId) &&
            socket.rooms.has(`conversation:${conversationId}`) &&
            Array.isArray(messageIds) &&
            messageIds.length > 0
          ) {
            socket.to(`conversation:${conversationId}`).emit("chat:message_delivered", {
              conversationId,
              messageIds,
              userId,
              deliveredAt: new Date().toISOString(),
            });
          }
        },
      );

      // 8. Disconnect handling
      socket.on("disconnect", () => {
        const userSockets = this.userConnections.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            this.userConnections.delete(userId);
            // User went offline — broadcast presence to confirmed friends only
            const friendIds = (user.friends || []).map((id) => id.toString());
            if (friendIds.length > 0) {
              this.sendToUsers(friendIds, "user:presence", {
                userId,
                status: "offline",
                lastSeenAt: new Date().toISOString(),
              });
            }
          }
        }
      });
    });

    return this.io;
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  public isUserOnline(userId: string): boolean {
    const sockets = this.userConnections.get(userId);
    return Boolean(sockets && sockets.size > 0);
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

  public sendToConversation(conversationId: string, event: string, payload: unknown): void {
    if (!this.io || !conversationId) return;
    this.io.to(`conversation:${conversationId.toString()}`).emit(event, payload);
  }
}

export const socketService = new SocketService();
