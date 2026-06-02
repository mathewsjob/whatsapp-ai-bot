require('dotenv').config();

module.exports = {
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  PORT: parseInt(process.env.PORT || '3000', 10),
};
