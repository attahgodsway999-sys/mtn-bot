const { v4: uuidv4 } = require('uuid');
const { Users, Transactions, PaymentRequests } = require('./db/queries');
const momo = require('./mtn/momoClient');
const { formatAmount, formatTx, isValidPhone, cleanPhone } = require('./utils/helpers');

function register(bot) {

  // ── /balance ────────────────────────────────────────────────────────────────
  bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg._user;

    if (!user?.phone_number) {
      return bot.sendMessage(chatId, `❌ Link your number first with /register.`);
    }

    try {
      const bal = await momo.getBalance();
      await bot.sendMessage(chatId,
        `💳 *Your MoMo Balance*\n\n` +
        `*${formatAmount(bal.availableBalance, bal.currency)}*\n` +
        `Linked number: \`${user.phone_number}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Balance error:', err.response?.data || err.message);
      await bot.sendMessage(chatId,
        `❌ Could not retrieve balance. Please try again later.`
      );
    }
  });

  // ── /history ─────────────────────────────────────────────────────────────────
  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = msg._user;

    if (!user?.phone_number) {
      return bot.sendMessage(chatId, `❌ Link your number first with /register.`);
    }

    const txs = Transactions.historyForUser(telegramId, 10);

    if (!txs.length) {
      return bot.sendMessage(chatId, `📭 No transactions yet.`);
    }

    const lines = txs.map((tx) => formatTx(tx, telegramId)).join('\n\n');

    await bot.sendMessage(chatId,
      `📜 *Recent Transactions*\n\n${lines}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /request @username amount  OR  /request +phone amount ──────────────────
  bot.onText(/\/request(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const requester = msg._user;

    if (!requester?.phone_number) {
      return bot.sendMessage(chatId, `❌ Link your number first with /register.`);
    }

    const args = match[1];
    if (!args) {
      return bot.sendMessage(chatId,
        `*Usage:*\n/request @username 5000\n/request +256700000000 5000`,
        { parse_mode: 'Markdown' }
      );
    }

    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return bot.sendMessage(chatId, `❌ Please specify a target and amount.`);
    }

    const target = parts[0];
    const amount = parseFloat(parts[1]);
    const description = parts.slice(2).join(' ') || null;

    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, `❌ Invalid amount.`);
    }

    let payerPhone = null;
    let payerUser = null;

    if (target.startsWith('@')) {
      payerUser = Users.findByUsername(target.slice(1));
      if (!payerUser?.phone_number) {
        return bot.sendMessage(chatId,
          `❌ ${target} hasn't linked their MoMo number yet.`
        );
      }
      payerPhone = payerUser.phone_number;
    } else {
      payerPhone = cleanPhone(target);
      if (!isValidPhone(payerPhone)) {
        return bot.sendMessage(chatId, `❌ Invalid phone number.`);
      }
      payerUser = Users.findByPhone(payerPhone);
    }

    const referenceId = uuidv4();

    PaymentRequests.create({
      referenceId,
      requesterTelegramId: telegramId,
      payerTelegramId: payerUser?.telegram_id || null,
      payerPhone,
      amount,
      description,
    });

    // If payer is in Telegram, send them a button
    if (payerUser) {
      await bot.sendMessage(payerUser.telegram_id,
        `💸 *Payment Request*\n\n` +
        `${requester.telegram_username ? '@' + requester.telegram_username : requester.full_name} ` +
        `is requesting *${formatAmount(amount)}* from you.\n` +
        (description ? `Memo: _${description}_\n` : '') +
        `\nApprove with your MoMo number: \`${payerPhone}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Pay now', callback_data: `req_pay:${referenceId}` },
              { text: '❌ Decline', callback_data: `req_decline:${referenceId}` },
            ]],
          },
        }
      ).catch(() => {});

      await bot.sendMessage(chatId,
        `✅ Request sent to ${target} for *${formatAmount(amount)}*.\n` +
        `They'll get a prompt to approve.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // External phone — initiate collection immediately
      await bot.sendMessage(chatId,
        `📲 Sending USSD prompt to \`${payerPhone}\`…`,
        { parse_mode: 'Markdown' }
      );

      try {
        await momo.requestToPay({
          amount,
          phoneNumber: payerPhone,
          description: description || `Payment to ${requester.phone_number}`,
          referenceId,
        });

        Transactions.create({
          referenceId,
          type: 'request',
          senderTelegramId: telegramId,
          recipientPhone: requester.phone_number,
          amount,
          description,
        });

        await bot.sendMessage(chatId,
          `✅ USSD prompt sent to \`${payerPhone}\`!\n` +
          `I'll notify you when they approve.`,
          { parse_mode: 'Markdown' }
        );

        // Poll and notify
        const result = await momo.pollPaymentStatus(referenceId);
        if (result.status === 'SUCCESSFUL') {
          PaymentRequests.updateStatus(referenceId, 'paid');
          Transactions.updateStatus(referenceId, 'successful', result.financialTransactionId);
          await bot.sendMessage(chatId,
            `💰 *Payment received!* ${formatAmount(amount)} from \`${payerPhone}\`.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          PaymentRequests.updateStatus(referenceId, 'declined');
          await bot.sendMessage(chatId,
            `❌ Payment from \`${payerPhone}\` was not completed.`
          );
        }
      } catch (err) {
        console.error('Request error:', err.response?.data || err.message);
        await bot.sendMessage(chatId, `❌ Error: ${err.response?.data?.message || err.message}`);
      }
    }
  });

  // Handle request pay/decline callbacks
  bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;

    if (data.startsWith('req_decline:')) {
      const referenceId = data.split(':')[1];
      const req = PaymentRequests.find(referenceId);
      PaymentRequests.updateStatus(referenceId, 'declined');
      await bot.answerCallbackQuery(query.id, { text: 'Declined.' });
      await bot.editMessageText('❌ You declined this payment request.', {
        chat_id: chatId, message_id: query.message.message_id,
      });
      // Notify requester
      if (req) {
        const payer = Users.find(telegramId);
        await bot.sendMessage(req.requester_telegram_id,
          `❌ Your payment request was declined by ${payer?.telegram_username ? '@' + payer.telegram_username : 'the recipient'}.`
        ).catch(() => {});
      }
    }

    if (data.startsWith('req_pay:')) {
      const referenceId = data.split(':')[1];
      const req = PaymentRequests.find(referenceId);
      if (!req) return bot.answerCallbackQuery(query.id, { text: 'Request not found.' });

      const payer = Users.find(telegramId);
      if (!payer?.phone_number) {
        return bot.answerCallbackQuery(query.id, { text: 'Link your MoMo number first (/register).' });
      }

      await bot.answerCallbackQuery(query.id, { text: 'Sending USSD prompt...' });
      await bot.editMessageText('📲 Check your phone for the USSD payment prompt…', {
        chat_id: chatId, message_id: query.message.message_id,
      });

      try {
        await momo.requestToPay({
          amount: req.amount,
          phoneNumber: payer.phone_number,
          description: req.description || 'Telegram payment request',
          referenceId,
        });

        Transactions.create({
          referenceId,
          type: 'request',
          senderTelegramId: req.requester_telegram_id,
          recipientTelegramId: telegramId,
          recipientPhone: req.payer_phone,
          amount: req.amount,
          description: req.description,
        });

        const result = await momo.pollPaymentStatus(referenceId);

        if (result.status === 'SUCCESSFUL') {
          PaymentRequests.updateStatus(referenceId, 'paid');
          Transactions.updateStatus(referenceId, 'successful', result.financialTransactionId);

          await bot.sendMessage(chatId,
            `✅ *Paid!* ${formatAmount(req.amount, req.currency)} sent successfully.`,
            { parse_mode: 'Markdown' }
          );
          await bot.sendMessage(req.requester_telegram_id,
            `💰 *Payment received!*\n${formatAmount(req.amount, req.currency)} from ${payer.telegram_username ? '@' + payer.telegram_username : payer.full_name}.`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        } else {
          await bot.sendMessage(chatId, `❌ Payment not completed. ${result.reason || ''}`);
        }
      } catch (err) {
        console.error('req_pay error:', err.response?.data || err.message);
        await bot.sendMessage(chatId, `❌ Error: ${err.response?.data?.message || err.message}`);
      }
    }
  });
}

module.exports = { register };
