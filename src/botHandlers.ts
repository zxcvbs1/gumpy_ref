import { Telegraf } from 'telegraf';
import { Update, User as TelegramUser } from 'telegraf/typings/core/types/typegram'; // Aliasing to avoid conflict with PrismaUser
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

      // Auto-delete previous message if applicable
      const messageContext = "welcome";
      if (process.env.MESSAGE_AUTO_DELETE_ENABLED === 'true' && user.lastBotMessageIdInPrivateChat && user.lastBotMessageContext === messageContext) {
        try {
          await ctx.telegram.deleteMessage(Number(user.id), user.lastBotMessageIdInPrivateChat);
        } catch (e:any) {
          if (e.response?.error_code !== 400) { // Ignore "message to delete not found"
             console.warn(`Could not delete previous message ${user.lastBotMessageIdInPrivateChat} for user ${user.id}: ${e.message}`);
          }
        }
      }

      const sentMessage = await ctx.reply(message);
      await ctx.db.user.update({
        where: { id: user.id },
        data: {
          lastBotMessageIdInPrivateChat: sentMessage.message_id,
          lastBotMessageContext: messageContext
        },
      });

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

      const messageContext = "referral_link";
      // Auto-delete previous message if applicable
      if (process.env.MESSAGE_AUTO_DELETE_ENABLED === 'true' && user.lastBotMessageIdInPrivateChat && user.lastBotMessageContext === messageContext) {
        try {
          // We are in the user's private chat with the bot here.
          await ctx.telegram.deleteMessage(ctx.chat.id, user.lastBotMessageIdInPrivateChat);
        } catch (e:any) {
           if (e.response?.error_code !== 400) { // Ignore "message to delete not found"
            console.warn(`Could not delete previous referral link message ${user.lastBotMessageIdInPrivateChat} for user ${user.id}: ${e.message}`);
           }
        }
      }

      const sentMessage = await ctx.reply(messageToForward);
      // Store the new message_id
      await ctx.db.user.update({
        where: { id: user.id },
        data: {
          lastBotMessageIdInPrivateChat: sentMessage.message_id,
          lastBotMessageContext: messageContext
        },
      });

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
  // Primary: /usuarios, Alias: /ver_usuarios, Legacy: /admin_view_users, /admin_ver_usuarios
  bot.command(['usuarios', 'ver_usuarios', 'admin_view_users', 'admin_ver_usuarios'], adminOnly, async (ctx) => {
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

// Helper function to get user display name
const getUserDisplayName = (user: { firstName?: string | null; username?: string | null; id: bigint }): string => {
  return user.firstName || user.username || `ID ${user.id.toString()}`;
};

export function setupAdminViewReferralsHandler(bot: Telegraf<MyContext>) {
  // Primary: /info_usuario, Alias: /ver_referidos, Legacy: /admin_info_usuario, /admin_view_referrals
  bot.command(['info_usuario', 'ver_referidos', 'admin_info_usuario', 'admin_view_referrals'], adminOnly, async (ctx) => {
    try {
      const textParts = ctx.message.text.split(' ');
      if (textParts.length < 2) {
        // Ensure usage message uses the primary command
        return ctx.reply("Por favor, proporciona un ID de Usuario o @username. Uso: /info_usuario <ID_o_@USERNAME>");
      }
      const targetIdentifier = textParts[1];

      type UserWithReferrer = Prisma.UserGetPayload<{
        include: {
          referredBy: {
            select: {
              id: true,
              firstName: true,
              username: true,
              // Include referredBy for recursive fetching
              referredBy: { // Select details of the referrer's referrer
                select: {
                  id: true,
                  firstName: true,
                  username: true // username of the second-level referrer
                }
              }
            }
          },
          referralsGiven: {
            select: { id: true, firstName: true, username: true, createdAt: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      }>;

      let targetUser: PrismaUser | null = null;

      if (targetIdentifier.startsWith('@')) {
        const usernameToSearch = targetIdentifier.substring(1);
        targetUser = await ctx.db.user.findFirst({
          where: { username: usernameToSearch }
        });
      } else {
        try {
          const potentialId = BigInt(targetIdentifier);
          targetUser = await ctx.db.user.findUnique({
            where: { id: potentialId }
          });
        } catch (e) {
          targetUser = await ctx.db.user.findFirst({
            where: { username: targetIdentifier }
          });
        }
      }

      if (!targetUser) {
        return ctx.reply(`Usuario "${targetIdentifier}" no encontrado.`);
      }

      // Fetch the full user details with referralsGiven and the first referrer
      const fullTargetUser = await ctx.db.user.findUnique({
        where: { id: targetUser.id },
        include: {
          referredBy: true, // Fetch the direct referrer
          referralsGiven: {
            select: { id: true, firstName: true, username: true, createdAt: true },
            orderBy: { createdAt: 'asc' }
          }
        }
      });

      if (!fullTargetUser) { // Should not happen if targetUser was found, but good practice
        return ctx.reply(`Usuario "${targetIdentifier}" no encontrado (error secundario).`);
      }
      
      const userNameDisplay = getUserDisplayName(fullTargetUser);
      const userUsernameInfo = fullTargetUser.username ? `@${fullTargetUser.username}` : 'N/A';
      let message = `Detalles del usuario: ${userNameDisplay} (ID: ${fullTargetUser.id.toString()}, Username: ${userUsernameInfo})\n\n`;

      // Build referral chain
      let referralChainString = "";
      let currentUserInChain = fullTargetUser;
      const chainParts: string[] = [];
      let depth = 0;
      const MAX_DEPTH = 10; // Safety break for very long or circular chains

      while (currentUserInChain.referredById && depth < MAX_DEPTH) {
        const referrer = await ctx.db.user.findUnique({
          where: { id: currentUserInChain.referredById },
          include: {
            referredBy: true, // Fetch the next referrer in the chain
            referralsGiven: { // Match the structure of currentUserInChain
              select: { id: true, firstName: true, username: true, createdAt: true },
              orderBy: { createdAt: 'asc' }
            }
          }
        });

        if (referrer) {
          if (chainParts.length === 0) { // First link in chain
            chainParts.push(`${getUserDisplayName(currentUserInChain)} fue invitado/a por ${getUserDisplayName(referrer)}`);
          } else {
            chainParts.push(`quien fue invitado/a por ${getUserDisplayName(referrer)}`);
          }
          currentUserInChain = referrer;
        } else {
          // Referrer not found, break chain
          chainParts.push(`quien fue invitado/a por un usuario desconocido (ID: ${currentUserInChain.referredById})`);
          break;
        }
        depth++;
      }
      if (depth === MAX_DEPTH) {
        chainParts.push("... (cadena de referidos muy larga)");
      }

      if (chainParts.length > 0) {
        referralChainString = chainParts.join(", ");
        message += `Cadena de Referidos: ${referralChainString}.\n`;
      } else {
        message += "Invitado por: Nadie (o es el inicio de una cadena).\n";
      }

      message += "\nUsuarios que ha invitado:\n";
      if (fullTargetUser.referralsGiven && fullTargetUser.referralsGiven.length > 0) {
        fullTargetUser.referralsGiven.forEach(referred => {
          message += `- ${getUserDisplayName(referred)} (ID: ${referred.id.toString()}, Username: ${referred.username ? '@'+referred.username : 'N/A'}, Se unió: ${referred.createdAt.toLocaleDateString()})\n`;
        });
      } else {
        message += "- Ninguno\n";
      }

      await ctx.reply(message);

    } catch (error) {
      console.error('Error en /info_usuario:', error);
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
          'forward_from' in repliedToMessage && repliedToMessage.forward_from && // Check existence of the User object
          'forward_from_message_id' in repliedToMessage && typeof repliedToMessage.forward_from_message_id === 'number' // Check existence and type of the message ID
        ) {
          // Explicitly type originalSender and originalMessageIdInUserChat
          // Telegraf's User type is imported as TelegramUser.
          // Assert the type of repliedToMessage.forward_from after checks.
          const originalSender = repliedToMessage.forward_from as TelegramUser;
          const originalMessageIdInUserChat: number = repliedToMessage.forward_from_message_id;
          const adminResponseText = text;

          try {
            // originalSender.id is now guaranteed to be a number
            // originalSender.username is string | undefined
            // originalMessageIdInUserChat is now guaranteed to be a number
            await ctx.telegram.sendMessage(originalSender.id, `Respuesta del Administrador:\n\n${adminResponseText}`, {
              reply_parameters: { message_id: originalMessageIdInUserChat }
            });
            await ctx.reply(`Respuesta enviada a ${originalSender.username ? '@' + originalSender.username : 'ID: ' + String(originalSender.id)} (citando su mensaje).`);
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

      const messageContext = "admin_reply";
      // Auto-delete previous admin_reply if feature enabled
      // Note: This deletes the *previous admin reply* to this user, not the user's message.
      if (process.env.MESSAGE_AUTO_DELETE_ENABLED === 'true' && targetUser.lastBotMessageIdInPrivateChat && targetUser.lastBotMessageContext === messageContext) {
        try {
          await ctx.telegram.deleteMessage(Number(targetUser.id), targetUser.lastBotMessageIdInPrivateChat);
        } catch (e:any) {
          if (e.response?.error_code !== 400) {
            console.warn(`Could not delete previous admin reply ${targetUser.lastBotMessageIdInPrivateChat} for user ${targetUser.id}: ${e.message}`);
          }
        }
      }

      const sentMessage = await ctx.telegram.sendMessage(Number(targetUser.id), `Respuesta del Administrador:\n\n${messageToUser}`);
      await ctx.db.user.update({
        where: { id: targetUser.id },
        data: {
          lastBotMessageIdInPrivateChat: sentMessage.message_id,
          lastBotMessageContext: messageContext,
        }
      });
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
  setupAdminDeleteLastBotMessageHandler(bot); // New command
  setupHelpHandler(bot); // New help command
  setupTextHandler(bot); // Este debe ir al final o tener cuidado con el orden de `on('text')` vs `command`
}

export function setupHelpHandler(bot: Telegraf<MyContext>) {
  bot.command(['ayuda', 'help'], async (ctx) => {
    let message = "👋 ¡Hola! Aquí tienes una lista de los comandos disponibles:\n\n";

    message += "🤖 **Comandos para todos los usuarios:**\n";
    message += "/start - Inicia el bot y te registra.\n";
    message += "/invitar - Obtiene tu enlace personal de invitación.\n";
    message += "/mis_invitados - Muestra los usuarios que has invitado directamente.\n";
    message += "/ayuda - Muestra este mensaje de ayuda.\n";

    if (ctx.from && ctx.adminUserId && BigInt(ctx.from.id) === BigInt(ctx.adminUserId)) {
      message += "\n👑 **Comandos de Administrador:**\n";
      message += "/usuarios - Muestra todos los usuarios registrados.\n";
      message += "/info_usuario <ID o @username> - Muestra información detallada de un usuario, incluyendo su cadena de referidos completa.\n";
      message += "/responder <ID o @username> <mensaje> - Envía un mensaje directo a un usuario desde el bot.\n";
      message += "/borrar_mensaje_bot <ID o @username> - Intenta borrar el último mensaje relevante (bienvenida, enlace de invitación, respuesta de admin) enviado por el bot a un usuario.\n";
    }

    try {
      await ctx.reply(message);
    } catch (error) {
      console.error("Error al enviar mensaje de ayuda:", error);
      // Optionally, notify user if reply fails, though it's rare for /help itself.
    }
  });
}

export function setupAdminDeleteLastBotMessageHandler(bot: Telegraf<MyContext>) {
  // Primary: /borrar_mensaje_bot (kept this one as it's specific enough)
  // Aliases: /borrar_ultimo_mensaje_bot, /admin_borrar_ultimo_mensaje
  bot.command(['borrar_mensaje_bot', 'borrar_ultimo_mensaje_bot', 'admin_borrar_ultimo_mensaje'], adminOnly, async (ctx) => {
    try {
      const textParts = ctx.message.text.split(' ');
      if (textParts.length < 2) {
        // Ensure usage message uses the primary command
        return ctx.reply("Por favor, proporciona un ID de Usuario o @username. Uso: /borrar_mensaje_bot <ID_o_@USERNAME>");
      }
      const targetIdentifier = textParts[1];

      let targetUser: PrismaUser | null = null;

      if (targetIdentifier.startsWith('@')) {
        const usernameToSearch = targetIdentifier.substring(1);
        targetUser = await ctx.db.user.findFirst({ where: { username: usernameToSearch } });
      } else {
        try {
          const potentialId = BigInt(targetIdentifier);
          targetUser = await ctx.db.user.findUnique({ where: { id: potentialId } });
        } catch (e) {
          targetUser = await ctx.db.user.findFirst({ where: { username: targetIdentifier } });
        }
      }

      if (!targetUser) {
        return ctx.reply(`Usuario "${targetIdentifier}" no encontrado.`);
      }

      if (!targetUser.lastBotMessageIdInPrivateChat) {
        return ctx.reply(`No hay registro del último mensaje enviado por el bot a ${getUserDisplayName(targetUser)}.`);
      }

      try {
        await ctx.telegram.deleteMessage(Number(targetUser.id), targetUser.lastBotMessageIdInPrivateChat);
        await ctx.db.user.update({
          where: { id: targetUser.id },
          data: {
            lastBotMessageIdInPrivateChat: null,
            lastBotMessageContext: null,
          },
        });
        await ctx.reply(`Último mensaje del bot enviado a ${getUserDisplayName(targetUser)} (ID: ${targetUser.lastBotMessageIdInPrivateChat}) ha sido borrado.`);
      } catch (e: any) {
        if (e.response?.error_code === 400 && e.response.description?.includes("message to delete not found")) {
          await ctx.reply(`El mensaje (ID: ${targetUser.lastBotMessageIdInPrivateChat}) ya no existe o no pudo ser borrado. Se limpiará el registro.`);
          await ctx.db.user.update({
            where: { id: targetUser.id },
            data: {
              lastBotMessageIdInPrivateChat: null,
              lastBotMessageContext: null,
            },
          });
        } else {
          console.error(`Error borrando mensaje ${targetUser.lastBotMessageIdInPrivateChat} para usuario ${targetUser.id}:`, e);
          await ctx.reply(`Error al intentar borrar el mensaje: ${e.message}`);
        }
      }
    } catch (error) {
      console.error('Error en /borrar_ultimo_mensaje_bot:', error);
      if (error instanceof TypeError && error.message.includes("Cannot convert")) {
        await ctx.reply("Formato de ID inválido. Por favor, proporciona un ID numérico o un @username.");
      } else {
        await ctx.reply('Ocurrió un error procesando el comando.');
      }
    }
  });
}

// Nota: La interfaz MyContext necesitará ser accesible globalmente,
// idealmente definida en un archivo 'src/types.ts' e importada aquí y en src/index.ts.
// interface MyContext ...
// Tambien, el middleware adminOnly puede ser pasado como argumento o definido/importado aquí.
// El botInfo (ctx.botInfo.id) es importante para la lógica de respuesta del admin.
// Telegraf lo añade al contexto si se usa `bot.launch()` o `bot.handleUpdate()`.
// El `adminOnly` middleware también se pasa como argumento para que lo usen los handlers de admin.
