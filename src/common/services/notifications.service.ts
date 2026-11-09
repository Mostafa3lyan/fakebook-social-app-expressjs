import Knock from "@knocklabs/node";
import { HydratedDocument } from "mongoose";
import { IUser } from "../interfaces";
import { ForbiddenException, NotFoundException } from "../exceptions";
import {
  KNOCK_API_KEY,
  KNOCK_FCM_CHANNEL_ID,
  KNOCK_IN_APP_CHANNEL_ID,
} from "../../config/config.service";

interface TriggerWorkflowParams {
  workflowKey: string;
  recipients: string[];
  data: Record<string, unknown>;
}

export class NotificationsService {
  private readonly knock: Knock;

  constructor() {
    this.knock = new Knock({
      apiKey: KNOCK_API_KEY,
    });
  }

  // Creates or updates a Knock user profile with the user's name, email, and avatar
  async identifyUser(user: HydratedDocument<IUser>) {
    await this.knock.users.update(user._id.toString(), {
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      avatar: user.profilePicture ?? null,
    });
  }

  // Deletes a user's profile from Knock
  async deleteUser(userId: string) {
    await this.knock.users.delete(userId);
  }

  // Fetches a single user's profile from Knock
  async getUser(userId: string) {
    return this.knock.users.get(userId);
  }

  // Triggers a Knock workflow for the given recipients, passing along workflow data
  async triggerWorkflow({
    workflowKey,
    recipients,
    data,
  }: TriggerWorkflowParams) {
    if (!recipients || recipients.length === 0) {
      console.warn(`[NotificationsService] Cannot trigger workflow "${workflowKey}": No recipients provided`);
      return null;
    }

    return this.knock.workflows.trigger(workflowKey, {
      recipients,
      data,
    });
  }

  async setFcmToken(
    userId: string,
    token: string,
  ) {
    if (!token) {
      throw new Error("FCM token is required");
    }

    let existingTokens: string[] = [];
    try {
      const channelData = await this.knock.users.getChannelData(
        userId,
        KNOCK_FCM_CHANNEL_ID,
      );
      if (channelData?.data && Array.isArray((channelData.data as any).tokens)) {
        existingTokens = (channelData.data as any).tokens;
      }
    } catch {
      // Channel data does not exist yet for this user in Knock — initialize fresh
      existingTokens = [];
    }

    const tokens = [
      ...new Set([
        ...existingTokens,
        token,
      ]),
    ];

    return this.knock.users.setChannelData(
      userId,
      KNOCK_FCM_CHANNEL_ID,
      {
        data: { tokens },
      },
    );
  }

  // Sends user fcm token to Knock
  public sendUserFcmToken = async (userId: string, token: string) => {
    await this.setFcmToken(
      userId,
      token,
    );
  };

  // Removes a specific FCM token from Knock channel data for this user
  async removeFcmToken(userId: string, token: string) {
    if (!token) return;

    try {
      const channelData = await this.knock.users.getChannelData(
        userId,
        KNOCK_FCM_CHANNEL_ID,
      );

      if (channelData?.data && Array.isArray((channelData.data as any).tokens)) {
        const existingTokens: string[] = (channelData.data as any).tokens;
        const updatedTokens = existingTokens.filter((t) => t !== token);

        await this.knock.users.setChannelData(
          userId,
          KNOCK_FCM_CHANNEL_ID,
          {
            data: { tokens: updatedTokens },
          },
        );
      }
    } catch {
      // Channel data does not exist yet or user not in Knock — nothing to remove
    }
  }

  public removeUserFcmToken = async (userId: string, token: string) => {
    await this.removeFcmToken(userId, token);
  };

  // Sends a Knock push and in-app notification to a user
  public notifyNewMessage = async ({
    recipientId,
    message,
    data,
  }: {
    recipientId: string;
    message: string;
    data?: Record<string, unknown>;
  }) => {
    return this.triggerWorkflow({
      workflowKey: "welcome-messages",
      recipients: [recipientId],
      data: {
        message,
        ...(data || {}),
      },
    });
  };

  // Cancels an in-flight/scheduled workflow run identified by its cancellation key
  async cancelWorkflow(workflowKey: string, cancellationKey: string, recipients?: string[]) {
    return this.knock.workflows.cancel(workflowKey, {
      cancellation_key: cancellationKey,
      recipients: recipients ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // In-app notifications (using Knock In-App Feed)
  // ---------------------------------------------------------------------------

  async getUserNotifications(
    userId: string,
    { limit = 20, after }: { page?: number; limit?: number; after?: string | undefined } = {},
  ) {
    const pageSize = Math.min(Math.max(limit, 1), 50);

    const response = await this.knock.users.feeds.listItems(
      userId,
      KNOCK_IN_APP_CHANNEL_ID,
      {
        page_size: pageSize,
        ...(after ? { after } : {}),
      },
    );

    const entries = response.entries || [];
    const rawBody = (response as any).body as { meta?: { total_count: number; unread_count: number; unseen_count: number } } | undefined;
    const meta = rawBody?.meta || {
      total_count: entries.length,
      unread_count: entries.filter((e) => !e.read_at).length,
      unseen_count: entries.filter((e) => !e.seen_at).length,
    };

    return {
      items: entries.map((item) => ({
        id: item.id,
        message:
          typeof item.data === "object" && item.data !== null && "message" in item.data
            ? String((item.data as Record<string, unknown>).message)
            : "You have a new notification",
        workflow: item.source?.key || "welcome-messages",
        status: item.read_at ? "read" : item.seen_at ? "seen" : "delivered",
        readAt: item.read_at ?? null,
        seenAt: item.seen_at ?? null,
        createdAt: item.inserted_at,
        data: item.data ?? {},
      })),
      total: meta.total_count,
      unreadCount: meta.unread_count,
      unseenCount: meta.unseen_count,
      pageInfo: response.page_info,
    };
  }

  async markAsRead(userId: string, messageId: string) {
    let message: any;
    try {
      message = await this.knock.messages.get(messageId);
    } catch {
      throw new NotFoundException("Notification not found");
    }

    if (!message) {
      throw new NotFoundException("Notification not found");
    }

    const recipientId =
      typeof message.recipient === "string"
        ? message.recipient
        : (message.recipient as any)?.id;

    if (recipientId !== userId) {
      throw new ForbiddenException("You are not authorized to mark this notification as read");
    }

    return this.knock.messages.markAsRead(messageId);
  }

  async markAllAsRead(userId: string) {
    const response = await this.knock.users.feeds.listItems(
      userId,
      KNOCK_IN_APP_CHANNEL_ID,
      {
        status: "unread",
        page_size: 50,
      },
    );

    const unreadEntries = response.entries || [];
    if (unreadEntries.length > 0) {
      await this.knock.messages.batch.markAsRead({
        message_ids: unreadEntries.map((item) => item.id),
      });
    }
  }

  async getUnreadCount(userId: string) {
    const response = await this.knock.users.feeds.listItems(
      userId,
      KNOCK_IN_APP_CHANNEL_ID,
      {
        page_size: 1,
      },
    );

    const rawBody = (response as any).body as { meta?: { unread_count: number } } | undefined;
    const unreadCount = rawBody?.meta?.unread_count ?? (response.entries || []).filter((e) => !e.read_at).length;
    return { unreadCount };
  }
}

export const notificationsService = new NotificationsService();
