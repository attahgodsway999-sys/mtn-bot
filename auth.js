const { Users, Sessions } = require('../db/queries');

/**
 * Auto-registers the user in the DB on any incoming message.
 * Attaches user record and session to msg for downstream handlers.
 */
async function registerUser(bot, msg, next) {
  const { id, username, first_name, last_name } = msg.from;
  const fullName = [first_name, last_name].filter(Boolean).join(' ');

  const user = Users.upsert(id, username, fullName);
  msg._user = user;
  msg._session = Sessions.get(id);

  if (next) next();
  return user;
}

/**
 * Checks if user has a linked phone number.
 * If not, prompts them to register first.
 */
function requirePhone(bot) {
  return (msg) => {
    const user = msg._user;
    if (!user || !user.phone_number) {
      bot.sendMessage(
        msg.chat.id,
        `📱 You need to link your MTN MoMo number first.\n\nUse /register to get started.`
      );
      return false;
    }
    return true;
  };
}

module.exports = { registerUser, requirePhone };
