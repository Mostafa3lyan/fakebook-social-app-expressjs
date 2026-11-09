import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { GenderEnum, ProviderEnum, RoleEnum } from "../../../common/enums";
import { HydratedDocument } from "mongoose";
import { IUser } from "../../../common/interfaces";

export const GenderEnumType = new GraphQLEnumType({
  name: "GenderEnum",
  values: {
    MALE: { value: GenderEnum.Male },
    FEMALE: { value: GenderEnum.Female },
  },
});

export const RoleEnumType = new GraphQLEnumType({
  name: "RoleEnum",
  values: {
    USER: { value: RoleEnum.User },
    ADMIN: { value: RoleEnum.Admin },
  },
});

export const ProviderEnumType = new GraphQLEnumType({
  name: "ProviderEnum",
  values: {
    SYSTEM: { value: ProviderEnum.System },
    GOOGLE: { value: ProviderEnum.Google },
  },
});

export const UserType: GraphQLObjectType = new GraphQLObjectType({
  name: "User",
  description: "User profile object type",
  fields: () => ({
    _id: { type: new GraphQLNonNull(GraphQLID) },
    firstName: { type: new GraphQLNonNull(GraphQLString) },
    lastName: { type: new GraphQLNonNull(GraphQLString) },
    fullName: {
      type: GraphQLString,
      resolve: (user: HydratedDocument<IUser>) => `${user.firstName} ${user.lastName}`,
    },

    email: { type: GraphQLString },
    phone: { type: GraphQLString },
    gender: { type: GenderEnumType },
    role: { type: RoleEnumType },
    provider: { type: ProviderEnumType },
    profilePicture: { type: GraphQLString },
    profileCoverPictures: { type: new GraphQLList(GraphQLString) },
    profileVisits: { type: GraphQLInt },
    twoFactorVerified: { type: GraphQLBoolean },

    dateOfBirth: { type: GraphQLString },
    emailConfirmedAt: { type: GraphQLString },
    changeCredentialsTime: { type: GraphQLString },
    resetVerifiedAt: { type: GraphQLString },
    deletedAt: { type: GraphQLString },
    restoredAt: { type: GraphQLString },

    friends: {
      type: new GraphQLList(UserType),
    },


    createdAt: { type: GraphQLString },
    updatedAt: { type: GraphQLString },
  }),
});

export const FriendshipStatusEnumType = new GraphQLEnumType({
  name: "FriendshipStatusEnum",
  description: "Relationship status between viewer and target user",
  values: {
    self: { value: "self" },
    friends: { value: "friends" },
    pending_sent: { value: "pending_sent" },
    pending_received: { value: "pending_received" },
    none: { value: "none" },
  },
});

export const FriendshipStatusType = new GraphQLObjectType({
  name: "FriendshipStatus",
  description: "Detailed friendship status and request ID if pending",
  fields: () => ({
    status: { type: new GraphQLNonNull(FriendshipStatusEnumType) },
    requestId: { type: GraphQLID },
  }),
});

export const PublicUserType: GraphQLObjectType = new GraphQLObjectType({
  name: "PublicUser",
  fields: () => ({
    _id: { type: new GraphQLNonNull(GraphQLID) },
    firstName: { type: new GraphQLNonNull(GraphQLString) },
    lastName: { type: new GraphQLNonNull(GraphQLString) },
    fullName: {
      type: GraphQLString,
      resolve: (user: any) => `${user.firstName} ${user.lastName}`,
    },
    profilePicture: { type: GraphQLString },
    profileCoverPictures: { type: new GraphQLList(GraphQLString) },
    profileVisits: { type: GraphQLInt },
    friendsCount: {
      type: GraphQLInt,
      description: "Total number of friends the user has",
    },
    friendshipStatus: {
      type: FriendshipStatusType,
      description: "Relationship status between authenticated viewer and target user",
    },
  }),
});
