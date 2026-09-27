const { authConfigSelfTest } = require('../lib/gemini');
const result = authConfigSelfTest();
console.log(JSON.stringify(result, null, 2));
if (!result.explicitApiKey || result.vertexai !== false || result.bearerTokenConfiguredByApp) process.exit(1);
console.log('GEMINI AUTH CONFIG SELF-TEST PASSED');
