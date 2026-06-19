const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const ENVIRONMENT = process.env.MOMO_TARGET_ENVIRONMENT || 'sandbox';
const CURRENCY = process.env.MOMO_CURRENCY || 'EUR';

// ── Token management ──────────────────────────────────────────────────────────

const tokenCache = {};

async function getAccessToken(product) {
  const cached = tokenCache[product];
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const userId = product === 'collections'
    ? process.env.MOMO_COLLECTIONS_USER_ID
    : process.env.MOMO_DISBURSEMENTS_USER_ID;

  const apiKey = product === 'collections'
    ? process.env.MOMO_COLLECTIONS_API_KEY
    : process.env.MOMO_DISBURSEMENTS_API_KEY;

  const primaryKey = product === 'collections'
    ? process.env.MOMO_COLLECTIONS_PRIMARY_KEY
    : process.env.MOMO_DISBURSEMENTS_PRIMARY_KEY;

  const credentials = Buffer.from(`${userId}:${apiKey}`).toString('base64');

  const res = await axios.post(
    `${BASE_URL}/${product}/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': primaryKey,
      },
    }
  );

  tokenCache[product] = {
    token: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
  };

  return tokenCache[product].token;
}

// ── Collections (Request to Pay) ──────────────────────────────────────────────

/**
 * Initiates a request-to-pay from a mobile money number.
 * The subscriber will receive a USSD prompt to approve.
 * @returns {string} referenceId — the UUID used to check status later
 */
async function requestToPay({ amount, phoneNumber, description, referenceId }) {
  const token = await getAccessToken('collections');
  const ref = referenceId || uuidv4();

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount: String(amount),
      currency: CURRENCY,
      externalId: ref,
      payer: {
        partyIdType: 'MSISDN',
        partyId: normalizePhone(phoneNumber),
      },
      payerMessage: description || 'Payment via Telegram',
      payeeNote: description || 'Telegram MoMo Bot',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': ref,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_COLLECTIONS_PRIMARY_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  return ref;
}

/**
 * Checks the status of a request-to-pay.
 * @returns {{ status: 'PENDING'|'SUCCESSFUL'|'FAILED', financialTransactionId?: string }}
 */
async function getPaymentStatus(referenceId) {
  const token = await getAccessToken('collections');

  const res = await axios.get(
    `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_COLLECTIONS_PRIMARY_KEY,
      },
    }
  );

  return {
    status: res.data.status,           // PENDING | SUCCESSFUL | FAILED
    financialTransactionId: res.data.financialTransactionId,
    reason: res.data.reason,
  };
}

// ── Disbursements (Transfer / Pay Out) ───────────────────────────────────────

/**
 * Transfers money to a mobile money number.
 * @returns {string} referenceId
 */
async function transfer({ amount, phoneNumber, description, referenceId }) {
  const token = await getAccessToken('disbursements');
  const ref = referenceId || uuidv4();

  await axios.post(
    `${BASE_URL}/disbursement/v1_0/transfer`,
    {
      amount: String(amount),
      currency: CURRENCY,
      externalId: ref,
      payee: {
        partyIdType: 'MSISDN',
        partyId: normalizePhone(phoneNumber),
      },
      payerMessage: description || 'Transfer via Telegram',
      payeeNote: description || 'Telegram MoMo Bot',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': ref,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_DISBURSEMENTS_PRIMARY_KEY,
        'Content-Type': 'application/json',
      },
    }
  );

  return ref;
}

/**
 * Checks the status of a disbursement transfer.
 */
async function getTransferStatus(referenceId) {
  const token = await getAccessToken('disbursements');

  const res = await axios.get(
    `${BASE_URL}/disbursement/v1_0/transfer/${referenceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_DISBURSEMENTS_PRIMARY_KEY,
      },
    }
  );

  return {
    status: res.data.status,
    financialTransactionId: res.data.financialTransactionId,
    reason: res.data.reason,
  };
}

/**
 * Get account balance (Collections wallet)
 */
async function getBalance() {
  const token = await getAccessToken('collections');

  const res = await axios.get(
    `${BASE_URL}/collection/v1_0/account/balance`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': ENVIRONMENT,
        'Ocp-Apim-Subscription-Key': process.env.MOMO_COLLECTIONS_PRIMARY_KEY,
      },
    }
  );

  return res.data; // { availableBalance, currency }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalizes phone number to MSISDN format (no + or leading zeros).
 * e.g. +256700000000 → 256700000000
 */
function normalizePhone(phone) {
  return phone.replace(/^\+/, '').replace(/^0/, '256');
}

/**
 * Polls payment status until SUCCESSFUL or FAILED (max ~2 min).
 */
async function pollPaymentStatus(referenceId, intervalMs = 5000, maxAttempts = 24) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    const result = await getPaymentStatus(referenceId);
    if (result.status !== 'PENDING') return result;
  }
  return { status: 'FAILED', reason: 'Timeout' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  requestToPay,
  getPaymentStatus,
  transfer,
  getTransferStatus,
  getBalance,
  pollPaymentStatus,
  normalizePhone,
};
