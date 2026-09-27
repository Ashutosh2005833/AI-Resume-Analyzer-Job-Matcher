require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const { generateWithModelFallback, cleanJsonText, testGeminiConnection, getModels } = require('./lib/gemini');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const looksLikePdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    cb(looksLikePdf ? null : new Error('Only PDF resumes are supported.'), looksLikePdf);
  }
});

const skillPatterns = {
  HTML: /\bHTML5?\b/i,
  CSS: /\bCSS3?\b/i,
  JavaScript: /\bJavaScript\b|\bJS\b/i,
  TypeScript: /\bTypeScript\b|\bTS\b/i,
  Python: /\bPython\b/i,
  Java: /\bJava\b/i,
  'C++': /C\+\+/i,
  'C#': /C#/i,
  C: /(?:^|[\s,(])C(?:[\s,.)]|$)/m,
  React: /\bReact(?:\.js|JS)?\b/i,
  'Next.js': /\bNext(?:\.js|JS)?\b/i,
  'Node.js': /\bNode(?:\.js|JS)?\b/i,
  Express: /\bExpress(?:\.js|JS)?\b/i,
  MongoDB: /\bMongoDB\b/i,
  MySQL: /\bMySQL\b/i,
  PostgreSQL: /\bPostgreSQL\b|\bPostgres\b/i,
  SQL: /\bSQL\b/i,
  Git: /\bGit\b/i,
  GitHub: /\bGitHub\b/i,
  'REST API': /\bREST(?:ful)?\s*(?:API|APIs|services?)\b/i,
  API: /\bAPIs?\b/i,
  Bootstrap: /\bBootstrap\b/i,
  'Tailwind CSS': /\bTailwind(?:\s*CSS)?\b/i,
  Flutter: /\bFlutter\b/i,
  Dart: /\bDart\b/i,
  'Spring Boot': /\bSpring\s*Boot\b/i,
  AWS: /\bAWS\b|\bAmazon Web Services\b/i,
  Azure: /\bAzure\b/i,
  GCP: /\bGCP\b|\bGoogle Cloud(?: Platform)?\b/i,
  Docker: /\bDocker\b/i,
  Kubernetes: /\bKubernetes\b|\bK8s\b/i,
  Linux: /\bLinux\b/i,
  Firebase: /\bFirebase\b/i,
  DSA: /\bDSA\b|\bData Structures(?: and Algorithms)?\b/i,
  OOP: /\bOOP\b|\bObject[- ]Oriented Programming\b/i,
  'Machine Learning': /\bMachine Learning\b|\bML\b/i,
  AI: /\bArtificial Intelligence\b|\bAI\b/i,
  NLP: /\bNLP\b|\bNatural Language Processing\b/i,
  TensorFlow: /\bTensorFlow\b/i,
  PyTorch: /\bPyTorch\b/i,
  Pandas: /\bPandas\b/i,
  NumPy: /\bNumPy\b/i,
  Django: /\bDjango\b/i,
  Flask: /\bFlask\b/i,
  FastAPI: /\bFastAPI\b/i,
  Redis: /\bRedis\b/i,
  GraphQL: /\bGraphQL\b/i,
  Jenkins: /\bJenkins\b/i,
  "CI/CD": /\bCI\s*\/\s*CD\b|\bContinuous Integration\b/i
};

function detectSkills(text = '') {
  return Object.entries(skillPatterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([skill]) => skill);
}

