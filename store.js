const fs = require('fs');
const path = require('path');

const CONTACTS_DIR = path.join(__dirname, 'contacts');
if (!fs.existsSync(CONTACTS_DIR)) fs.mkdirSync(CONTACTS_DIR);

function contactDir(phone) {
  const d = path.join(CONTACTS_DIR, phone);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function getProfile(phone) {
  const f = path.join(contactDir(phone), 'profile.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveProfile(phone, profile) {
  const f = path.join(contactDir(phone), 'profile.json');
  fs.writeFileSync(f, JSON.stringify(profile, null, 2));
}

function getChat(phone) {
  const f = path.join(contactDir(phone), 'chat.json');
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveChat(phone, messages) {
  const f = path.join(contactDir(phone), 'chat.json');
  const trimmed = messages.slice(-200);
  fs.writeFileSync(f, JSON.stringify(trimmed, null, 2));
}

function addMessage(phone, role, text) {
  const msgs = getChat(phone);
  msgs.push({ role, text, ts: Date.now() });
  saveChat(phone, msgs);
  return msgs;
}

function listContacts() {
  if (!fs.existsSync(CONTACTS_DIR)) return [];
  return fs.readdirSync(CONTACTS_DIR)
    .filter(d => fs.statSync(path.join(CONTACTS_DIR, d)).isDirectory())
    .map(phone => {
      const profile = getProfile(phone);
      return profile ? { phone, ...profile } : { phone, name: phone };
    });
}

function deleteContact(phone) {
  const d = path.join(CONTACTS_DIR, phone);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true });
}

module.exports = { getProfile, saveProfile, getChat, saveChat, addMessage, listContacts, deleteContact };
