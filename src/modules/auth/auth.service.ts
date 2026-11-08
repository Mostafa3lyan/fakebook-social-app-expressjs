
import { randomUUID } from "node:crypto";
import { OAuth2Client, TokenPayload } from "google-auth-library";
import { JwtPayload } from "jsonwebtoken";
import { HydratedDocument, Types } from "mongoose";
import { EmailSubjectEnum } from "../../common/enums";
import { HashApproachEnum } from "../../common/enums/security.enum";
import { ProviderEnum } from "../../common/enums/user.enum";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
  UnauthorizedException,
} from "../../common/exceptions/index";
import { IUser } from "../../common/interfaces";
import { notificationsService, NotificationsService, TokenService } from "../../common/services";
import { RedisService, redisService } from "../../common/services/redis.service";
import { createOtp, emailEmitter, magicLinkTemplate, sendEmail } from "../../common/utils/index";
import {
  compareHash,
  generateHash
} from "../../common/utils/security/index";
import { CLIENT_URL, GOOGLE_CLIENT_ID, MAGIC_LINK_SECRET } from "../../config/config.service";
import { UserRepository } from "./../../DB/repository/user.repository";
import { ILoginResponse } from './auth.entity';
import { EmailDto, EmailOtpDto, LoginDto, SignupDto } from "./auth.validation";

class AuthenticationService {
  private readonly userRepository: UserRepository;
  private readonly redis: RedisService;
  private readonly tokenService: TokenService;
  private readonly notificationsService: NotificationsService;

  private readonly MAX_ATTEMPTS = 3;
  private readonly MAX_VERIFY_ATTEMPTS = 5;
  private readonly BLOCK_TTL = 60 * 60; // 1 hour

