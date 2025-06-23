-- AlterTable
ALTER TABLE "users" ADD COLUMN     "usedCustomInviteCode" TEXT;

-- CreateTable
CREATE TABLE "custom_invites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_invites_code_key" ON "custom_invites"("code");

-- CreateIndex
CREATE INDEX "custom_invites_createdById_idx" ON "custom_invites"("createdById");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "user_used_custom_invite_code_fkey" FOREIGN KEY ("usedCustomInviteCode") REFERENCES "custom_invites"("code") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "custom_invites" ADD CONSTRAINT "custom_invites_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
