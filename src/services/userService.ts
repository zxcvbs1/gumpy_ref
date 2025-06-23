import { PrismaClient, User as PrismaUser } from '@prisma/client';
import { User as TelegramUser } from 'telegraf/typings/core/types/typegram';

// Type for the result of user upsertion, including whether they were newly created or if referral was applied
export interface UpsertUserResult {
  user: PrismaUser;
  isNewUser: boolean;
  referralApplied: boolean;
  referrer?: PrismaUser | null;
}

/**
 * Finds an existing user or creates a new one.
 * Handles associating a referrer if a valid startPayload (referrerId) is provided
 * and the user hasn't been referred before.
 * Assigns ADMIN role if the user's ID matches the adminUserId.
 * 
 * @param db PrismaClient instance
 * @param telegramUser Telegram user object from ctx.from
 * @param startPayload The payload from ctx.startPayload (potential referrer ID)
 * @param adminUserId The ID of the admin user
 * @returns UpsertUserResult containing the user, and flags for creation/referral.
 */
export async function findOrCreateUserAndHandleReferral(
  db: PrismaClient,
  telegramUser: TelegramUser,
  startPayload: string | undefined,
  adminUserId: number
): Promise<UpsertUserResult> {
  const userId = BigInt(telegramUser.id);
  const username = telegramUser.username;
  const firstName = telegramUser.first_name;

  let referredByUserId: bigint | null = null;
  let referrerDetails: PrismaUser | null = null;
  let referralActuallyApplied = false;

  if (startPayload) {
    try {
      const potentialReferrerId = BigInt(startPayload);
      if (potentialReferrerId !== userId) { // Cannot refer self
        const foundReferrer = await db.user.findUnique({ where: { id: potentialReferrerId } });
        if (foundReferrer) {
          referredByUserId = potentialReferrerId;
          referrerDetails = foundReferrer;
        } else {
          console.log(`Referrer with ID ${startPayload} not found during user upsert.`);
        }
      }
    } catch (e) {
      console.error(`Invalid startPayload (referrer_id) during user upsert: ${startPayload}`, e);
    }
  }

  const userRole = userId === BigInt(adminUserId) ? 'ADMIN' : 'USER';

  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (existingUser) {
    // User exists. Update info. Only apply referral if not already referred.
    const shouldApplyReferralNow = existingUser.referredById === null && referredByUserId !== null;
    if (shouldApplyReferralNow) {
        referralActuallyApplied = true;
    }

    const updatedUser = await db.user.update({
      where: { id: userId },
      data: {
        username: username,
        firstName: firstName,
        role: userRole, 
        referredById: shouldApplyReferralNow ? referredByUserId : existingUser.referredById,
        updatedAt: new Date(),
      },
    });
    return { user: updatedUser, isNewUser: false, referralApplied: referralActuallyApplied, referrer: referrerDetails };
  } else {
    // New user
    const newUser = await db.user.create({
      data: {
        id: userId,
        username: username,
        firstName: firstName,
        role: userRole,
        referredById: referredByUserId, // Apply referral if present
      },
    });
    return { user: newUser, isNewUser: true, referralApplied: referredByUserId !== null, referrer: referrerDetails };
  }
}