function cleanExtractedText(text = '') {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

async function runGeminiAnalysis({ resumeText, jobDescription, matchedSkills, missingSkills, extraSkills }) {
  const safeResume = resumeText.slice(0, 70000);
  const safeJob = jobDescription.slice(0, 30000);

  const prompt = `
You are an expert ATS resume analyzer and resume writer. Compare the candidate resume with the job/internship description and produce BOTH analysis and a tailored resume.

STRICT FACTUAL RULES:
- Never invent or infer experience, education, projects, achievements, employers, dates, certifications, contact details, metrics, or skills.
- Never add a missing skill unless it is already present in the original resume.
- You may improve wording, section order, emphasis, and ATS terminology only when factually supported by the source resume.
- Plain text inside JSON strings only.

ORIGINAL RESUME:\n${safeResume}\n\nJOB / INTERNSHIP DESCRIPTION:\n${safeJob}

DETECTED MATCHED SKILLS: ${matchedSkills.join(', ') || 'None'}
DETECTED MISSING SKILLS: ${missingSkills.join(', ') || 'None'}
DETECTED EXTRA / LESS RELEVANT SKILLS: ${extraSkills.join(', ') || 'None'}

Return ONLY valid JSON with exactly these keys:
{
  "aiAnalysis": "Use headings MATCH SUMMARY, MISSING REQUIREMENTS, WHAT TO HIGHLIGHT, WHAT TO DE-EMPHASIZE, and 5 RESUME IMPROVEMENT SUGGESTIONS.",
  "tailoredResume": "A complete job-specific ATS-friendly resume draft using only facts from the original resume."
}`;

  const result = await generateWithModelFallback({ prompt, json: true, timeoutMs: 90000 });
  let parsed;
  try {
    parsed = JSON.parse(cleanJsonText(result.text));
  } catch (error) {
    const parseError = new Error(`Gemini returned text but it was not valid JSON: ${error.message}`);
    parseError.safeDetails = { model: result.model, message: parseError.message };
    throw parseError;
  }

  const aiAnalysis = String(parsed?.aiAnalysis || '').trim();
  const tailoredResume = String(parsed?.tailoredResume || '').trim();
  if (!aiAnalysis || !tailoredResume) {
    const err = new Error('Gemini response was missing aiAnalysis or tailoredResume.');
    err.safeDetails = { model: result.model, message: err.message };
    throw err;
  }

  return { aiAnalysis, tailoredResume, model: result.model };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    models: getModels()
  });
});

app.get('/api/gemini-status', async (_req, res) => {
  try {
    const result = await testGeminiConnection();
    res.json({ ok: true, ...result });
  } catch (error) {
    const details = error?.safeDetails || { message: error?.message || 'Gemini test failed.' };
    res.status(503).json({ ok: false, error: details, attempts: error?.attempts || [details] });
  }
});

app.post('/analyze', upload.single('resume'), async (req, res) => {
  let parser;
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a resume PDF.' });
    if (!req.body.jobDescription || !req.body.jobDescription.trim()) {
      return res.status(400).json({ error: 'Please enter Job / Internship Description.' });
    }

    if (!req.file.buffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      return res.status(400).json({ error: 'The uploaded file is not a valid PDF.' });
    }

    parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const resumeText = cleanExtractedText(pdfData.text || '');
    if (resumeText.length < 20) {
      return res.status(400).json({ error: 'Could not read enough text from this PDF. Please use a text-based resume PDF.' });
    }

    const jobDescription = req.body.jobDescription.trim();
    const resumeSkills = detectSkills(resumeText);
    const requiredSkills = detectSkills(jobDescription);
    const matchedSkills = requiredSkills.filter((skill) => resumeSkills.includes(skill));
    const missingSkills = requiredSkills.filter((skill) => !resumeSkills.includes(skill));
    const extraSkills = resumeSkills.filter((skill) => !requiredSkills.includes(skill));
    const matchPercentage = requiredSkills.length
      ? Math.round((matchedSkills.length / requiredSkills.length) * 100)
      : 0;

    let geminiResult;
    try {
      geminiResult = await runGeminiAnalysis({ resumeText, jobDescription, matchedSkills, missingSkills, extraSkills });
    } catch (error) {
      const details = error?.safeDetails || { message: error?.message || 'Gemini request failed.' };
      console.error('Gemini API error:', JSON.stringify({ details, attempts: error?.attempts || [] }));
      return res.status(503).json({
        error: 'Gemini API failed. No fallback AI text was generated.',
        geminiError: details,
        geminiAttempts: error?.attempts || [details]
      });
    }

    const aiAnalysis = geminiResult.aiAnalysis;
    const tailoredResume = geminiResult.tailoredResume;
    const aiPowered = true;

    res.json({
      message: 'Resume analyzed successfully!',
      matchPercentage,
      resumeSkills,
      requiredSkills,
      matchedSkills,
      missingSkills,
      extraSkills,
      aiAnalysis,
      tailoredResume,
      resumeText,
      aiPowered,
      geminiModel: geminiResult.model
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not analyze the resume. Please try another text-based PDF.' });
  } finally {
    if (parser) {
      try { await parser.destroy(); } catch (_) {}
    }
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Resume PDF is too large. Maximum size is 8 MB.' });
  }
  if (error && error.message) return res.status(400).json({ error: error.message });
  return res.status(500).json({ error: 'Unexpected server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Resume Analyzer running at http://localhost:${PORT}`);
    console.log(`Gemini: ${process.env.GEMINI_API_KEY ? `configured (${getModels().join(', ')})` : 'NOT configured'}`);
  });
}

module.exports = { app, detectSkills, runGeminiAnalysis };
