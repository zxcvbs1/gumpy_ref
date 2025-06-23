import { Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { User as PrismaUser, PrismaClient, Prisma } from '@prisma/client'; // Import Prisma
import { MyContext } from './types'; // We'll define MyContext in a separate types file for shared use
import { findOrCreateUserAndHandleReferral } from './services/userService';

// It's good practice to define shared context types in a separate file.
// Let's assume MyContext will be moved to 'src/types.ts'
// For now, if MyContext is defined in src/index.ts, this import won't work until we adjust it.
// Let's proceed by defining it here temporarily and then plan to move it.
/*
interface MyContext extends Telegraf.Context<Update> {
  db: PrismaClient;
  adminUserId?: number;
  botUsername?: string;
  botInfo?: Telegraf.Telegram['botInfo']; // For bot's own ID
}
*/


export function setupStartHandler(bot: Telegraf<MyContext>) {
  bot.start(async (ctx) => {
    // Logic from src/index.ts for bot.start() will go here
    // This will use findOrCreateUserAndHandleReferral
    try {
      const fromUser = ctx.from;
      if (!fromUser) {
        return ctx.reply('No se pudo identificar al usuario.');
      }
      if (!ctx.adminUserId) { 
        console.error("ID de Admin no encontrado en el contexto para /start");
        return ctx.reply("Ocurrió un error de configuración interna.");
      }

      const { user, isNewUser, referralApplied, referrer } = await findOrCreateUserAndHandleReferral(
        ctx.db,
        fromUser,
        ctx.startPayload,
        ctx.adminUserId
      );

      let message = '';
      const userNameForReply = user.firstName || user.username || 'usuario';

      if (isNewUser) {
        message = `¡Hola, ${userNameForReply}! 👋 `;
        if (referralApplied && referrer) {
          const referrerName = referrer.firstName || referrer.username || 'otro usuario';
          message += `Has sido invitado/a por ${referrerName}.`;
        } else {
          message += "Te has registrado correctamente.";
        }
      } else { // Existing user
        message = `¡Hola de nuevo, ${userNameForReply}! 👋`;
        if (referralApplied && referrer) {
          const referrerName = referrer.firstName || referrer.username || 'otro usuario';
          message += `\nAhora has quedado registrado/a como invitado/a por ${referrerName}.`;
        }
      }
      
      message += "\nUsa /invitar para obtener tu enlace y traer a más amigos, o /mis_invitados para ver a quiénes has invitado.";
      if (user.role === 'ADMIN') {
        message += "\nLos comandos de administrador están disponibles para ti.";
      }
      await ctx.reply(message);

    } catch (error) {
      console.error('Error en el manejador /start:', error);
      await ctx.reply('Ocurrió un error al procesar tu comando /start. Por favor, inténtalo de nuevo.');
    }
  });
}

export function setupReferHandler(bot: Telegraf<MyContext>) {
  bot.command(['refer', 'invitar'], async (ctx) => { // Added 'invitar'
    // Logic from src/index.ts for bot.command('refer')
    try {
      const fromUser = ctx.from;
      if (!fromUser) {
        return ctx.reply('No pude identificarte para generar un enlace de invitación.');
      }
      const user = await ctx.db.user.findUnique({ where: { id: BigInt(fromUser.id) } });
      if (!user) {
        return ctx.reply('Por favor, inicia el bot con /start antes de obtener un enlace de invitación.');
      }

      if (!ctx.botUsername) {
        console.error("BOT_USERNAME no está configurado en el contexto para el comando /invitar");
        return ctx.reply('Lo siento, no puedo generar un enlace de invitación en este momento debido a un problema de configuración.');
      }

      const referralLink = `https://t.me/${ctx.botUsername}?start=${fromUser.id}`;
      const userName = user.firstName || user.username || 'tú'; // user es el objeto Prisma del usuario que invita
      
      // Nombre del bot o comunidad. Podría ser una variable de entorno o estar hardcodeado.
      // Usaremos una variable de entorno si está disponible, o un default.
      const communityName = process.env.COMMUNITY_NAME || "esta comunidad/bot"; 

      // Mensaje de instrucción
      await ctx.reply(`¡Perfecto, ${userName}! ✨\nEl siguiente mensaje está listo para que lo reenvíes a tus amigos:`);

      // Mensaje reenviable
      const messageToForward = `¡Hola! 👋\n\nTe estoy invitando a unirte a ${communityName}. ¡Creo que te podría interesar!\n\nUsa mi enlace personal para empezar:\n🔗 ${referralLink}\n\n¡Espero verte por allí! 😉`;
      await ctx.reply(messageToForward);

    } catch (error) {
      console.error('Error en el manejador /invitar:', error);
      await ctx.reply('Ocurrió un error al generar tu enlace de invitación.');
    }
  });
}

export function setupMyReferralsHandler(bot: Telegraf<MyContext>) {
  bot.command(['my_referrals', 'mis_invitados'], async (ctx) => { // Added 'mis_invitados'
    // Logic from src/index.ts for bot.command('my_referrals')
     try {
      const fromUser = ctx.from;
      if (!fromUser) {
        return ctx.reply('No pude identificarte para buscar tus invitados.');
      }

      const userId = BigInt(fromUser.id);
      const userWithReferrals = await ctx.db.user.findUnique({
        where: { id: userId },
        include: {
          referralsGiven: { 
            select: { id: true, firstName: true, username: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!userWithReferrals) {
        return ctx.reply('Por favor, inicia el bot con /start primero.');
      }

      if (userWithReferrals.referralsGiven.length === 0) {
        return ctx.reply("Aún no has invitado a nadie. ¡Anímate a compartir tu enlace con /invitar!");
      }

      let message = "👍 Estos son los usuarios que has invitado:\n";
      userWithReferrals.referralsGiven.forEach(referredUser => {
        const name = referredUser.firstName || referredUser.username || `Usuario ID: ${referredUser.id}`;
        message += `- ${name} (Se unió el: ${referredUser.createdAt.toLocaleDateString()})\n`;
      });

      await ctx.reply(message);

    } catch (error) {
      console.error('Error en el manejador /mis_invitados:', error);
      await ctx.reply('Ocurrió un error al buscar tus invitados.');
    }
  });
}

// Placeholder for admin-only middleware function if we decide to move it here too
// export const adminOnlyMiddleware = ...

// --- Admin Middleware ---
const adminOnly = async (ctx: MyContext, next: () => Promise<void>) => {
  if (ctx.from && ctx.adminUserId && BigInt(ctx.from.id) === BigInt(ctx.adminUserId)) {
    return next(); // User is admin, proceed to the command handler
  }
  // User is not admin
  console.log(`Usuario no admin ${ctx.from?.id} intentó acceder a un comando de admin.`);
  return ctx.reply("Lo siento, este comando solo está disponible para administradores.").catch(e => console.error("Fallo al enviar respuesta de error de autenticación:", e));
};


export function setupAdminViewUsersHandler(bot: Telegraf<MyContext>) { 
  bot.command(['admin_view_users', 'admin_ver_usuarios'], adminOnly, async (ctx) => {
    // Logic from src/index.ts for bot.command('admin_view_users')
    try {
      const users = await ctx.db.user.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          referredBy: { 
            select: { id: true, firstName: true, username: true }
          }
        }
      });

      if (users.length === 0) {
        return ctx.reply('No hay usuarios registrados en la base de datos.');
      }

      let message = 'Usuarios Registrados:\n\n';
      users.forEach(user => {
        const name = user.firstName || user.username || 'N/A';
        const usernameInfo = user.username ? `@${user.username}` : 'N/A';
        const referredByInfo = user.referredBy 
          ? `${user.referredBy.firstName || user.referredBy.username || 'Usuario'} (ID: ${user.referredBy.id.toString()}${user.referredBy.username ? ', @' + user.referredBy.username : ''})` 
          : 'Nadie';
        message += `ID: ${user.id.toString()}\n`;
        message += `  Nombre: ${name}\n`;
        message += `  Username: ${usernameInfo}\n`;
        message += `  Rol: ${user.role}\n`;
        message += `  Invitado por: ${referredByInfo}\n`;
        message += `  Registrado: ${user.createdAt.toLocaleDateString()}\n\n`;
      });

      if (message.length > 4000) { 
        await ctx.reply(message.substring(0, 4000) + "\n\n[Lista truncada... existen más usuarios]");
      } else {
        await ctx.reply(message);
      }

    } catch (error) {
      console.error('Error en /admin_ver_usuarios:', error);
      await ctx.reply('Ocurrió un error al obtener los usuarios.');
    }
  });
}

export function setupAdminViewReferralsHandler(bot: Telegraf<MyContext>) { 
  bot.command(['admin_view_referrals', 'admin_info_usuario'], adminOnly, async (ctx) => {
    // Logic from src/index.ts for bot.command('admin_view_referrals')
    // This will also incorporate the new command name 'admin_info_usuario'
    try {
      const textParts = ctx.message.text.split(' ');
      if (textParts.length < 2) {
        return ctx.reply("Por favor, proporciona un ID de Usuario o @username. Uso: /admin_info_usuario <ID_o_@USERNAME>");
      }
      const targetIdentifier = textParts[1];

      // Define a type for the user object with included relations using Prisma.UserGetPayload
      type UserWithAdminInfoRelations = Prisma.UserGetPayload<{
        include: {
          referredBy: { select: { id: true, firstName: true, username: true } },
          referralsGiven: {
            select: { id: true, firstName: true, username: true, createdAt: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      }>;

      let targetUser: UserWithAdminInfoRelations | null = null;

      if (targetIdentifier.startsWith('@')) {
        const usernameToSearch = targetIdentifier.substring(1);
        // Use findFirst for non-id unique fields if not explicitly in UserWhereUniqueInput for findUnique
        targetUser = await ctx.db.user.findFirst({
          where: { username: usernameToSearch },
          include: { 
            referredBy: { select: { id: true, firstName: true, username: true }}, 
            referralsGiven: { select: { id: true, firstName: true, username: true, createdAt: true }, orderBy: { createdAt: 'asc' }}
          }
        });
      } else {
        try {
          const potentialId = BigInt(targetIdentifier);
          targetUser = await ctx.db.user.findUnique({ 
            where: { id: potentialId },
            include: { 
              referredBy: { select: { id: true, firstName: true, username: true }}, 
              referralsGiven: { select: { id: true, firstName: true, username: true, createdAt: true }, orderBy: { createdAt: 'asc' }}
            }
          });
        } catch (e) {
            // Not a BigInt, could be a username without @
            targetUser = await ctx.db.user.findFirst({ 
              where: { username: targetIdentifier }, // Search by username if not starting with @ and not a valid BigInt
              include: { 
                referredBy: { select: { id: true, firstName: true, username: true }}, 
                referralsGiven: { select: { id: true, firstName: true, username: true, createdAt: true }, orderBy: { createdAt: 'asc' }}
              }
            });
        }
      }

      if (!targetUser) {
        return ctx.reply(`Usuario "${targetIdentifier}" no encontrado.`);
      }

      const userNameDisplay = targetUser.firstName || targetUser.username || 'Usuario';
      const userUsernameInfo = targetUser.username ? `@${targetUser.username}` : 'N/A';
      let message = `Detalles del usuario: ${userNameDisplay} (ID: ${targetUser.id.toString()}, Username: ${userUsernameInfo}):\n\n`;
      
      if (targetUser.referredBy) {
        const referrerName = targetUser.referredBy.firstName || targetUser.referredBy.username || 'Usuario';
        const referrerUsername = targetUser.referredBy.username ? `@${targetUser.referredBy.username}` : 'N/A';
        message += `Invitado por: ${referrerName} (ID: ${targetUser.referredBy.id.toString()}, Username: ${referrerUsername})\n`;
      } else {
        message += "Invitado por: Nadie\n";
      }

      message += "\nUsuarios que ha invitado:\n";
      if (targetUser.referralsGiven && targetUser.referralsGiven.length > 0) {
        targetUser.referralsGiven.forEach(referred => {
          const name = referred.firstName || referred.username || 'Usuario';
          const referredUsername = referred.username ? `@${referred.username}` : 'N/A';
          message += `- ${name} (ID: ${referred.id.toString()}, Username: ${referredUsername}, Se unió: ${referred.createdAt.toLocaleDateString()})\n`;
        });
      } else {
        message += "- Ninguno\n";
      }

      await ctx.reply(message);

    } catch (error) {
      console.error('Error en /admin_info_usuario:', error);
      if (error instanceof TypeError && error.message.includes("Cannot convert")) {
         await ctx.reply("Formato de ID inválido. Por favor, proporciona un ID numérico o un @username.");
      } else {
         await ctx.reply('Ocurrió un error al obtener los detalles del usuario.');
      }
    }
  });
}

export function setupTextHandler(bot: Telegraf<MyContext>) {
  bot.on('text', async (ctx) => {
    // Logic from src/index.ts for bot.on('text') will go here
    // This will include the new logic for admin "reply" to forwarded message
    // AND the existing logic for forwarding user messages to admin
    // AND the new inline keyboard for admin
    try {
      const fromUser = ctx.from;
      if (!fromUser || !ctx.message || !('text' in ctx.message)) {
        return; 
      }
      const text = ctx.message.text;

      // --- PARTE 1: Admin respondiendo vía "Reply" a un mensaje reenviado ---
      if (ctx.adminUserId && fromUser.id === ctx.adminUserId && ctx.message.reply_to_message) {
        const repliedToMessage = ctx.message.reply_to_message;
        // Chequear si el mensaje al que se responde fue enviado por ESTE bot Y si es un mensaje que fue reenviado DE otro usuario
        if (
          repliedToMessage && // Ensure repliedToMessage itself is not undefined
          'from' in repliedToMessage && repliedToMessage.from?.id === ctx.botInfo?.id &&
          'forward_from' in repliedToMessage && repliedToMessage.forward_from && // Check existence with 'in', then truthiness for the object
          'forward_from_message_id' in repliedToMessage && repliedToMessage.forward_from_message_id // Check existence with 'in', then truthiness for the ID
        ) {
          // TypeScript should now correctly infer that repliedToMessage has these properties
          const originalSender = repliedToMessage.forward_from; // Info del usuario original
          const originalMessageIdInUserChat = repliedToMessage.forward_from_message_id; // ID del mensaje original de Ana en su chat
          const adminResponseText = text;

          try {
            await ctx.telegram.sendMessage(originalSender.id, `Respuesta del Administrador:\n\n${adminResponseText}`, {
              reply_parameters: { message_id: originalMessageIdInUserChat } // Citar el mensaje original del usuario
            });
            await ctx.reply(`Respuesta enviada a ${originalSender.username ? '@' + originalSender.username : 'ID: ' + originalSender.id} (citando su mensaje).`);
            return; // Terminar el procesamiento aquí
          } catch (e: any) {
            console.error("Error al enviar respuesta del admin vía reply:", e);
            await ctx.reply("Error al enviar la respuesta. Es posible que el usuario haya bloqueado al bot.");
            return;
          }
        }
      }

      // --- PARTE 2: Procesamiento normal de texto (reenvío al admin si es de un usuario) ---
      if (text.startsWith('/')) { // Ignorar comandos explícitos aquí
        return; 
      }

      const senderId = BigInt(fromUser.id);
      if (!ctx.adminUserId) {
        console.error("ADMIN_USER_ID no configurado en contexto para reenvío.");
        return;
      }
      const adminId = BigInt(ctx.adminUserId);

      if (senderId === adminId) { // No reenviar mensajes del propio admin
        return;
      }
      
      const user = await ctx.db.user.findUnique({ where: { id: senderId } });
      if (!user) {
        console.log(`Usuario ${senderId} envió texto pero no está registrado. No se reenvía.`);
        // await ctx.reply("Por favor, usa /start primero para registrarte."); // Opcional
        return;
      }

      // Reenviar el mensaje del usuario al admin
      await ctx.telegram.forwardMessage(ctx.adminUserId, fromUser.id, ctx.message.message_id);
      
      // Enviar notificación contextual al admin con botones inline
      let messageToAdmin = `Nuevo mensaje recibido de: ${user.firstName || 'Usuario'} (ID: ${user.id.toString()})`;
      const inlineKeyboardButtons = [];

      if (user.username) {
        messageToAdmin += `\nUsername: @${user.username}`;
        inlineKeyboardButtons.push({ text: `💬 Chat Directo (@${user.username})`, url: `https://t.me/${user.username}` });
      } else {
        messageToAdmin += `\n(El usuario no tiene un username público)`;
      }
      // Siempre agregar el botón de ver perfil por ID
      inlineKeyboardButtons.push({ text: `👤 Ver Perfil (ID: ${user.id.toString()})`, url: `tg://user?id=${user.id.toString()}` });
      
      const options: any = { // ExtraSendMessageProps
        reply_markup: {
          inline_keyboard: [inlineKeyboardButtons] // Poner botones en una sola fila
        }
      };
      
      await ctx.telegram.sendMessage(ctx.adminUserId, messageToAdmin, options);

    } catch (error) {
      console.error('Error en el manejador de texto (reenvío/respuesta admin):', error);
    }
  });
}

export function setupNewAdminResponderCommand(bot: Telegraf<MyContext>) {
  bot.command('responder', adminOnly, async (ctx) => {
    try {
      const textParts = ctx.message.text.split(' '); 
      if (textParts.length < 3) {
        return ctx.reply("Uso: /responder <ID_o_@username_Usuario> <mensaje>");
      }
      
      const targetIdentifier = textParts[1];
      const messageToUser = textParts.slice(2).join(' ');

      let targetUser: PrismaUser | null = null;

      if (targetIdentifier.startsWith('@')) {
        const username = targetIdentifier.substring(1);
        targetUser = await ctx.db.user.findFirst({ 
          where: { username: { equals: username, mode: 'insensitive' } } 
        });
      } else {
        // Intentar como ID primero
        let isNumericId = false;
        try {
          const potentialId = BigInt(targetIdentifier);
          targetUser = await ctx.db.user.findUnique({ where: { id: potentialId } });
          if (targetUser) isNumericId = true;
        } catch (e) {
          // No es un BigInt válido, o no se encontró por ID. Continuar para probar como username.
        }

        // Si no se encontró como ID numérico, o si no era un BigInt válido,
        // intentar como username (sin @ inicial) de forma case-insensitive.
        if (!targetUser && !isNumericId) {
          targetUser = await ctx.db.user.findFirst({ 
            where: { username: { equals: targetIdentifier, mode: 'insensitive' } }
          });
        }
      }

      if (!targetUser) {
        return ctx.reply(`No se encontró al usuario "${targetIdentifier}". Verifica el ID o username (prueba con @ si es username).`);
      }

      await ctx.telegram.sendMessage(Number(targetUser.id), `Respuesta del Administrador:\n\n${messageToUser}`);
      await ctx.reply(`Tu mensaje ha sido enviado a ${targetUser.username ? '@'+targetUser.username : targetUser.id.toString()}.`);

    } catch (error: any) {
      console.error('Error en /responder handler:', error);
      const targetIdentifier = ctx.message.text.split(' ')[1] || "el usuario especificado";
      if (error.response?.error_code === 400 && error.response.description?.includes("chat not found")) {
          await ctx.reply(`No se pudo enviar el mensaje. Es posible que ${targetIdentifier} haya bloqueado al bot o no exista.`);
      } else if (error.response?.error_code === 403 && error.response.description?.includes("bot was blocked by the user")) {
          await ctx.reply(`No se pudo enviar el mensaje: ${targetIdentifier} ha bloqueado al bot.`);
      } else {
          await ctx.reply('Ocurrió un error al intentar enviar el mensaje.');
      }
    }
  });
}

// Function to register all handlers
export function registerAllHandlers(bot: Telegraf<MyContext>) {
  setupStartHandler(bot);
  setupReferHandler(bot); // Includes 'invitar'
  setupMyReferralsHandler(bot); // Includes 'mis_invitados'
  setupAdminViewUsersHandler(bot); // Includes 'admin_ver_usuarios'
  setupAdminViewReferralsHandler(bot); // Includes 'admin_info_usuario'
  setupNewAdminResponderCommand(bot); // El nuevo /responder
  setupTextHandler(bot); // Este debe ir al final o tener cuidado con el orden de `on('text')` vs `command`
}

// Nota: La interfaz MyContext necesitará ser accesible globalmente,
// idealmente definida en un archivo 'src/types.ts' e importada aquí y en src/index.ts.
// interface MyContext ...
// Tambien, el middleware adminOnly puede ser pasado como argumento o definido/importado aquí.
// El botInfo (ctx.botInfo.id) es importante para la lógica de respuesta del admin.
// Telegraf lo añade al contexto si se usa `bot.launch()` o `bot.handleUpdate()`.
// El `adminOnly` middleware también se pasa como argumento para que lo usen los handlers de admin.
