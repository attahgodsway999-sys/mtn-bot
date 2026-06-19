const { v4: uuidv4 } = require('uuid');
const { Users, Transactions } = require('../db/queries');
const momo = require('../mtn/momoClient');
const { parsePayCommand, formatAmount, isValidPhone, cleanPhone } = require('../utils/helpers');

function register(bot) {
  /**
   * /pay @username 5000 [description]
   * /pay +256700000000 5000 [description]
   */
  bot.onText(/\/pay(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const sender = msg._user;

    // Must have linked phone
    if (!sender || !sender.phone_number) {
      return bot.sendMessage(chatId,
        `❌ You need to link your MTN MoMo number first.\nUse /register to get started.`
      );
    }

    const args = match[1];
    if (!args) {
      return bot.sendMessage(chatId,
        `*Usage:*\n` +
        `/pay @username 5000\n` +
        `/pay +256700000000 5000 Optional memo`,
        { parse_mode: 'Markdown' }
      );
    }

    const parsed = parsePayCommand(`/pay ${args}`);
    if (!parsed) {
      return bot.sendMessage(chatId,
        `❌ Invalid format.\nTry: /pay @username 5000 or /pay +256700000000 5000`
      );
    }

    const { target, amount, description } = parsed;
    let recipientPhone = null;
    let recipientUser = null;

    // Resolve target: @username or phone number
    if (target.startsWith('@')) {
      const username = target.slice(1);
      recipientUser = Users.findByUsername(username);
      if (!recipientUser) {
        return bot.sendMessage(chatId,
          `❌ @${username} hasn't linked their MoMo number yet.\n` +
          `Ask them to use /register first, or pay directly via phone number.`
        );
      }
      recipientPhone = recipientUser.phone_number;
    } else {
      const phone = cleanPhone(target);
      if (!isValidPhone(phone)) {
        return bot.sendMessage(chatId, `❌ Invalid phone number: ${target}`);
      }
      recipientPhone = phone;
      recipientUser = Users.findByPhone(phone);
    }

    // Confirmation message
    const recipientLabel = recipientUser
      ? `@${recipientUser.telegram_username || recipientUser.full_name} (${recipientPhone})`
      : recipientPhone;

    const confirmMsg = await bot.sendMessage(chatId,
      `💸 *Confirm payment*\n\n` +
      `To: ${recipientLabel}\n` +
      `Amount: *${formatAmount(amount)}*\n` +
      (description ? `Memo: ${description}\n` : '') +
      `\nFrom your MoMo number: \`${sender.phone_number}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirm', callback_data: `pay_confirm:${amount}:${recipientPhone}:${description || ''}` },
            { text: '❌ Cancel', callback_data: 'pay_cancel' },
          ]],
        },
      }
    );
  });

  // Handle confirm/cancel callbacks
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    if (data === 'pay_cancel') {
      await bot.answerCallbackQuery(query.id);
      return bot.editMessageText('❎ Payment cancelled.', {
        chat_id: chatId,
        message_id: query.message.message_id,
      });
    }

    if (data.startsWith('pay_confirm:')) {
      const [, amount, recipientPhone, description] = data.split(':');
      const sender = Users.find(telegramId);

      await bot.answerCallbackQuery(query.id, { text: 'Processing...' });
      await bot.editMessageText('⏳ Requesting payment from your MoMo account…', {
        chat_id: chatId,
        message_id: query.message.message_id,
      });

      const referenceId = uuidv4();
      const recipientUser = Users.findByPhone(recipientPhone);

      try {
        // Step 1: Collect from sender
        await momo.requestToPay({
          amount,
          phoneNumber: sender.phone_number,
          description: description || 'Telegram payment',
          referenceId,
        });

        Transactions.create({
          referenceId,
          type: 'payment',
          senderTelegramId: telegramId,
          recipientTelegramId: recipientUser?.telegram_id || null,
          recipientPhone,
          amount: parseFloat(amount),
          description,
        });

        await bot.sendMessage(chatId,
          `📲 A USSD prompt has been sent to *${sender.phone_number}*.\n` +
          `Please approve the payment of *${formatAmount(amount)}* on your phone.\n\n` +
          `_Checking status…_`,
          { parse_mode: 'Markdown' }
        );

        // Step 2: Poll for confirmation
        const result = await momo.pollPaymentStatus(referenceId);

        if (result.status === 'SUCCESSFUL') {
          Transactions.updateStatus(referenceId, 'successful', result.financialTransactionId);

          // Step 3: Disburse to recipient
          const disbRef = uuidv4();
          await momo.transfer({
            amount,
            phoneNumber: recipientPhone,
            description: description || 'Telegram payment',
            referenceId: disbRef,
          });

          await bot.sendMessage(chatId,
            `✅ *Payment sent!*\n\n` +
            `${formatAmount(amount)} → ${recipientPhone}\n` +
            `Ref: \`${referenceId}\``,
            { parse_mode: 'Markdown' }
          );

          // Notify recipient if they're a Telegram user
          if (recipientUser) {
            await bot.sendMessage(recipientUser.telegram_id,
              `💰 You received *${formatAmount(amount)}* from ` +
              `${sender.telegram_username ? '@' + sender.telegram_username : sender.full_name}!\n` +
              (description ? `Memo: _${description}_\n` : '') +
              `\nRef: \`${referenceId}\``,
              { parse_mode: 'Markdown' }
            ).catch(() => {}); // Don't fail if user blocked bot
          }
        } else {
          Transactions.updateStatus(referenceId, 'failed');
          await bot.sendMessage(chatId,
            `❌ *Payment failed or was not approved.*\n` +
            `${result.reason ? `Reason: ${result.reason}\n` : ''}` +
            `No money was deducted. Please try again.`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (err) {
        Transactions.updateStatus(referenceId, 'failed');
        console.error('Pay error:', err.response?.data || err.message);
        await bot.sendMessage(chatId,
          `❌ Something went wrong.\n${err.response?.data?.message || err.message}`
        );
      }
    }
  });
}

module.exports = { register };
