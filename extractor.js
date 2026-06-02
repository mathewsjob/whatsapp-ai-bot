const axios = require('axios');
const { OLLAMA_URL, OLLAMA_MODEL } = require('./config');
const store = require('./store');

async function extractAndUpdateProfile(phone, chatHistory) {
  const profile = store.getProfile(phone);
  if (!profile) return;

  const recent = chatHistory.slice(-30).map(m => `${m.role === 'me' ? 'Me' : (profile.name || phone)}: ${m.text}`).join('\n');

  try {
    const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages: [{
        role: 'user',
        content: `From the following conversation, extract any personal facts about the person I'm talking to (NOT about me). Things like: job, city, hobbies, family, recent events, mood. Return a JSON object with keys like job, city, hobbies, family, recentNews. Only include keys where you found real info. If nothing useful, return {}.\n\n${recent}`
      }],
      stream: false,
      format: 'json'
    });

    const extracted = JSON.parse(res.data.message.content);
    if (extracted && Object.keys(extracted).length > 0) {
      const updated = { ...profile, extractedFacts: { ...(profile.extractedFacts || {}), ...extracted } };
      store.saveProfile(phone, updated);
    }
  } catch (e) {
    // silent fail
  }
}

module.exports = { extractAndUpdateProfile };
