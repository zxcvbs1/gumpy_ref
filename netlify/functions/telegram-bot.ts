import { Telegraf } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import { MyContext } from '../../src/types'; // Ajustar ruta si es necesario
import { registerAllHandlers } from '../../src/botHandlers'; // Ajustar ruta si es necesario
import 'dotenv/config'; // Para cargar variables de entorno si se ejecuta localmente con netlify dev

// Inicializar Prisma Client fuera del handler para reutilización en ejecuciones "cálidas"
const prisma = new PrismaClient();

// Variables de entorno (deben estar configuradas en Netlify)
const botToken = process.env.BOT_TOKEN;
const adminUserIdEnv = process.env.ADMIN_USER_ID;
const botUsernameEnv = process.env.BOT_USERNAME;

if (!botToken) {
  throw new Error('FATAL: BOT_TOKEN no está configurado en las variables de entorno.');
}
if (!adminUserIdEnv) {
  throw new Error('FATAL: ADMIN_USER_ID no está configurado en las variables de entorno.');
}
if (!botUsernameEnv) {
  throw new Error('FATAL: BOT_USERNAME no está configurado en las variables de entorno.');
}

const adminUserId = parseInt(adminUserIdEnv, 10);
if (isNaN(adminUserId)) {
  throw new Error('FATAL: ADMIN_USER_ID no es un número válido.');
}

// Crear instancia del bot (también fuera del handler para reutilización)
const bot = new Telegraf<MyContext>(botToken);

// --- Configurar Middlewares ---
bot.use(async (ctx, next) => {
  ctx.db = prisma;
  ctx.adminUserId = adminUserId;
  ctx.botUsername = botUsernameEnv;
  // ctx.botInfo es poblado por Telegraf. Si se necesita explícitamente antes:
  if (!ctx.botInfo) {
      try {
        ctx.botInfo = await ctx.telegram.getMe();
      } catch (e) {
        console.error("Netlify: No se pudo obtener botInfo (getMe):", e);
      }
  }
  return next();
});

// --- Registrar todos los Handlers ---
registerAllHandlers(bot);

// --- Manejador de Errores Global para Webhook ---
bot.catch((err: any, ctx: MyContext) => {
  console.error(`Error en función Netlify para ${ctx.updateType}`, err);
  // Importante: No enviar ctx.reply en producción para webhooks,
  // ya que Telegram podría reintentar la solicitud si la respuesta no es 200 OK.
  // Los errores deben ser manejados y logueados aquí.
  // Si un comando específico debe notificar al usuario de un error,
  // ese handler de comando debe atrapar su propio error y enviar la respuesta.
});

// --- Netlify Function Handler ---
export const handler = async (event: { body?: string | null; headers: any, httpMethod: string }) => {
  if (event.httpMethod !== 'POST' || !event.body) {
    // Telegram solo debería enviar POST. Ignorar otros.
    return {
      statusCode: 405, // Method Not Allowed
      body: 'Este endpoint solo acepta solicitudes POST de Telegram.',
    };
  }

  try {
    // `bot.handleUpdate` procesa el cuerpo del webhook JSON.
    // El segundo argumento es opcional y permite pasar una respuesta de Express/http,
    // pero no es necesario para Netlify si solo devolvemos un status 200.
    await bot.handleUpdate(JSON.parse(event.body));
    return { statusCode: 200, body: 'Actualización procesada' };
  } catch (e: any) {
    console.error('Error en el manejador de la función Netlify:', e);
    return {
      statusCode: 500, // Internal Server Error
      body: 'Error procesando la actualización: ' + e.message,
    };
  }
};

// Manejo de cierre para Prisma (aunque en serverless es menos crítico, es buena práctica)
// Netlify podría no garantizar que esto se ejecute siempre.
const gracefulShutdown = async (signal: string) => {
  console.log(`Recibido ${signal}. Desconectando Prisma...`);
  await prisma.$disconnect();
  console.log('Prisma desconectado para la instancia de la función.');
  process.exit(0); // Salir limpiamente
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
