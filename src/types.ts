import { Context as TelegrafContext, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { PrismaClient } from '@prisma/client';

export interface MyContext extends TelegrafContext<Update> {
  db: PrismaClient;
  adminUserId?: number; // Telegram IDs are numbers
  botUsername?: string;
  botInfo?: Telegraf.Telegram['botInfo']; // For bot's own ID, automatically added by Telegraf
}
