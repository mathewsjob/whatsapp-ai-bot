const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const store = require('./store');
const { generateReply, generateStarter } = require('./ai');
const { extractAndUpdateProfile } = require('./extractor');
const { scheduleContact } = require('./scheduler');

let sock = null;
let broadcast = () => {};
const messageBuffers = new Map();
const bufferTimers = new Map();
const gapTimers = new Map();
const takeoverSet = new Set();
const draftQueue = new Map();

const BRB_PHRASES = [
  'one sec yaar', 'brb', 'give me a min', 'hold on na', 'just a sec'
];

function setBroadcast(fn) { broadcast = fn; }
function getDraftQueue() { return draftQueue; }
function getTakeover() { return takeoverSet; }
function getSock() { return sock; }

async function sendMessage(phone, text) {
  if (!sock) throw new Error('Bot not connected');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
  store.addMessage(phone, 'me', text);
  broadcast({ type: 'message', phone, role: 'me', text, ts: Date.now() });
  resetGapTimer(phone);
}

function resetGapTimer(phone) {
  if (gapTimers.has(phone)) clearTimeout(gapTimers.get(phone));
  const profile = store.getProfile(phone);
  if (!profile || !profile.gapDetector) return;
  const rel = profile.relationship || 'friend';
  const hours = profile.gapHours || (rel.includes('lover') || rel.includes('girl') || rel.includes('partner') || rel.includes('wife') ? 3 : 6);
  const ms = hours * 60 * 60 * 1000;
  const t = setTimeout(async () => {
    try {
      const chat = store.getChat(phone);
      const msg = await generateStarter(profile, chat);
      await sendMessage(phone, msg);
    } catch (e) { console.error('Gap detector error:', e.message); }
  }, ms);
  gapTimers.set(phone, t);
}

function handleIncoming(phone, text) {
  const profile = store.getProfile(phone);
  if (!profile) return;

  // Check bot suspicion
  const suspicionWords = ['are you a bot', 'is this a bot', 'are you real', 'ai?', 'talking to ai', 'automated'];
  if (suspicionWords.some(w => text.toLowerCase().includes(w))) {
    broadcast({ type: 'alert', phone, message: `⚠️ ${profile.name || phone} might suspect a bot: "${text}"` });
  }

  if (!messageBuffers.has(phone)) messageBuffers.set(phone, []);
  messageBuffers.get(phone).push(text);

  if (bufferTimers.has(phone)) clearTimeout(bufferTimers.get(phone));
  const t = setTimeout(() => processBuffer(phone), 4000);
  bufferTimers.set(phone, t);
}

async function processBuffer(phone) {
  const msgs = messageBuffers.get(phone) || [];
  messageBuffers.delete(phone);
  bufferTimers.delete(phone);
  if (!msgs.length) return;

  const profile = store.getProfile(phone);
  if (!profile) return;

  if (takeoverSet.has(phone)) return;

  const chat = store.getChat(phone);

  const delay = Math.floor(Math.random() * 80 + 10) * 1000;

  if (delay > 60000) {
    const brb = BRB_PHRASES[Math.floor(Math.random() * BRB_PHRASES.length)];
    await sendMessage(phone, brb);
  }

  try {
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await sock.sendPresenceUpdate('composing', jid);
  } catch (_) {}

  const reply = await generateReply(profile, chat, msgs);

  await new Promise(r => setTimeout(r, delay));

  try {
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await sock.sendPresenceUpdate('paused', jid);
  } catch (_) {}

  if (profile.draftReview) {
    if (!draftQueue.has(phone)) draftQueue.set(phone, []);
    draftQueue.get(phone).push(reply);
    broadcast({ type: 'draft', phone, draft: reply });
    return;
  }

  await sendMessage(phone, reply);
  resetGapTimer(phone);
  extractAndUpdateProfile(phone, store.getChat(phone));
}

async function connectBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

  sock = makeWASocket({ auth: state, printQRInTerminal: true, syncFullHistory: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) broadcast({ type: 'qr', qr });
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[Bot] Connection closed. Reconnect:', shouldReconnect);
      broadcast({ type: 'status', status: 'disconnected' });
      if (shouldReconnect) setTimeout(connectBot, 3000);
    } else if (connection === 'open') {
      console.log('[Bot] Connected to WhatsApp');
      broadcast({ type: 'status', status: 'connected' });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      const profile = store.getProfile(phone);
      if (!profile) continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';
      if (!text) continue;

      if (text === '!reset') {
        store.saveChat(phone, []);
        await sendMessage(phone, 'Hey! Starting fresh 😊');
        continue;
      }

      store.addMessage(phone, 'them', text);
      broadcast({ type: 'message', phone, role: 'them', text, ts: Date.now() });
      resetGapTimer(phone);
      handleIncoming(phone, text);
    }
  });
}

module.exports = { connectBot, sendMessage, setBroadcast, getDraftQueue, getTakeover, getSock, resetGapTimer, scheduleContact };
