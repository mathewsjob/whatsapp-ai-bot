const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const store = require('./store');
const { generateSummary, generateScheduledMessage } = require('./ai');
const bot = require('./bot');
const scheduler = require('./scheduler');
const { PORT } = require('./config');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(json); });
}

bot.setBroadcast(broadcast);
scheduler.setSendFn(bot.sendMessage);

// REST API
app.get('/api/contacts', (req, res) => {
  res.json(store.listContacts());
});

app.post('/api/contacts', (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const existing = store.getProfile(phone);
  if (!existing) {
    store.saveProfile(phone, {
      name: name || phone,
      relationship: 'friend',
      toneLevel: 30,
      personalityMode: 'balanced',
      draftReview: false,
      autoStarter: false,
      gapDetector: true,
      schedules: []
    });
  }
  res.json({ ok: true, phone });
});

app.get('/api/contacts/:phone/profile', (req, res) => {
  const p = store.getProfile(req.params.phone);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

app.put('/api/contacts/:phone/profile', (req, res) => {
  const existing = store.getProfile(req.params.phone) || {};
  const updated = { ...existing, ...req.body };
  store.saveProfile(req.params.phone, updated);
  scheduler.scheduleContact(req.params.phone);
  res.json({ ok: true });
});

app.delete('/api/contacts/:phone', (req, res) => {
  store.deleteContact(req.params.phone);
  res.json({ ok: true });
});

app.get('/api/contacts/:phone/chat', (req, res) => {
  res.json(store.getChat(req.params.phone));
});

app.delete('/api/contacts/:phone/chat', (req, res) => {
  store.saveChat(req.params.phone, []);
  broadcast({ type: 'chat_cleared', phone: req.params.phone });
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/send', async (req, res) => {
  try {
    const { text } = req.body;
    await bot.sendMessage(req.params.phone, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/contacts/:phone/draft/approve', async (req, res) => {
  const { index } = req.body;
  const queue = bot.getDraftQueue();
  const drafts = queue.get(req.params.phone) || [];
  const text = drafts[index ?? 0];
  if (!text) return res.status(404).json({ error: 'no draft' });
  drafts.splice(index ?? 0, 1);
  if (!drafts.length) queue.delete(req.params.phone);
  await bot.sendMessage(req.params.phone, text);
  res.json({ ok: true });
});

app.post('/api/contacts/:phone/draft/reject', (req, res) => {
  const queue = bot.getDraftQueue();
  const drafts = queue.get(req.params.phone) || [];
  drafts.splice(req.body.index ?? 0, 1);
  if (!drafts.length) queue.delete(req.params.phone);
  res.json({ ok: true });
});

app.get('/api/contacts/:phone/drafts', (req, res) => {
  const queue = bot.getDraftQueue();
  res.json(queue.get(req.params.phone) || []);
});

app.post('/api/contacts/:phone/takeover', (req, res) => {
  const to = bot.getTakeover();
  if (req.body.active) to.add(req.params.phone); else to.delete(req.params.phone);
  res.json({ ok: true, active: to.has(req.params.phone) });
});

app.post('/api/contacts/:phone/summary', async (req, res) => {
  try {
    const profile = store.getProfile(req.params.phone);
    const chat = store.getChat(req.params.phone);
    const summary = await generateSummary(profile, chat);
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/contacts/:phone/analytics', (req, res) => {
  const chat = store.getChat(req.params.phone);
  const total = chat.length;
  const byMe = chat.filter(m => m.role === 'me').length;
  const byThem = total - byMe;
  const hours = Array(24).fill(0);
  chat.forEach(m => { if (m.ts) hours[new Date(m.ts).getHours()]++; });
  const peakHour = hours.indexOf(Math.max(...hours));
  const responseTimes = [];
  for (let i = 1; i < chat.length; i++) {
    if (chat[i].role === 'me' && chat[i - 1].role === 'them' && chat[i].ts && chat[i - 1].ts) {
      responseTimes.push(chat[i].ts - chat[i - 1].ts);
    }
  }
  const avgResponse = responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 1000) : null;
  res.json({ total, byMe, byThem, peakHour, avgResponseSec: avgResponse, hourlyActivity: hours });
});

app.get('/api/contacts/:phone/export', (req, res) => {
  const profile = store.getProfile(req.params.phone);
  const chat = store.getChat(req.params.phone);
  const name = profile?.name || req.params.phone;
  const lines = chat.map(m => {
    const d = m.ts ? new Date(m.ts).toLocaleString() : '';
    return `[${d}] ${m.role === 'me' ? 'Me' : name}: ${m.text}`;
  });
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="chat_${req.params.phone}.txt"`);
  res.send(lines.join('\n'));
});

app.post('/api/contacts/:phone/quick-send', async (req, res) => {
  try {
    const { occasion } = req.body;
    const profile = store.getProfile(req.params.phone);
    const msg = await generateScheduledMessage(profile, occasion);
    await bot.sendMessage(req.params.phone, msg);
    res.json({ ok: true, msg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/my-profile', (req, res) => {
  res.json(require('./my-profile.json'));
});

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'status', status: 'connected' }));
});

scheduler.initScheduler();

server.listen(PORT, () => {
  console.log(`\n🚀 Dashboard: http://localhost:${PORT}`);
  bot.connectBot();
});
