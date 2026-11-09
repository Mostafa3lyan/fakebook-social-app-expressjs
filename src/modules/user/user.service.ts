import { HydratedDocument, Types } from "mongoose";
import { LogoutEnum, RoleEnum, ProviderEnum } from "../../common/enums";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "../../common/exceptions/index";
import { IUser, IPagination } from "../../common/interfaces";
import { notificationsService, NotificationsService, s3Service, S3Service, socketService, SocketService } from "../../common/services";
import { RedisService, redisService } from "../../common/services/redis.service";
import { TokenService } from "../../common/services/token.service";
import { decodedTypes } from "../../common/types/user.types";
import {
  compareHash,
  decryptGenerator,
} from "../../common/utils/security/index";
import { escapeRegex } from "../../common/utils";
import {
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
} from "../../config/config.service";
import { FriendRequestRepository, UserRepository } from "../../DB/repository";
import { PostService, postService } from "../post/post.service";
import { CommentService, commentService } from "../comment/comment.service";
import { PaginationDto } from "../../common/validation";
import {
  ShareProfileDto,
  RestoreAccountDto,
  UpdateProfileDto,
  SearchUserDto,
  PresignedImageDto,
} from "./user.validation";

class UserService {
  private readonly userRepository: UserRepository;
  private readonly postService: PostService;
  private readonly commentService: CommentService;
  private readonly friendRequestRepository: FriendRequestRepository;
  private readonly redis: RedisService;
  private readonly tokenService: TokenService;
  private readonly s3: S3Service;
  private readonly notificationsService: NotificationsService;
  private readonly socketService: SocketService;
  constructor(
    userRepository: UserRepository = new UserRepository(),
    postServiceInstance: PostService = postService,
    commentServiceInstance: CommentService = commentService,
    friendRequestRepository: FriendRequestRepository = new FriendRequestRepository(),
    tokenService: TokenService = new TokenService(),
    redis: RedisService = redisService,
    s3: S3Service = s3Service,
    notifications: NotificationsService = notificationsService,
    socket: SocketService = socketService,
  ) {
    this.userRepository = userRepository;
    this.postService = postServiceInstance;
    this.commentService = commentServiceInstance;
    this.friendRequestRepository = friendRequestRepository;
    this.tokenService = tokenService;
    this.redis = redis;
    this.s3 = s3;
    this.notificationsService = notifications;
    this.socketService = socket;
  }


  // get user profile
  public profile = async (user: HydratedDocument<IUser>) => {
    if (user.phone) {
      user.phone = decryptGenerator({ encryptedText: user.phone });
    }
    return user;
  };

  // update user profile
  public updateProfile = async (
    data: UpdateProfileDto,
    user: HydratedDocument<IUser>,
  ) => {
    if (data.firstName !== undefined) user.firstName = data.firstName;
    if (data.lastName !== undefined) user.lastName = data.lastName;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.dateOfBirth !== undefined) user.dateOfBirth = data.dateOfBirth;
    if (data.gender !== undefined) user.gender = data.gender;

