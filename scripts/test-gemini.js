require('dotenv').config();
const { testGeminiConnection, getModels } = require('../lib/gemini');

(async () => {
  console.log(`Testing Gemini models: ${getModels().join(', ')}`);
  try {
    const result = await testGeminiConnection();
    console.log(`GEMINI LIVE TEST PASSED: ${result.model} -> ${result.response}`);
  } catch (error) {
    console.error('GEMINI LIVE TEST FAILED');
    console.error(JSON.stringify({ error: error.safeDetails || { message: error.message }, attempts: error.attempts || [] }, null, 2));
    process.exitCode = 1;
  }
})();
