const axios = require('axios');
const { OLLAMA_URL, OLLAMA_MODEL } = require('./config');
const { buildIdentityBlurb } = require('./persona');

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 6) return 'late night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function buildSystemPrompt(profile) {
  const identity = buildIdentityBlurb();
  const tone = profile.toneLevel || 30;
  const mode = profile.personalityMode || 'balanced';
  const rel = profile.relationship || 'friend';
  const name = profile.name || profile.phone;
  const nick = profile.nickname || name;
  const notes = profile.notes || '';
  const interests = profile.interests || '';
  const tod = timeOfDay();

  const toneDesc =
    tone < 20 ? 'very casual and chill' :
    tone < 50 ? 'warm and friendly' :
    tone < 75 ? 'flirty and teasing' :
    'very spicy and bold';

  return `You are ${identity}

You are texting your ${rel} named ${nick} right now. It is ${tod}.
Your tone should be: ${toneDesc} (tone level ${tone}/100).
Personality mode: ${mode}.
${notes ? 'Notes about them: ' + notes : ''}
${interests ? 'Their interests: ' + interests : ''}

Rules:
- Write like a real Indian guy texting. Natural, casual Indian-English.
- Short replies, 1–3 sentences max. Occasionally longer if it feels right.
- Use everyday language: yaar, na, nah, haha, lol, ok ok, arey, etc — but not forced.
- Never sound robotic. Never use bullet points or lists.
- Match the energy of the incoming message.
- Do NOT mention you are an AI, bot, or assistant.
- Time of day is ${tod} — factor that into your vibe.`;
}

async function generateReply(profile, chatHistory, incomingMessages) {
  const systemPrompt = buildSystemPrompt(profile);

  const historyFormatted = chatHistory.slice(-20).map(m => ({
    role: m.role === 'me' ? 'assistant' : 'user',
    content: m.text
  }));

  const combined = incomingMessages.join(' ');
  const messages = [
    ...historyFormatted,
    { role: 'user', content: combined }
  ];

  const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages,
    system: systemPrompt,
    stream: false,
    options: { temperature: 0.85, top_p: 0.9 }
  });

  return res.data.message.content.trim();
}

async function generateStarter(profile, chatHistory) {
  const identity = buildIdentityBlurb();
  const rel = profile.relationship || 'friend';
  const nick = profile.nickname || profile.name || profile.phone;
  const tod = timeOfDay();

  const systemPrompt = `You are ${identity}. You are texting your ${rel} named ${nick}. It is ${tod}. You haven't texted them in a while. Send one natural, casual, human-sounding conversation opener — just one sentence or question. Sound like a real person, not a bot.`;

  const ctx = chatHistory.slice(-5).map(m => ({ role: m.role === 'me' ? 'assistant' : 'user', content: m.text }));

  const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages: ctx.length ? ctx : [{ role: 'user', content: 'hey' }],
    system: systemPrompt,
    stream: false,
    options: { temperature: 0.9 }
  });

  return res.data.message.content.trim();
}

async function generateScheduledMessage(profile, occasion) {
  const identity = buildIdentityBlurb();
  const nick = profile.nickname || profile.name || profile.phone;
  const rel = profile.relationship || 'friend';

  const systemPrompt = `You are ${identity}. Send a warm, natural ${occasion} message to your ${rel} named ${nick}. One short, genuine message — no emojis overload, no cheesy lines. Sound like a real Indian person texting.`;

  const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages: [{ role: 'user', content: `send ${occasion} message` }],
    system: systemPrompt,
    stream: false
  });

  return res.data.message.content.trim();
}

async function generateSummary(profile, chatHistory) {
  const nick = profile.name || profile.phone;
  const rel = profile.relationship || 'contact';
  const msgs = chatHistory.slice(-100).map(m => `${m.role === 'me' ? 'Me' : nick}: ${m.text}`).join('\n');

  const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    messages: [{ role: 'user', content: `Here is my conversation history with ${nick} (${rel}):\n\n${msgs}\n\nWrite a short, warm, 3–5 sentence summary of our relationship and recent topics.` }],
    stream: false
  });

  return res.data.message.content.trim();
}

module.exports = { generateReply, generateStarter, generateScheduledMessage, generateSummary };