  private async checkAndIncrementVerifyAttempts(attemptsKey: string, targetKey: string): Promise<void> {
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.expire(attemptsKey, 300);
    }
    if (attempts >= this.MAX_VERIFY_ATTEMPTS) {
      await this.redis.del([attemptsKey, targetKey]);
      throw new TooManyRequestsException("Maximum invalid attempts exceeded. Please request a new code.");
    }
  }

  // constructor
  constructor(
    userRepository: UserRepository = new UserRepository(),
    redis: RedisService = redisService,
    tokenService: TokenService = new TokenService(),
    notifications: NotificationsService = notificationsService,
  ) {
    this.userRepository = userRepository;
    this.redis = redis;
    this.tokenService = tokenService;
    this.notificationsService = notifications;
  }


  // OTP core
  // ===========================

  // generateHashedOtp
  private generateHashedOtp = async (email: string, subject: EmailSubjectEnum): Promise<number> => {
    const payload = { email, subject };

    const isBlocked = await this.redis.get(this.redis.otpBlockKey(payload));
    if (isBlocked) {
      const remaining = await this.redis.ttl(this.redis.otpBlockKey(payload));
      throw new TooManyRequestsException(
        `Too many attempts. Try again in ${Math.ceil(remaining / 60)} minutes.`,
      );
    }

    const attempts = await this.redis.incr(this.redis.otpAttemptsKey(payload));
    if (attempts === 1) await this.redis.expire(this.redis.otpAttemptsKey(payload), this.BLOCK_TTL);

    if (attempts > this.MAX_ATTEMPTS) {
      await this.redis.set(this.redis.otpBlockKey(payload), "1", this.BLOCK_TTL);
      await this.redis.del(this.redis.otpAttemptsKey(payload));
      throw new TooManyRequestsException(
        `Too many attempts. Try again in ${this.BLOCK_TTL / 60} minutes.`,
      );
    }

    const code = await createOtp();
    await this.redis.set(this.redis.otpKey(payload), await generateHash({ plainText: `${code}` }), 300);
    return code;
  };

  // sendEmailWithOtp
  private sendEmailWithOtp = async (
    email: string,
    title: string,
    subject: EmailSubjectEnum,
  ): Promise<void> => {
    const code = await this.generateHashedOtp(email, subject);

    emailEmitter.emit("sendOtpEmail", { to: email, title, subject, code });
  };

  // Signup / email confirmation
  // ===========================

  // signup
  public signup = async (data: SignupDto): Promise<IUser> => {
    const { firstName, lastName, email, password, phone, dateOfBirth, gender } = data as SignupDto;

    const emailExist = await this.userRepository.findOne({
      filter: { email, paranoid: false },
    });
    if (emailExist) {
      if (!emailExist.emailConfirmedAt && (!emailExist.provider || emailExist.provider === ProviderEnum.System)) {
        try {
          const payload = { email, subject: EmailSubjectEnum.Confirm_EMAIL };
          const otpTtl = await this.redis.ttl(this.redis.otpKey(payload));
          if (otpTtl <= 0) {
            await this.sendEmailWithOtp(email, "email address", EmailSubjectEnum.Confirm_EMAIL);
          }
        } catch {
          // Ignore OTP cooldown/rate-limit errors so the user is still redirected to confirm-signup-email
        }
        return emailExist as unknown as IUser;
      }
      throw new ConflictException("Email already exist");
    }

    const [user] = await this.userRepository.create({
      data: [
        {
          firstName,
          lastName,
          email,
          password,
          phone,
          dateOfBirth,
          gender,
        },
      ],
    });

    if (!user) {
      throw new BadRequestException("User not created");
    }

    await this.sendEmailWithOtp(email, "email address", EmailSubjectEnum.Confirm_EMAIL);

    return user.toJSON();
  };

  // confirmEmail
  public confirmEmail = async ({ email, otp }: EmailOtpDto): Promise<void> => {
    const payload = { email, subject: EmailSubjectEnum.Confirm_EMAIL };

    const account = await this.userRepository.findOne({
      filter: { email, emailConfirmedAt: { $exists: false }, provider: ProviderEnum.System },
      options: { lean: false },
    });
    if (!account) {
      throw new NotFoundException("cannot find account with this email");
    }

    const storedHashedOtp = await this.redis.get(this.redis.otpKey(payload));
    if (!storedHashedOtp) {
      throw new BadRequestException("OTP has expired or is invalid");
    }

    const match = await compareHash({ plainText: `${otp}`, cipherText: storedHashedOtp as string });
    if (!match) {
      await this.checkAndIncrementVerifyAttempts(
        this.redis.otpVerifyAttemptsKey(payload),
        this.redis.otpKey(payload),
      );
      throw new BadRequestException("Invalid OTP");
    }

    account.emailConfirmedAt = new Date();
    await account.save();

    try {
      await this.notificationsService.identifyUser(account);
    } catch (err) {
      console.error("Failed to identify user in Knock:", err);
    }

    await this.redis.del([
      this.redis.otpKey(payload),
      this.redis.otpAttemptsKey(payload),
      this.redis.otpBlockKey(payload),
      this.redis.otpVerifyAttemptsKey(payload),
    ]);
  };

  // reSendConfirmEmail
  public reSendConfirmEmail = async ({ email }: EmailDto): Promise<void> => {
    const payload = { email, subject: EmailSubjectEnum.Confirm_EMAIL };

    const account = await this.userRepository.findOne({
      filter: { email, emailConfirmedAt: { $exists: false }, provider: ProviderEnum.System },
    });
    if (!account) {
      throw new NotFoundException("cannot find account with this email");
    }

    const otpTtl = await this.redis.ttl(this.redis.otpKey(payload));
    if (otpTtl > 0) {
      throw new ConflictException(`Please wait ${otpTtl} seconds before requesting a new otp.`);
    }

    await this.sendEmailWithOtp(email, "email address", EmailSubjectEnum.Confirm_EMAIL);
  };

  // Password reset (magic link + OTP)
  // ===========================

  // sendMagicLink
  private sendMagicLink = async (email: string, userId: Types.ObjectId): Promise<void> => {
    const token = this.tokenService.generateToken({ payload: { userId }, secretKey: MAGIC_LINK_SECRET, options: { expiresIn: "15m" } });
    const link = `${CLIENT_URL}/reset-password?token=${token}`;

    await sendEmail({ to: email, subject: "reset your password", html: magicLinkTemplate(link) });
  };

  // forgotPassword
  public forgotPassword = async ({ email, method = "otp" }: { email: string; method?: "otp" | "link" }): Promise<void> => {
    const account = await this.userRepository.findOne({
      filter: { email, emailConfirmedAt: { $exists: true }, provider: ProviderEnum.System },
      options: { lean: false },
    });
    if (!account) {
      throw new NotFoundException("Cannot find account with this email");
    }

    if (method === "link") {
      await this.sendMagicLink(email, account._id);
    } else {
      await this.sendEmailWithOtp(email, "reset code", EmailSubjectEnum.Forgot_Password);
    }
  };

  // verifyOtp
  public verifyOtp = async ({ email, otp }: EmailOtpDto): Promise<{ resetToken: string }> => {
    const payload = { email, subject: EmailSubjectEnum.Forgot_Password };

    const account = await this.userRepository.findOne({
      filter: { email, emailConfirmedAt: { $exists: true }, provider: ProviderEnum.System },
      options: { lean: false },
    });
    if (!account) {
      throw new NotFoundException("Cannot find account with this email");
    }

    const storedHashedOtp = await this.redis.get(this.redis.otpKey(payload));
    if (!storedHashedOtp) {
      throw new BadRequestException("OTP has expired or is invalid");
    }

    const match = await compareHash({ plainText: `${otp}`, cipherText: storedHashedOtp as string });
    if (!match) {
      await this.checkAndIncrementVerifyAttempts(
        this.redis.otpVerifyAttemptsKey(payload),
        this.redis.otpKey(payload),
      );
      throw new BadRequestException("Invalid OTP");
    }

    const resetToken = randomUUID();
    await this.redis.set(this.redis.resetTokenKey(resetToken), account._id.toString(), 60 * 10);
    await this.redis.del([
      this.redis.otpKey(payload),
      this.redis.otpAttemptsKey(payload),
      this.redis.otpBlockKey(payload),
      this.redis.otpVerifyAttemptsKey(payload),
    ]);

    return { resetToken };
  };

