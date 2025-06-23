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
  let usedCustomCode: string | null = null;
  let customReferrerDetails: PrismaUser | null = null; // To store admin who created the code

  if (startPayload) {
    // Try to parse as BigInt (user ID referral) first
    try {
      const potentialReferrerId = BigInt(startPayload);
      if (potentialReferrerId !== userId) { // Cannot refer self
        const foundReferrer = await db.user.findUnique({ where: { id: potentialReferrerId } });
        if (foundReferrer) {
          referredByUserId = potentialReferrerId;
          referrerDetails = foundReferrer;
          // console.log(`Referral by user ID: ${referrerDetails.id}`);
        } else {
          // console.log(`Referrer user ID ${startPayload} not found. Checking for custom code.`);
        }
      }
    } catch (e) {
      // Not a BigInt, so it might be a custom code. Fall through.
      // console.log(`StartPayload ${startPayload} is not a user ID. Checking for custom code.`);
    }

    // If not referred by a direct user ID, check for custom invite code
    if (!referredByUserId) {
      const customInvite = await db.customInvite.findUnique({
        where: { code: startPayload, isEnabled: true },
        include: { createdBy: true } // Include the admin who created it
      });

      if (customInvite) {
        // console.log(`Found custom invite code: ${customInvite.code}`);
        let isValid = true;
        if (customInvite.expiresAt && new Date(customInvite.expiresAt) < new Date()) {
          // console.log(`Custom code ${customInvite.code} has expired.`);
          isValid = false;
        }
        if (customInvite.maxUses !== null && customInvite.currentUses >= customInvite.maxUses) {
          // console.log(`Custom code ${customInvite.code} has reached max uses.`);
          isValid = false;
        }

        if (isValid) {
          referredByUserId = customInvite.createdById; // The admin is the referrer
          customReferrerDetails = customInvite.createdBy; // Store admin details
          // Use customReferrerDetails for the 'referrer' in UpsertUserResult if this path is taken
          referrerDetails = customReferrerDetails;
          usedCustomCode = customInvite.code;
          // console.log(`Custom code ${customInvite.code} is valid. Referrer (admin): ${referredByUserId}`);

          // Increment uses (and potentially disable if maxUses reached)
          // This is done in a transaction later when creating/updating the user
        } else {
          // console.log(`Custom code ${startPayload} is invalid (expired or max uses).`);
        }
      } else {
        // console.log(`No valid custom invite code found for: ${startPayload}`);
      }
    }
  }

  const userRole = userId === BigInt(adminUserId) ? 'ADMIN' : 'USER';

  const existingUser = await db.user.findUnique({
    where: { id: userId },
  });

  if (existingUser) {
    // User exists. Update info.
    // Only apply referral (either direct or custom) if not already referred AND no custom code was previously used.
    const canApplyReferral = existingUser.referredById === null && existingUser.usedCustomInviteCode === null;
    let dataToUpdate: any = {
      username: username,
      firstName: firstName,
      role: userRole,
      updatedAt: new Date(),
    };

    if (canApplyReferral && referredByUserId) {
      dataToUpdate.referredById = referredByUserId;
      if (usedCustomCode) {
        dataToUpdate.usedCustomInviteCode = usedCustomCode;
      }
      referralActuallyApplied = true;
    }

    let updatedUser = existingUser;
    if (referralActuallyApplied && usedCustomCode) {
      // Transaction to update user and custom invite usage
      [updatedUser] = await db.$transaction([
        db.user.update({ where: { id: userId }, data: dataToUpdate }),
        db.customInvite.update({
          where: { code: usedCustomCode },
          data: {
            currentUses: { increment: 1 },
            // Optionally disable if max uses reached
            // isEnabled: (customInvite.maxUses !== null && customInvite.currentUses + 1 >= customInvite.maxUses) ? false : true
            // For simplicity, isEnabled logic can be handled separately or by a cron if needed for auto-disabling
          }
        })
      ]);
    } else {
        updatedUser = await db.user.update({ where: { id: userId }, data: dataToUpdate });
    }

    // If referral was by custom code, referrerDetails should be the admin who created it
    return { user: updatedUser, isNewUser: false, referralApplied: referralActuallyApplied, referrer: referrerDetails };

  } else {
    // New user
    let dataToCreate: any = {
      id: userId,
      username: username,
      firstName: firstName,
      role: userRole,
    };
    if (referredByUserId) {
      dataToCreate.referredById = referredByUserId;
      if (usedCustomCode) {
        dataToCreate.usedCustomInviteCode = usedCustomCode;
      }
      referralActuallyApplied = true;
    }

    let newUser: PrismaUser;
    if (referralActuallyApplied && usedCustomCode) {
       // Transaction to create user and update custom invite usage
      [newUser] = await db.$transaction([
        db.user.create({ data: dataToCreate }),
        db.customInvite.update({
          where: { code: usedCustomCode },
          data: { currentUses: { increment: 1 } }
        })
      ]);
    } else {
      newUser = await db.user.create({ data: dataToCreate });
    }

    return { user: newUser, isNewUser: true, referralApplied: referralActuallyApplied, referrer: referrerDetails };
  }
}
