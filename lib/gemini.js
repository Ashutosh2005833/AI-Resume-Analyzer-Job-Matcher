const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

function getModels() {
  const configured = String(process.env.GEMINI_MODEL || '').trim();
  const extras = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set([configured, ...extras, ...DEFAULT_MODELS].filter(Boolean))];
}

function normalizeApiKey(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function getApiKey() {
  const apiKey = normalizeApiKey(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is missing from .env.');
    err.safeDetails = { message: err.message };
    throw err;
  }
  return apiKey;
}

function redactSecrets(text, apiKey) {
  let value = String(text || '');
  if (apiKey) value = value.split(apiKey).join('[REDACTED_API_KEY]');
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/AQ\.[0-9A-Za-z._-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/key_[0-9A-Za-z._-]{20,}/g, '[REDACTED_API_KEY]');
}

function parseSdkError(error, model, apiKey) {
  let parsedBody;
  if (typeof error?.body === 'string') {
    try { parsedBody = JSON.parse(error.body); } catch (_) {}
  } else if (error?.body && typeof error.body === 'object') {
    parsedBody = error.body;
  }

  const nested = parsedBody?.error || error?.error || {};
  const status = Number(error?.status ?? error?.statusCode ?? nested?.code ?? 0) || undefined;
  const apiStatus = nested?.status || error?.statusText || undefined;
  const reason = Array.isArray(nested?.details)
    ? nested.details.find((detail) => detail && typeof detail === 'object' && detail.reason)?.reason
    : undefined;
  const message = redactSecrets(
    nested?.message || error?.message || 'Gemini API request failed.',
    apiKey
  );

  const safeDetails = {
    httpStatus: status,
    apiStatus,
    reason: reason ? String(reason) : undefined,
    model,
    message,
    authMethod: '@google/genai + GEMINI_API_KEY',
    backend: 'Gemini Developer API'
  };

  const wrapped = new Error(message);
  wrapped.httpStatus = status;
  wrapped.safeDetails = safeDetails;
  wrapped.cause = error;
  return wrapped;
}

async function createClient({ timeoutMs = 60000 } = {}) {
  const apiKey = getApiKey();
  let GoogleGenAI;
  try {
    ({ GoogleGenAI } = await import('@google/genai'));
  } catch (error) {
    const wrapped = new Error('@google/genai is not installed. Run npm install (or bash setup.sh) first.');
    wrapped.safeDetails = { message: wrapped.message };
    throw wrapped;
  }

  // Explicitly force the Gemini Developer API. This prevents any GOOGLE_CLOUD_*
  // or enterprise/Vertex environment variables from switching auth to OAuth.
  const ai = new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: {
      apiVersion: 'v1beta',
      timeout: timeoutMs,
      headers: {
        'x-goog-api-client': 'ai-resume-analyzer/1.4.0'
      }
    }
  });

  return { ai, apiKey };
}

function shouldTryAnotherModel(error) {
  return [404, 429, 500, 502, 503, 504].includes(Number(error?.httpStatus));
}

async function callGenerateContent({ model, prompt, json = false, timeoutMs = 60000 }) {
  const { ai, apiKey } = await createClient({ timeoutMs });
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: 12000,
        ...(json ? { responseMimeType: 'application/json' } : {})
      }
    });

    const text = String(response?.text || '').trim();
    if (!text) {
      const finishReason = response?.candidates?.[0]?.finishReason;
      const err = new Error(`Gemini returned no text${finishReason ? ` (finishReason: ${finishReason})` : ''}.`);
      err.safeDetails = {
        model,
        message: err.message,
        finishReason,
        authMethod: '@google/genai + GEMINI_API_KEY',
        backend: 'Gemini Developer API'
      };
      throw err;
    }

    return { text, model };
  } catch (error) {
    if (error?.safeDetails) throw error;
    throw parseSdkError(error, model, apiKey);
  }
}

async function generateWithModelFallback({ prompt, json = false, timeoutMs = 60000 }) {
  getApiKey();
  const models = getModels();
  const failures = [];

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    try {
      return await callGenerateContent({ model, prompt, json, timeoutMs });
    } catch (error) {
      failures.push(error?.safeDetails || { model, message: error?.message || String(error) });
      if (!shouldTryAnotherModel(error) || i === models.length - 1) {
        const finalError = new Error(error?.message || 'Gemini request failed.');
        finalError.safeDetails = error?.safeDetails || { model, message: finalError.message };
        finalError.attempts = failures;
        throw finalError;
      }
    }
  }

  const err = new Error('No Gemini models were available.');
  err.safeDetails = { message: err.message };
  err.attempts = failures;
  throw err;
}

function cleanJsonText(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function testGeminiConnection() {
  const result = await generateWithModelFallback({
    prompt: 'Reply with exactly: GEMINI_OK',
    timeoutMs: 30000
  });
  return {
    ok: result.text.includes('GEMINI_OK'),
    model: result.model,
    response: result.text.slice(0, 100),
    authMethod: '@google/genai + GEMINI_API_KEY',
    backend: 'Gemini Developer API'
  };
}

function authConfigSelfTest() {
  return {
    explicitApiKey: true,
    vertexai: false,
    bearerTokenConfiguredByApp: false,
    backend: 'Gemini Developer API'
  };
}

module.exports = {
  generateWithModelFallback,
  cleanJsonText,
  testGeminiConnection,
  getModels,
  authConfigSelfTest
};
