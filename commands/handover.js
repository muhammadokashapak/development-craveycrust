import { unmuteChat, getActiveHandoverMutes, muteChatForHandover } from '../src/services/handoverService.js';

export default {
    name: 'handover',
    description: 'Manage human handover and muted customer chats',
    usage: '.unmute <phone> | .mutes | .mute <phone> [mins]',
    category: 'Admin',
    aliases: ['unmute', 'mutes', 'mute'],

    async execute(sock, msg, args) {
        const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
        const firstWord = text.split(/\s+/)[0].replace('.', '').toLowerCase();

        if (firstWord === 'mutes') {
            const list = getActiveHandoverMutes();
            if (list.length === 0) {
                return sock.sendMessage(msg.key.remoteJid, { text: 'Koi bhi customer chat currently mute nahi hai.' });
            }
            let reply = `Active Handover Mutes (${list.length}):\n\n`;
            for (const item of list) {
                reply += `- ${item.phone || item.chatId}: ${item.remainingMinutes}m remaining (${item.reason})\n`;
            }
            return sock.sendMessage(msg.key.remoteJid, { text: reply.trim() });
        }

        if (firstWord === 'unmute') {
            const target = args[0] || msg.key.remoteJid;
            const res = unmuteChat(target);
            return sock.sendMessage(msg.key.remoteJid, {
                text: res.removed 
                    ? `Customer ${target} ko unmute kar diya gaya hai. Ab AI bot normal respond karega.`
                    : `Customer ${target} mute list mein nahi mila ya pehle se unmuted hai.`
            });
        }

        if (firstWord === 'mute') {
            const target = args[0];
            const mins = parseInt(args[1] || '120', 10);
            if (!target) {
                return sock.sendMessage(msg.key.remoteJid, { text: 'Usage: .mute <customer phone/jid> [minutes]' });
            }
            await muteChatForHandover({ chatId: target, durationMinutes: mins, reason: 'Manually muted by admin' });
            return sock.sendMessage(msg.key.remoteJid, {
                text: `Customer ${target} ko ${mins} minutes ke liye mute kar diya gaya hai. Bot is chat par reply nahi karega.`
            });
        }

        return sock.sendMessage(msg.key.remoteJid, {
            text: `Handover Commands:\n.mutes - List all active muted chats\n.unmute <phone> - Unmute a chat\n.mute <phone> [mins] - Manually mute a chat`
        });
    },
};