    await user.save();

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to sync profile update to Knock:", err);
    }

    if (user.phone) {
      user.phone = decryptGenerator({ encryptedText: user.phone });
    }
    return user;
  };

  // search users by name only (excluding blocked/blocking users)
  public searchUsers = async (
    { search, page = 1, limit = 10 }: SearchUserDto,
    loggedInUser?: HydratedDocument<IUser>,
  ) => {
    const escaped = escapeRegex(search);
    const regex = { $regex: escaped, $options: "i" };

    const blockedIds = (loggedInUser?.blockedUsers || []).map(String);

    return this.userRepository.paginate({
      filter: {
        $or: [
          { firstName: regex },
          { lastName: regex },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$firstName", " ", "$lastName"] },
                regex: escaped,
                options: "i",
              },
            },
          },
        ],
        ...(blockedIds.length && { _id: { $nin: blockedIds } }),
        ...(loggedInUser && { blockedUsers: { $ne: loggedInUser._id } }),
      },
      projection: "firstName lastName profilePicture",
      page,
      limit,
      sort: { firstName: 1, lastName: 1 },
    });
  };

  // block user
  public blockUser = async (user: HydratedDocument<IUser>, targetUserId: string) => {
    if (user._id.toString() === targetUserId) {
      throw new BadRequestException("You cannot block yourself");
    }

    const target = await this.userRepository.findById({ id: targetUserId });
    if (!target) {
      throw new NotFoundException("User not found");
    }

    const blockedIds = (user.blockedUsers || []).map(String);
    if (blockedIds.includes(targetUserId)) {
      throw new ConflictException("User is already blocked");
    }

    // 1. Add to blockedUsers
    await this.userRepository.updateOne({
      filter: { _id: user._id },
      update: { $addToSet: { blockedUsers: new Types.ObjectId(targetUserId) } },
    });

    // 2. Automatically remove friendship if they were friends
    await this.userRepository.updateOne({
      filter: { _id: user._id },
      update: { $pull: { friends: new Types.ObjectId(targetUserId) } },
    });
    await this.userRepository.updateOne({
      filter: { _id: targetUserId },
      update: { $pull: { friends: user._id } },
    });

    // 3. Purge any pending friend requests in either direction
    await this.friendRequestRepository.deleteMany({
      filter: {
        $or: [
          { sender: user._id, receiver: targetUserId },
          { sender: targetUserId, receiver: user._id },
        ],
      },
    });

    return { message: "User blocked successfully" };
  };

  // unblock user
  public unblockUser = async (user: HydratedDocument<IUser>, targetUserId: string) => {
    const blockedIds = (user.blockedUsers || []).map(String);
    if (!blockedIds.includes(targetUserId)) {
      throw new BadRequestException("User is not blocked");
    }

    await this.userRepository.updateOne({
      filter: { _id: user._id },
      update: { $pull: { blockedUsers: new Types.ObjectId(targetUserId) } },
    });

    return { message: "User unblocked successfully" };
  };

  // list blocked users with pagination
  public getBlockedUsers = async (
    user: HydratedDocument<IUser>,
    { page = 1, limit = 10 }: PaginationDto,
  ): Promise<IPagination<IUser>> => {
    const account = await this.userRepository.findById({
      id: user._id.toString(),
      projection: "blockedUsers",
      populate: {
        path: "blockedUsers",
        select: "firstName lastName profilePicture",
        match: { deletedAt: { $exists: false } },
      },
    });

    const allBlocked = ((account?.blockedUsers || []) as unknown as IUser[]).filter(Boolean);
    const totalCount = allBlocked.length;
    const startIndex = (page - 1) * limit;
    const paginated = allBlocked.slice(startIndex, startIndex + limit);
    const totalPages = Math.ceil(totalCount / limit) || 1;

    return {
      total: totalCount,
      totalPages,
      page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      data: paginated,
    };
  };

  // logout
  public logout = async (
    { flag }: { flag: LogoutEnum },
    user: HydratedDocument<IUser>,
    { jti, iat, sub }: decodedTypes,
  ): Promise<number> => {
    let status = 200;
    switch (flag) {
      case LogoutEnum.all:
        user.changeCredentialsTime = new Date();
        await user.save();

        try {
          await this.notificationsService.identifyUser(user);
        } catch (err) {
          console.error("Failed to sync profile update to Knock:", err);
        }
        await this.redis.del(await this.redis.scanKeys(this.redis.revokeTokenPrefix(sub)));

        // Disconnect all active sockets for this user (VULN-BE-14)
        this.socketService.getIO()?.in(`user:${sub}`).disconnectSockets(true);
        break;

      default: {
        const ttl = Math.max(
          iat + REFRESH_TOKEN_EXPIRES_IN - Math.floor(Date.now() / 1000),
          0,
        );
        await this.tokenService.createRevokeToken({
          userId: sub,
          jti,
          ttl,
        });

        status = 201;
        break;
      }
    }
    return status;
  };

  // rotate token
  public rotateToken = async (
    user: HydratedDocument<IUser>,
    { sub, jti, iat }: decodedTypes,
    issuer: string,
  ) => {
    if ((iat + ACCESS_TOKEN_EXPIRES_IN) * 1000 > Date.now() + 30000) {
      throw new ConflictException("Current Access token still valid");
    }

    const ttl = Math.max(
      iat + REFRESH_TOKEN_EXPIRES_IN - Math.floor(Date.now() / 1000),
      0,
    );

    await this.tokenService.createRevokeToken({
      userId: sub,
      jti,
      ttl,
    });

    return this.tokenService.createLoginCredentials(user, issuer);
  };

  // share profile
  public shareProfile = async (userId: ShareProfileDto, loggedInUser: HydratedDocument<IUser>) => {
    const account = await this.userRepository.findOne({
      filter: { _id: userId },
      projection: "firstName lastName profilePicture profileCoverPictures profileVisits blockedUsers",
    });

    if (!account) {
      throw new NotFoundException("profile not found");
    }

    if (loggedInUser) {
      const targetBlocked = (account.blockedUsers || []).map(String);
      const viewerBlocked = (loggedInUser.blockedUsers || []).map(String);
      const targetIdStr = ((account as any)._id ?? userId).toString();

      if (
        targetBlocked.includes(loggedInUser._id.toString()) ||
        viewerBlocked.includes(targetIdStr)
      ) {
        throw new NotFoundException("profile not found");
      }
    }

    await this.userRepository.updateOne({
      filter: { _id: userId },
      update: { $inc: { profileVisits: 1 } },
    });

    const isAdmin = loggedInUser?.role === RoleEnum.Admin;

    if (!isAdmin) {
      account.profileVisits = undefined;
    }
    account.blockedUsers = undefined;

    return account;
  };

  // ---------------------------------------------------------------------------
  // Profile & cover images (S3 pre-signed PUT uploads + AWS Lambda sync)
  //
  // Flow:
  // 1. Client requests a pre-signed PUT URL from the backend.
  // 2. Client PUTs the binary directly to S3 under:
  //    - `Fakebook/users/{userId}/profile/{uuid}__{filename}`
  //    - `Fakebook/users/{userId}/cover/{uuid}__{filename}`
  // 3. AWS S3 triggers the `s3-file-upload` Lambda on `ObjectCreated` /
  //    `ObjectRemoved`, which updates `profilePicture` or `profileCoverPictures`
  //    in MongoDB.
  // ---------------------------------------------------------------------------

  private isS3Key = (value?: string | null): value is string =>
    Boolean(value) && !/^https?:\/\//i.test(value as string);

  private sanitizeFileName = (originalname: string) =>
    originalname
      .trim()
      .replace(/[/\\]+/g, "_")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-100) || "image";

  // upload profile image (returns pre-signed PUT url; DB updated by AWS Lambda)
  public profileImage = async (
    { contentType, originalname }: PresignedImageDto,
    user: HydratedDocument<IUser>,
  ) => {
    const previous = user.profilePicture;

    const { url, key } = await this.s3.createPreSignedUrl({
      path: `users/${user._id.toString()}/profile`,
      contentType,
      originalname: this.sanitizeFileName(originalname),
    });

    if (this.isS3Key(previous) && previous !== key) {
      await this.s3.deleteAsset({ key: previous }).catch(() => undefined);
    }

    return { user, url, key };
  };

  // remove profile image (S3 deletion triggers AWS Lambda to unset profilePicture)
  public removeProfileImage = async (user: HydratedDocument<IUser>) => {
    const current = user.profilePicture;
    if (!current) {
      throw new NotFoundException("There is no profile picture to remove");
    }

    if (this.isS3Key(current)) {
      await this.s3.deleteAsset({ key: current });
    } else {
      // External avatar URL (e.g. Google OAuth) has no S3 object to trigger Lambda
      user.profilePicture = undefined;
      await user.save();

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to sync profile update to Knock:", err);
    }
    }

    return user;
  };

  // upload cover image (returns pre-signed PUT url; DB updated by AWS Lambda)
  public profileCoverImage = async (
    { contentType, originalname }: PresignedImageDto,
    user: HydratedDocument<IUser>,
  ) => {
    const previous = (user.profileCoverPictures || []).filter(this.isS3Key);

    const { url, key } = await this.s3.createPreSignedUrl({
      path: `users/${user._id.toString()}/cover`,
      contentType,
      originalname: this.sanitizeFileName(originalname),
    });

    const stale = previous.filter((oldKey) => oldKey !== key);
    if (stale.length) {
      await this.s3.deleteMultipleAssets({ keys: stale }).catch(() => undefined);
    }

    return { user, url, key };
  };

  // remove cover image (S3 deletion triggers AWS Lambda to pull from profileCoverPictures)
  public removeProfileCoverImage = async (user: HydratedDocument<IUser>) => {
    const current = user.profileCoverPictures || [];
    if (!current.length) {
      throw new NotFoundException("There is no cover picture to remove");
    }

    const keys = current.filter(this.isS3Key);
    if (keys.length) {
      await this.s3.deleteMultipleAssets({ keys });
    } else {
      user.profileCoverPictures = [];
      await user.save();

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to sync profile update to Knock:", err);
    }
    }

    return user;
  };

  // change password
  public changePassword = async (
    { oldPassword, newPassword }: { oldPassword: string; newPassword: string },
    user: HydratedDocument<IUser>,
    issuer: string,
  ) => {
    const account = await this.userRepository.findOne({
      filter: { _id: user._id },
      projection: "+password +oldPasswords",
      options: { lean: false },
    });

    if (!account) {
      throw new NotFoundException("Account not found");
    }

    const match = await compareHash({
      plainText: oldPassword,
      cipherText: account.password as string,
    });

    if (!match) {
      throw new BadRequestException("Old password is incorrect");
    }

    for (const hash of account.oldPasswords || []) {
      const isMatch = await compareHash({
        plainText: newPassword,
        cipherText: hash,
      });
      if (isMatch) {
        throw new BadRequestException(
          "New password cannot be the same as any of the previous passwords",
        );
      }
    }

    account.oldPasswords = account.oldPasswords || [];
    account.oldPasswords.push(account.password as string);
    account.password = newPassword;
    account.changeCredentialsTime = new Date();
    await account.save();

    await this.redis.del(await this.redis.scanKeys(this.redis.revokeTokenPrefix(user._id)));

    // Disconnect active socket sessions on password change (VULN-BE-14)
    this.socketService.getIO()?.in(`user:${user._id.toString()}`).disconnectSockets(true);

    return this.tokenService.createLoginCredentials(user, issuer);
  };

  // soft delete account (deactivation with 30-day restore window)
  public softDeleteAccount = async (user: HydratedDocument<IUser>) => {
    // 1. Soft-delete user's posts so they are hidden from feeds
    await this.postService.softDeleteUserPosts(user._id);

    // 2. Set deletion timestamp and invalidate tokens
    user.deletedAt = new Date();
    user.changeCredentialsTime = new Date();
    await user.save();

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to sync profile update to Knock:", err);
    }

    // 3. Invalidate active Redis tokens
    const revokedKeys = await this.redis.scanKeys(this.redis.revokeTokenPrefix(user._id));
    if (revokedKeys.length) {
      await this.redis.del(revokedKeys);
    }

    // Disconnect active socket sessions on account deactivation (VULN-BE-14)
    this.socketService.getIO()?.in(`user:${user._id.toString()}`).disconnectSockets(true);

    return { message: "Account deactivated successfully. You can restore it within 30 days." };
  };

  // restore account within 30 days
  public restoreAccount = async (
    { email, password }: RestoreAccountDto,
    issuer: string,
  ) => {
    const account = await this.userRepository.findOne({
      filter: { email, provider: ProviderEnum.System, paranoid: false },
      projection: "+password",
      options: { lean: false },
    });

    if (!account || !account.deletedAt) {
      throw new BadRequestException("Account is not deactivated or does not exist");
    }

    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const isWithinGracePeriod = Date.now() - account.deletedAt.getTime() <= thirtyDaysInMs;
    if (!isWithinGracePeriod) {
      throw new BadRequestException("The 30-day restoration window has expired");
    }

    const isMatch = await compareHash({
      plainText: password,
      cipherText: account.password as string,
    });
    if (!isMatch) {
      throw new UnauthorizedException("Email or Password is incorrect");
    }

    // Restore user account (pre hook unsets deletedAt when restoredAt is provided)
    await this.userRepository.updateOne({
      filter: { _id: account._id, paranoid: false },
      update: { restoredAt: new Date(), changeCredentialsTime: new Date() },
    });

    // Restore user posts
    await this.postService.restoreUserPosts(account._id);

    // Reload active account and return fresh credentials
    const restoredUser = await this.userRepository.findOne({
      filter: { _id: account._id },
      options: { lean: false },
    });

    if (!restoredUser) {
      throw new NotFoundException("Failed to load restored account");
    }

    const credentials = await this.tokenService.createLoginCredentials(restoredUser, issuer);
    return { user: restoredUser, ...credentials };
  };

  // hard delete account (permanent purge with cascade)
  public hardDeleteAccount = async (user: HydratedDocument<IUser>) => {
    // 1. Cascade delete all posts and related data (comments, shares, S3 assets)
    await this.postService.deleteUserPosts(user._id);

    // 2. Cascade delete user's comments & replies on other posts (with asset & counter cleanups)
    await this.commentService.deleteUserComments(user._id);

    // 3. Remove user reactions from other posts
    await this.postService.removeUserReactions(user._id);

    // 4. Remove user reactions from other comments
    await this.commentService.removeUserReactions(user._id);

    // 5. Remove user from all friends lists
    await this.userRepository.updateMany({
      filter: { friends: user._id },
      update: { $pull: { friends: user._id } },
    });

    // 6. Delete all friend requests involving this user
    await this.friendRequestRepository.deleteMany({
      filter: { $or: [{ sender: user._id }, { receiver: user._id }] },
    });

    // 7. Invalidate active Redis tokens
    const revokedKeys = await this.redis.scanKeys(this.redis.revokeTokenPrefix(user._id));
    if (revokedKeys.length) {
      await this.redis.del(revokedKeys);
    }

    // Disconnect active socket sessions on permanent account deletion (VULN-BE-14)
    this.socketService.getIO()?.in(`user:${user._id.toString()}`).disconnectSockets(true);

    // 8. Delete user account document permanently
    const account = await this.userRepository.deleteOne({
      filter: { _id: user._id, force: true },
    });

    if (!account.deletedCount) {
      throw new NotFoundException("Account not found");
    }

    // 9. Delete user S3 folder (profile and cover pictures, including legacy keys)
    await this.s3.deleteFolderByPrefix({
      prefix: `${user._id.toString()}`,
    }).catch(() => undefined);
    await this.s3.deleteFolderByPrefix({
      prefix: `users/${user._id.toString()}`,
    }).catch(() => undefined);

    // 10. Delete user from Knock
    try {
      await this.notificationsService.deleteUser(user._id.toString());
    } catch (err) {
      console.error("Failed to delete user in Knock:", err);
    }

    return { message: "Account permanently deleted" };
  };

}

export const userService = new UserService();
