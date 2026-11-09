import type { GraphQLFieldConfig } from "graphql";
import { HydratedDocument } from "mongoose";
import { IUser } from "../../../common/interfaces";
import { gqlValidation } from "../../../middleware";
import type { GraphQLContext } from "../../graphql/context";
import { gqlAuthentication } from "../../graphql/guards/auth.guard";
import { userService } from "../user.service";
import { shareProfile } from "../user.validation";
import { shareProfileArgs, type IShareProfileArgs } from "./user.args";
import { PublicUserType, UserType } from "./user.types";
import { friendsService } from "../../friends/friends.service";

export const profileQuery: GraphQLFieldConfig<unknown, GraphQLContext> = {
  type: UserType,
  description: "Get current authenticated user profile",
  resolve: async (_source, _args, context) => {
    gqlAuthentication(context);
    return await userService.profile(context.user as HydratedDocument<IUser>);
  },
};

export const shareProfileQuery: GraphQLFieldConfig<unknown, GraphQLContext, IShareProfileArgs> = {
  type: PublicUserType,
  description: "Get another user's public profile and increment visit count",
  args: shareProfileArgs,
  resolve: async (_source, args, context) => {
    const validated = gqlValidation(shareProfile.params, { userId: args.userId });
    const targetUserId = validated.userId.toString();
    const account = await userService.shareProfile(targetUserId as any, context.user as HydratedDocument<IUser>);

    // Dynamic resolution of friendship status if viewer is authenticated
    let friendshipStatus: { status: string; requestId?: unknown } = { status: "none" };
    if (context.user) {
      try {
        friendshipStatus = await friendsService.getRelationshipStatus(context.user, targetUserId);
      } catch {
        friendshipStatus = { status: "none" };
      }
    }

    // Dynamic resolution of total friends count
    const friendsCount = Array.isArray((account as any)?.friends)
      ? (account as any).friends.length
      : 0;

    return {
      ...(typeof (account as any).toObject === "function" ? (account as any).toObject() : account),
      friendshipStatus,
      friendsCount,
    };
  },
};

export const userQueries = {
  profile: profileQuery,
  shareProfile: shareProfileQuery,
};

export const userMutations = {};
