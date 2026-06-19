const { Users, Channels, Transactions } = require('../db/queries');
const { v4: uuidv4 } = require('uuid');
const momo = require('../mtn/momoClient');
const { formatAmount } = require('../utils/helpers');

function register(bot) {

  // /connect — must be run in a channel or as a channel admin
  bot.onText(/\/connect/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = msg._user;

    if (!user?.phone_number) {
      return bot.sendMessage(chatId,
        `❌ You need to link your MoMo number first.\nUse /register in a private chat with me.`
      );
    }

    await bot.sendMessage(chatId,
      `📢 *Channel Payment Integration*\n\n` +
      `To add payment buttons to your Telegram channel:\n\n` +
      `1️⃣ Add me (@${process.env.BOT_USERNAME}) as an *admin* of your channel\n` +
      `2️⃣ Forward any message from your channel here\n` +
      `   OR send your channel username: \`@yourchannel\`\n\n` +
      `Payments will go to your linked number: \`${user.phone_number}\`\n\n` +
      `_Send your channel username now to proceed._`,
      { parse_mode: 'Markdown' }
    );

    // Listen for channel username
    const listener = async (reply) => {
      if (reply.from.id !== telegramId) return;
      const text = reply.text?.trim();
      if (!text || text.startsWith('/')) return;

      let channelUsername = text.startsWith('@') ? text : `@${text}`;

      try {
        // Verify bot is admin of channel
        const chat = await bot.getChat(channelUsername);
        const admins = await bot.getChatAdministrators(chat.id);
        const isAdmin = admins.some((a) => a.user.id === telegramId);
        const botIsAdmin = admins.some((a) => a.user.is_bot && a.user.username === process.env.BOT_USERNAME);

        if (!isAdmin) {
          await bot.sendMessage(chatId, `❌ You are not an admin of ${channelUsername}.`);
          return;
        }

        if (!botIsAdmin) {
          await bot.sendMessage(chatId,
            `❌ I'm not an admin of ${channelUsername} yet.\n` +
            `Please add @${process.env.BOT_USERNAME} as an admin first, then try again.`
          );
          return;
        }

        Channels.create(String(chat.id), chat.title || channelUsername, telegramId, user.phone_number);

        await bot.sendMessage(chatId,
          `✅ *${chat.title || channelUsername} is now connected!*\n\n` +
          `Payments from this channel go to: \`${user.phone_number}\`\n\n` +
          `*How to add a payment button to a post:*\n` +
          `When posting, send the message here first with:\n` +
          `/post ${channelUsername} 5000 Your premium content description\n\n` +
          `I'll post it to your channel with a "Pay to Access" button.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        await bot.sendMessage(chatId, `❌ Could not find channel: ${channelUsername}\nMake sure I'm an admin.`);
      }

      bot.removeListener('message', listener);
    };

    bot.on('message', listener);
  });

  // /post @channel amount description — admin posts a paywall message to their channel
  bot.onText(/\/post(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = msg._user;

    if (!user?.phone_number) {
      return bot.sendMessage(chatId, `❌ Link your number first with /register.`);
    }

    const args = match[1];
    if (!args) {
      return bot.sendMessage(chatId,
        `*Usage:*\n/post @channel 5000 Your premium content title\n\n` +
        `This posts a paywall message to your connected channel.`,
        { parse_mode: 'Markdown' }
      );
    }

    const parts = args.trim().split(/\s+/);
    if (parts.length < 3) {
      return bot.sendMessage(chatId, `❌ Please include channel, amount, and description.`);
    }

    const channelUsername = parts[0].startsWith('@') ? parts[0] : `@${parts[0]}`;
    const amount = parseFloat(parts[1]);
    const description = parts.slice(2).join(' ');

    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, `❌ Invalid amount.`);
    }

    try {
      const chat = await bot.getChat(channelUsername);
      const channel = Channels.find(String(chat.id));

      if (!channel) {
        return bot.sendMessage(chatId, `❌ Channel not connected. Use /connect first.`);
      }

      if (String(channel.admin_telegram_id) !== String(telegramId)) {
        return bot.sendMessage(chatId, `❌ You are not the admin of this connected channel.`);
      }

      // Post to channel with payment button
      await bot.sendMessage(chat.id,
        `🔒 *Premium Content*\n\n` +
        `${description}\n\n` +
        `💰 Price: *${formatAmount(amount)}*\n\n` +
        `_Tap below to pay and get access_`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: `💳 Pay ${formatAmount(amount)}`,
                url: `https://t.me/${process.env.BOT_USERNAME}?start=pay_channel_${chat.id}_${amount}`,
              },
            ]],
          },
        }
      );

      await bot.sendMessage(chatId, `✅ Posted to ${channelUsername}!`);

    } catch (err) {
      console.error('Post error:', err.message);
      await bot.sendMessage(chatId, `❌ Error posting to channel: ${err.message}`);
    }
  });

  // Handle deep-link: /start pay_channel_{channelId}_{amount}
  // (registered in start.js but payment flow handled here via the pay callback)
  bot.onText(/\/start pay_channel_(-?\d+)_(\d+(?:\.\d+)?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = msg._user;

    const channelId = match[1];
    const amount = parseFloat(match[2]);
    const channel = Channels.find(channelId);

    if (!channel) {
      return bot.sendMessage(chatId, `❌ This payment link is no longer valid.`);
    }

    if (!user?.phone_number) {
      return bot.sendMessage(chatId,
        `❌ You need to link your MoMo number to pay.\n/register`
      );
    }

    await bot.sendMessage(chatId,
      `💳 *Channel Payment*\n\n` +
      `Channel: ${channel.channel_name}\n` +
      `Amount: *${formatAmount(amount)}*\n` +
      `Your number: \`${user.phone_number}\`\n\n` +
      `Confirm to send a USSD prompt to your phone.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Pay now', callback_data: `chan_pay:${channelId}:${amount}` },
            { text: '❌ Cancel', callback_data: 'pay_cancel' },
          ]],
        },
      }
    );
  });

  // chan_pay callback
  bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('chan_pay:')) return;

    const [, channelId, amount] = query.data.split(':');
    const telegramId = query.from.id;
    const chatId = query.message.chat.id;
    const payer = Users.find(telegramId);
    const channel = Channels.find(channelId);

    if (!payer?.phone_number) {
      return bot.answerCallbackQuery(query.id, { text: 'Link your MoMo number first.' });
    }

    await bot.answerCallbackQuery(query.id, { text: 'Check your phone for USSD prompt...' });
    await bot.editMessageText('📲 Sending USSD prompt to your phone…', {
      chat_id: chatId, message_id: query.message.message_id,
    });

    const referenceId = uuidv4();

    try {
      await momo.requestToPay({
        amount,
        phoneNumber: payer.phone_number,
        description: `Payment to ${channel.channel_name}`,
        referenceId,
      });

      Transactions.create({
        referenceId,
        type: 'channel_payment',
        senderTelegramId: telegramId,
        recipientPhone: channel.admin_phone_number,
        amount: parseFloat(amount),
        channelId,
      });

      const result = await momo.pollPaymentStatus(referenceId);

      if (result.status === 'SUCCESSFUL') {
        Transactions.updateStatus(referenceId, 'successful', result.financialTransactionId);

        // Disburse to channel admin
        const disbRef = uuidv4();
        await momo.transfer({
          amount,
          phoneNumber: channel.admin_phone_number,
          description: `Channel payment from ${payer.phone_number}`,
          referenceId: disbRef,
        });

        await bot.sendMessage(chatId,
          `✅ *Payment successful!*\n\n` +
          `You paid ${formatAmount(amount)} to *${channel.channel_name}*.\n` +
          `Ref: \`${referenceId}\``,
          { parse_mode: 'Markdown' }
        );

        // Notify channel admin
        await bot.sendMessage(channel.admin_telegram_id,
          `💰 New channel payment!\n` +
          `${formatAmount(amount)} from ${payer.telegram_username ? '@' + payer.telegram_username : payer.full_name}\n` +
          `Ref: \`${referenceId}\``,
          { parse_mode: 'Markdown' }
        ).catch(() => {});

      } else {
        Transactions.updateStatus(referenceId, 'failed');
        await bot.sendMessage(chatId, `❌ Payment failed or was not approved. Try again.`);
      }
    } catch (err) {
      console.error('chan_pay error:', err.response?.data || err.message);
      await bot.sendMessage(chatId, `❌ Error: ${err.response?.data?.message || err.message}`);
    }
  });
}

module.exports = { register };
