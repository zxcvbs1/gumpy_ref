import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { MyContext } from './types'; // Import shared context type
import { registerAllHandlers } from './botHandlers'; // Import the handler registration function
import 'dotenv/config'; // To load .env variables

const prisma = new PrismaClient();

async function main() {
  // --- Environment Variable Check ---
  const botToken = process.env.BOT_TOKEN;
  const databaseUrl = process.env.DATABASE_URL; // Prisma uses this automatically
  const adminUserIdEnv = process.env.ADMIN_USER_ID;
  const botUsernameEnv = process.env.BOT_USERNAME;

  if (!botToken) {
    console.error('Error: BOT_TOKEN no está configurado.');
    process.exit(1);
  }
  if (!adminUserIdEnv) {
    console.error('Error: ADMIN_USER_ID no está configurado.');
    process.exit(1);
  }
  if (!botUsernameEnv) {
    console.error('Error: BOT_USERNAME no está configurado.');
    process.exit(1);
  }
  if (!databaseUrl) {
    // This check is more for awareness; Prisma will throw an error if it can't connect.
    console.warn('Advertencia: DATABASE_URL no está explícitamente configurada en process.env para esta verificación, Prisma intentará leerla desde .env o su configuración interna.');
  }


  const adminUserId = parseInt(adminUserIdEnv, 10);
  if (isNaN(adminUserId)) {
    console.error('Error: ADMIN_USER_ID no es un número válido.');
    process.exit(1);
  }

  const bot = new Telegraf<MyContext>(botToken);

  // --- Middleware to inject Prisma, Admin ID, Bot Username, and BotInfo into context ---
  bot.use(async (ctx, next) => {
    ctx.db = prisma;
    ctx.adminUserId = adminUserId;
    ctx.botUsername = botUsernameEnv;
    // ctx.botInfo is typically populated by Telegraf on the first update or after launch.
    // If needed earlier (e.g. for a command that runs before any message),
    // you might need to call ctx.telegram.getMe() explicitly.
    // For our use case (needing botInfo in textHandler for replies), it should be available.
    if (!ctx.botInfo) {
        try {
            // Ensure botInfo is fetched if not already present.
            // This is a common pattern, though Telegraf often handles it.
            ctx.botInfo = await ctx.telegram.getMe();
        } catch (e) {
            console.error("No se pudo obtener botInfo (getMe):", e);
            // Depending on how critical botInfo is at this stage, you might exit or log.
        }
    }
    return next(); 
  });
  
  // --- Register all command and message handlers ---
  registerAllHandlers(bot);

  // --- Error Handling ---
  bot.catch((err: any, ctx: MyContext) => { // Added types for err and ctx
    console.error(`Ocurrió un error para ${ctx.updateType}`, err);
    // Avoid replying if it's a webhook to prevent retry loops, unless it's a specific user command error
    // For local development, replying is fine.
    if (process.env.NODE_ENV !== 'production') {
        ctx.reply('Algo salió mal. Por favor, inténtalo de nuevo más tarde.').catch(e => console.error("Fallo al enviar respuesta de error:", e));
    } else {
        // In production (webhook), just log. Avoid replying to prevent Telegram from retrying.
        // Specific command errors that should inform the user should be caught in the command handler itself.
        console.error("Error en producción no enviado al usuario:", err.message);
    }
  });

  // --- Start the bot (for local development) ---
  if (process.env.NODE_ENV !== 'production') {
    console.log('Iniciando el bot con long polling para desarrollo local...');
    bot.launch().then(() => {
      console.log('¡Bot iniciado correctamente!');
      if (bot.botInfo) {
        console.log(`Bot ID: ${bot.botInfo.id}, Bot Username: @${bot.botInfo.username}`);
      }
    }).catch(e => {
        console.error("Error al iniciar el bot con launch():", e);
    });
  } else {
    // For production (e.g., Netlify Functions), we export a handler.
    // The actual handler is in netlify/functions/telegram-bot.ts
    console.log('Bot configurado para producción (se espera configuración de webhook).');
    console.log('El manejador para Netlify se encuentra en netlify/functions/telegram-bot.ts');
  }

  // Enable graceful stop
  process.once('SIGINT', () => {
    console.log('Recibido SIGINT. Deteniendo bot...');
    bot.stop('SIGINT');
    prisma.$disconnect().then(() => console.log('Prisma desconectado.'));
  });
  process.once('SIGTERM', () => {
    console.log('Recibido SIGTERM. Deteniendo bot...');
    bot.stop('SIGTERM');
    prisma.$disconnect().then(() => console.log('Prisma desconectado.'));
  });
}

main().catch(async (e) => {
  console.error("Error crítico en la función main:", e);
  await prisma.$disconnect();
  process.exit(1);
});