public verifyMagicLink = async (token: string): Promise<{ resetToken: string }> => {
  const INVALID = "Magic link is invalid or expired";

  // 1. Verify signature and expiry
  let payload: JwtPayload;
  try {
    payload = this.tokenService.verifyToken({ token, secretKey: MAGIC_LINK_SECRET });
  } catch {
    throw new BadRequestException(INVALID);
  }

  // 2. Atomically claim the link (single use, race-safe).
  //    TTL covers the JWT's remaining lifetime so the link can never become reusable.
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = payload.exp ? payload.exp - nowSec : 60 * 15;
  const claimed = await this.redis.setIfNotExists(
    this.redis.magicLinkRevokeKey(token),
    "1",
    Math.max(remaining, 1),
  );
  if (!claimed) throw new BadRequestException(INVALID);

  // 3. Load the account (email confirmed, password-based accounts only)
  const account = await this.userRepository.findOne({
    filter: {
      _id: payload.userId,
      emailConfirmedAt: { $exists: true },
      provider: ProviderEnum.System,
    },
    options: { lean: false },
  });
  if (!account) throw new BadRequestException(INVALID); // same message, no account leak

  // 4. Issue a short-lived, single-use reset token
  const resetToken = randomUUID();
  await this.redis.set(
    this.redis.resetTokenKey(resetToken),
    account._id.toString(),
    60 * 10,
  );

  return { resetToken };
};

  // resetPassword
  public resetPassword = async ({ resetToken, password }: { resetToken: string; password: string }) => {
    const userId = await this.redis.get(this.redis.resetTokenKey(resetToken));
    if (!userId) {
      throw new BadRequestException("Reset token is invalid or expired");
    }

    const account = await this.userRepository.findOne({
      filter: { _id: userId as string, emailConfirmedAt: { $exists: true }, provider: ProviderEnum.System },
      options: { lean: false },
    });
    if (!account) {
      throw new NotFoundException("Cannot find account");
    }

    account.password = password;
    account.resetVerifiedAt = undefined;
    account.changeCredentialsTime = new Date();
    await account.save();

    await this.redis.del(this.redis.resetTokenKey(resetToken));
    await this.redis.del(await this.redis.scanKeys(this.redis.revokeTokenPrefix(account._id)));

    return account;
  };

  // Login / 2FA
  // ===========================

  // login
  public async login(data: LoginDto, issuer: string): Promise<ILoginResponse> {
    const { email, password, fcmToken } = data;

    const user = await this.userRepository.findOne({
      filter: { email, provider: ProviderEnum.System, emailConfirmedAt: { $exists: true } },
      projection: "+password",
      options: { lean: false },
    });

    if (!user) {
      const unconfirmedUser = await this.userRepository.findOne({
        filter: { email, provider: ProviderEnum.System, emailConfirmedAt: { $exists: false } },
        projection: "+password",
        options: { lean: false },
      });

      if (unconfirmedUser) {
        const match = await compareHash({
          plainText: password,
          cipherText: unconfirmedUser.password as string,
          approach: HashApproachEnum.bcrypt,
        });

        if (match) {
          try {
            const payload = { email, subject: EmailSubjectEnum.Confirm_EMAIL };
            const otpTtl = await this.redis.ttl(this.redis.otpKey(payload));
            if (otpTtl <= 0) {
              await this.sendEmailWithOtp(email, "email address", EmailSubjectEnum.Confirm_EMAIL);
            }
          } catch {
            // Ignore OTP cooldown/rate-limit errors so the user is still redirected to confirm-signup-email
          }
          throw new ForbiddenException("Email is not confirmed. Please verify your email.");
        }
      }

      const deactivatedUser = await this.userRepository.findOne({
        filter: { email, provider: ProviderEnum.System, emailConfirmedAt: { $exists: true }, paranoid: false },
        projection: "+password",
        options: { lean: false },
      });

      if (deactivatedUser && deactivatedUser.deletedAt) {
        const match = await compareHash({
          plainText: password,
          cipherText: deactivatedUser.password as string,
          approach: HashApproachEnum.bcrypt,
        });

        if (match) {
          const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
          const isWithinGracePeriod = Date.now() - deactivatedUser.deletedAt.getTime() <= thirtyDaysInMs;
          if (isWithinGracePeriod) {
            throw new UnauthorizedException(
              "Account is deactivated. You can restore your account within 30 days",
            );
          } else {
            throw new UnauthorizedException("Account has been permanently deactivated.");
          }
        }
      }

      throw new UnauthorizedException("Email or Password is incorrect");
    }

    const match = await compareHash({
      plainText: password,
      cipherText: user.password as string,
      approach: HashApproachEnum.bcrypt,
    });
    if (!match) {
      throw new UnauthorizedException("Email or Password is incorrect");
    }

    if (user.twoFactorVerified) {
      await this.requestTwoFactorAuth(user);
      return { twoFactorRequired: true } as ILoginResponse;
    }

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to identify user in Knock on login:", err);
    }

    if (fcmToken) {
      await this.notificationsService.sendUserFcmToken(
        user._id.toString(),
        fcmToken,
      );
    }

    return this.tokenService.createLoginCredentials(user, issuer);
  };

  // loginConfirm
  public loginConfirm = async ({ email, otp }: EmailOtpDto, issuer: string) => {
    const user = await this.userRepository.findOne({
      filter: { email, provider: ProviderEnum.System, emailConfirmedAt: { $exists: true } },
      options: { lean: false },
    });
    if (!user) {
      throw new UnauthorizedException("Email or Password is incorrect");
    }
    if (!user.twoFactorVerified) {
      throw new BadRequestException("2FA is not enabled for this account");
    }

    const storedHashedOtp = await this.redis.get(this.redis.twoFaKey(user._id));
    if (!storedHashedOtp) {
      throw new BadRequestException("OTP has expired or is invalid");
    }

    const match = await compareHash({ plainText: `${otp}`, cipherText: storedHashedOtp as string });
    if (!match) {
      await this.checkAndIncrementVerifyAttempts(
        this.redis.twoFaVerifyAttemptsKey(user._id),
        this.redis.twoFaKey(user._id),
      );
      throw new BadRequestException("2FA code is incorrect");
    }

    await this.redis.del([
      this.redis.twoFaKey(user._id),
      this.redis.twoFaAttemptsKey(user._id),
      this.redis.twoFaBlockKey(user._id),
      this.redis.twoFaVerifyAttemptsKey(user._id),
    ]);

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to identify user in Knock on loginConfirm:", err);
    }

    return this.tokenService.createLoginCredentials(user, issuer);
  };

  // requestTwoFactorAuth
  public requestTwoFactorAuth = async (user: HydratedDocument<IUser>): Promise<void> => {
    const isBlocked = await this.redis.get(this.redis.twoFaBlockKey(user._id));
    if (isBlocked) {
      const remaining = await this.redis.ttl(this.redis.twoFaBlockKey(user._id));
      throw new TooManyRequestsException(
        `Too many attempts. Try again in ${Math.ceil(remaining / 60)} minutes.`,
      );
    }

    const attempts = await this.redis.incr(this.redis.twoFaAttemptsKey(user._id));
    if (attempts === 1) await this.redis.expire(this.redis.twoFaAttemptsKey(user._id), this.BLOCK_TTL);

    if (attempts > this.MAX_ATTEMPTS) {
      await this.redis.set(this.redis.twoFaBlockKey(user._id), "1", this.BLOCK_TTL);
      await this.redis.del(this.redis.twoFaAttemptsKey(user._id));
      throw new TooManyRequestsException(
        `Too many attempts. Try again in ${this.BLOCK_TTL / 60} minutes.`,
      );
    }

    const code = await createOtp();
    await this.redis.set(this.redis.twoFaKey(user._id), await generateHash({ plainText: `${code}` }), 120);

    emailEmitter.emit("sendOtpEmail", {
      to: user.email,
      title: "2FA code",
      subject: "verify 2FA for your account",
      code,
    });
  };

  // enableTwoFactorAuth
  public enableTwoFactorAuth = async (user: HydratedDocument<IUser>, { otp }: { otp: string }): Promise<void> => {
    const storedHashedOtp = await this.redis.get(this.redis.twoFaKey(user._id));
    if (!storedHashedOtp) {
      throw new BadRequestException("OTP has expired or is invalid");
    }

    const match = await compareHash({ plainText: `${otp}`, cipherText: storedHashedOtp as string });
    if (!match) {
      await this.checkAndIncrementVerifyAttempts(
        this.redis.twoFaVerifyAttemptsKey(user._id),
        this.redis.twoFaKey(user._id),
      );
      throw new BadRequestException("Invalid OTP");
    }

    user.twoFactorVerified = true;
    await user.save();

    await this.redis.del([
      this.redis.twoFaKey(user._id),
      this.redis.twoFaAttemptsKey(user._id),
      this.redis.twoFaBlockKey(user._id),
      this.redis.twoFaVerifyAttemptsKey(user._id),
    ]);
  };

  // disableTwoFactorAuth
  public disableTwoFactorAuth = async (user: HydratedDocument<IUser>, { otp }: { otp: string }): Promise<void> => {
    if (!user.twoFactorVerified) {
      throw new BadRequestException("2FA is not enabled for this account");
    }

    const storedHashedOtp = await this.redis.get(this.redis.twoFaKey(user._id));
    if (!storedHashedOtp) {
      throw new BadRequestException("OTP has expired or is invalid");
    }

    const match = await compareHash({ plainText: `${otp}`, cipherText: storedHashedOtp as string });
    if (!match) {
      await this.checkAndIncrementVerifyAttempts(
        this.redis.twoFaVerifyAttemptsKey(user._id),
        this.redis.twoFaKey(user._id),
      );
      throw new BadRequestException("Invalid OTP");
    }

    user.twoFactorVerified = false;
    await user.save();

    await this.redis.del([
      this.redis.twoFaKey(user._id),
      this.redis.twoFaAttemptsKey(user._id),
      this.redis.twoFaBlockKey(user._id),
      this.redis.twoFaVerifyAttemptsKey(user._id),
    ]);
  };

  // Google OAuth
  // ===========================

  // verifyGoogleToken
  private verifyGoogleToken = async (idToken: string): Promise<TokenPayload> => {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email_verified) {
      throw new BadRequestException("fail to verify by google");
    }
    return payload;
  };

  // signupWithGmail
  public signupWithGmail = async (idToken: string, issuer: string) => {
    const payload = await this.verifyGoogleToken(idToken);

    const checkExist = await this.userRepository.findOne({
      filter: { email: payload.email as string, paranoid: false },
    });
    if (checkExist) {
      if (checkExist.provider !== ProviderEnum.Google) {
        throw new ConflictException("invalid provider");
      }
      return {
        message: "logged in successfully",
        status: 200,
        credentials: await this.loginWithGmail(idToken, issuer),
      };
    }

    const rawFirstName = (payload.given_name || payload.name?.split(" ")[0] || "User").trim();
    const rawLastName = (
      payload.family_name ||
      payload.name?.split(" ").slice(1).join(" ") ||
      rawFirstName
    ).trim();

    const firstName = rawFirstName.length >= 2 ? rawFirstName.slice(0, 50) : `${rawFirstName}User`;
    const lastName = rawLastName.length >= 2 ? rawLastName.slice(0, 50) : `${rawLastName}Account`;

    const user = await this.userRepository.createOne({
      data: {
        firstName,
        lastName,
        email: payload.email as string,
        profilePicture: payload.picture as string,
        emailConfirmedAt: new Date(),
        provider: ProviderEnum.Google,
      },
    });

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to identify Google user in Knock:", err);
    }

    return {
      message: "signed up successfully",
      status: 201,
      credentials: await this.tokenService.createLoginCredentials(user, issuer),
    };
  };

  // loginWithGmail
  private loginWithGmail = async (idToken: string, issuer: string): Promise<ILoginResponse> => {
    const payload = await this.verifyGoogleToken(idToken);
    const user = await this.userRepository.findOne({
      filter: { email: payload.email as string, provider: ProviderEnum.Google },
      options: { lean: false },
    });
    if (!user) {
      throw new NotFoundException("Not registered account");
    }

    try {
      await this.notificationsService.identifyUser(user);
    } catch (err) {
      console.error("Failed to identify Google user in Knock on login:", err);
    }

    return this.tokenService.createLoginCredentials(user, issuer);
  };
}

export const authService = new AuthenticationService();
