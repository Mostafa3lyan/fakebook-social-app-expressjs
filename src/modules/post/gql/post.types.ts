import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { FlattenMaps, HydratedDocument } from "mongoose";
import { PostVisibilityEnum, ReactionTypeEnum } from "../../../common/enums";
import { IPost, ISharedPost } from "../../../common/interfaces";
import { PublicUserType } from "../../user/gql/user.types";

type PostSource = IPost | HydratedDocument<IPost> | FlattenMaps<IPost>;
type ReactionsBreakdownSource = Map<ReactionTypeEnum, number> | Record<string, number> | undefined;

const getReactionCount = (
  breakdown: ReactionsBreakdownSource,
  reaction: ReactionTypeEnum
): number => {
  if (!breakdown) return 0;
  if (breakdown instanceof Map) {
    return breakdown.get(reaction) ?? 0;
  }
  return (breakdown as Record<string, number>)[reaction] ?? 0;
};

export const PostVisibilityEnumType = new GraphQLEnumType({
  name: "PostVisibilityEnum",
  values: {
    PUBLIC: { value: PostVisibilityEnum.PUBLIC },
    FRIENDS: { value: PostVisibilityEnum.FRIENDS },
    ONLY_ME: { value: PostVisibilityEnum.ONLY_ME },
  },
});

export const ReactionTypeEnumType = new GraphQLEnumType({
  name: "ReactionTypeEnum",
  values: {
    LIKE: { value: ReactionTypeEnum.LIKE },
    LOVE: { value: ReactionTypeEnum.LOVE },
    CARE: { value: ReactionTypeEnum.CARE },
    HAHA: { value: ReactionTypeEnum.HAHA },
    WOW: { value: ReactionTypeEnum.WOW },
    SAD: { value: ReactionTypeEnum.SAD },
    ANGRY: { value: ReactionTypeEnum.ANGRY },
  },
});

export const PostReactionType = new GraphQLObjectType({
  name: "PostReaction",
  description: "User reaction entry on a post",
  fields: () => ({
    reactionType: { type: new GraphQLNonNull(ReactionTypeEnumType) },
    createdBy: {
      type: new GraphQLNonNull(GraphQLID),
      resolve: (r: any) => {
        if (!r?.createdBy) return "";
        return typeof r.createdBy === "object" && "_id" in r.createdBy
          ? r.createdBy._id.toString()
          : r.createdBy.toString();
      },
    },
    createdAt: {
      type: GraphQLString,
      resolve: (r: any) =>
        r?.createdAt instanceof Date ? r.createdAt.toISOString() : r?.createdAt,
    },
  }),
});

export const PostLocationType = new GraphQLObjectType({
  name: "PostLocation",
  description: "Location attached to a post",
  fields: () => ({
    name: { type: new GraphQLNonNull(GraphQLString) },
    lat: { type: GraphQLFloat },
    lng: { type: GraphQLFloat },
  }),
});

export const ReactionsBreakdownType = new GraphQLObjectType({
  name: "ReactionsBreakdown",
  description: "Count breakdown for each reaction type",
  fields: () => ({
    like: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.LIKE),
    },
    love: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.LOVE),
    },
    care: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.CARE),
    },
    haha: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.HAHA),
    },
    wow: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.WOW),
    },
    sad: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.SAD),
    },
    angry: {
      type: GraphQLInt,
      resolve: (breakdown: ReactionsBreakdownSource) =>
        getReactionCount(breakdown, ReactionTypeEnum.ANGRY),
    },
  }),
});

export const SharedPostType: GraphQLObjectType = new GraphQLObjectType({
  name: "SharedPost",
  description: "Original post reference when a post is shared",
  fields: () => ({
    originalPostId: {
      type: PostType,
      resolve: (shared: ISharedPost) => shared?.originalPostId,
    },
    originalAuthorId: {
      type: PublicUserType,
      resolve: (shared: ISharedPost) => {
        const author = shared?.originalAuthorId;
        if (!author) return null;
        if (typeof author === "object" && "firstName" in author) return author;
        return null;
      },
    },
    isOriginalDeleted: {
      type: GraphQLBoolean,
      description: "True if the original post was deleted or is inaccessible",
      resolve: (shared: ISharedPost) => {
        return !shared?.originalPostId;
      },
    },
  }),
});

export const PostType: GraphQLObjectType = new GraphQLObjectType({
  name: "Post",
  description: "Post object type",
  fields: () => ({
    _id: {
      type: new GraphQLNonNull(GraphQLID),
      resolve: (post: PostSource) => post._id?.toString(),
    },
    content: { type: GraphQLString },
    attachments: { type: new GraphQLList(GraphQLString) },
    createdBy: {
      type: PublicUserType,
      resolve: (post: PostSource) => {
        const creator = post.createdBy;
        if (!creator) return null;
        if (typeof creator === "object" && "firstName" in creator) return creator;
        return null;
      },
    },
    updatedBy: {
      type: PublicUserType,
      resolve: (post: PostSource) => {
        const updater = post.updatedBy;
        if (!updater) return null;
        if (typeof updater === "object" && "firstName" in updater) return updater;
        return null;
      },
    },
    visibility: { type: PostVisibilityEnumType },
    tags: {
      type: new GraphQLList(PublicUserType),
      resolve: (post: PostSource) => {
        return (
          post.tags
            ?.filter((tag): tag is NonNullable<typeof tag> => Boolean(tag) && typeof tag === "object" && "firstName" in tag) ?? []
        );
      },
    },
    location: { type: PostLocationType },
    reactions: {
      type: new GraphQLList(new GraphQLNonNull(PostReactionType)),
      resolve: (post: PostSource) => (post as any)?.reactions ?? [],
    },
    reactionsCount: { type: GraphQLInt },
    reactionsBreakdown: { type: ReactionsBreakdownType },
    commentsCount: { type: GraphQLInt },
    shareCount: { type: GraphQLInt },
    sharedFrom: { type: SharedPostType },
    isEdited: { type: GraphQLBoolean },
    createdAt: {
      type: GraphQLString,
      resolve: (post: PostSource) =>
        post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
    },
    updatedAt: {
      type: GraphQLString,
      resolve: (post: PostSource) =>
        post.updatedAt instanceof Date ? post.updatedAt.toISOString() : post.updatedAt,
    },
    deletedAt: {
      type: GraphQLString,
      resolve: (post: PostSource) =>
        post.deletedAt instanceof Date ? post.deletedAt.toISOString() : post.deletedAt,
    },
  }),
});

export const PaginatedPostsType = new GraphQLObjectType({
  name: "PaginatedPosts",
  description: "Paginated list of posts",
  fields: () => ({
    data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(PostType))) },
    total: { type: new GraphQLNonNull(GraphQLInt) },
    page: { type: GraphQLInt },
    limit: { type: GraphQLInt },
    totalPages: { type: GraphQLInt },
    hasNextPage: { type: GraphQLBoolean },
    hasPrevPage: { type: GraphQLBoolean },
  }),
});
