# AI Resume Analyzer & Job Matcher

Ready-to-run Node.js web app.

## Gemini authentication

The backend uses the official `@google/genai` SDK and explicitly initializes the Gemini Developer API with `GEMINI_API_KEY` from `.env`. It explicitly sets `vertexai: false`, so Google Cloud/Vertex environment variables cannot switch the app to OAuth/Bearer authentication.

The API key is never sent to browser code.

## Run

```bash
bash setup.sh
npm start
```

Open `http://localhost:3000`.

`setup.sh` installs dependencies and performs a live Gemini connection test before reporting success.
