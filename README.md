# Play or Not

AI-first board game DM for recommendation, live referee Q&A, voice interaction, and knowledge-base RAG.

- Live demo: https://play-or-not-dm.vercel.app/
- Agent-facing docs: https://play-or-not-dm.vercel.app/llms.txt
- Developer docs: https://play-or-not-dm.vercel.app/developers/
- OpenAPI surface: https://play-or-not-dm.vercel.app/openapi.json

## What This Repo Contains

This project is a board game assistant built for real group-play scenarios:

- Recommendation mode: suggest board games by player count, vibe, complexity, duration, and occasion.
- Referee mode: answer "how does this rule work right now?" follow-up questions during play.
- RAG pipeline: structured board game knowledge export, ChromaDB indexing, and retrieval evaluation.
- Voice interaction: STT input and DM-style TTS playback.
- Agent-friendly surface: `llms.txt`, `capabilities.json`, `openapi.json`, and `/developers/`.

## Core Stack

- Frontend: React 19 + TypeScript + Vite
- API layer: Vercel serverless routes under [`api/`](/Users/yusijua/Downloads/app%202/api)
- RAG backend: FastAPI + ChromaDB + FastEmbed in [`rag/`](/Users/yusijua/Downloads/app%202/rag)
- Evaluation: retrieval eval suites in [`rag_evals/`](/Users/yusijua/Downloads/app%202/rag_evals)
- TTS adapter: Python proxy for CosyVoice / external TTS in [`tts_service/`](/Users/yusijua/Downloads/app%202/tts_service)
- Knowledge assets: exported KB and source expansion artifacts in [`knowledge/`](/Users/yusijua/Downloads/app%202/knowledge)

## Product Surface

### Human-facing flows

- Email verification login
- Board game recommendation chat
- Referee-style rules clarification
- Voice input via STT
- DM voice playback via TTS

### Agent-facing flows

- `POST /api/chat`
- `POST /api/rag`
- `GET /api/rag`
- `POST /api/stt`
- `POST /api/tts`
- `POST /api/auth/email/send`
- `POST /api/auth/email/verify`

## Repo Layout

```text
.
├── api/            # Vercel API routes
├── docs/           # project notes and operating docs
├── knowledge/      # exported KB and source expansion artifacts
├── public/         # public assets + agent-friendly discovery files
├── rag/            # Python retrieval service
├── rag_evals/      # retrieval evaluation datasets and runners
├── scripts/        # KB export / source expansion / smoke eval scripts
├── src/            # React app
└── tts_service/    # Python TTS adapter service
```

## Quick Start

### 1. Install JavaScript dependencies

```bash
npm install
```

### 2. Create a Python virtualenv for RAG / TTS helpers

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-rag.txt
pip install -r requirements-tts.txt
```

### 3. Run the frontend locally

```bash
npm run dev
```

### 4. Optional: run the Python RAG service

```bash
source .venv/bin/activate
uvicorn rag.app:app --reload --host 0.0.0.0 --port 8001
```

### 5. Optional: run the TTS adapter

```bash
source .venv/bin/activate
uvicorn tts_service.app:app --reload --host 0.0.0.0 --port 8010
```

## Environment Variables

You do not need every variable for every workflow. The app supports partial local bring-up.

### LLM chat

```bash
export LLM_API_KEY="..."
export LLM_BASE_URL="https://..."
```

### Email auth

```bash
export AUTH_SECRET="..."
export RESEND_API_KEY="..."
export EMAIL_AUTH_FROM="玩吗 <noreply@auth.play-or-not-dm.online>"
export EMAIL_AUTH_PRODUCT_NAME="玩吗"
```

For local insecure testing only:

```bash
export AUTH_DEV_ALLOW_INSECURE_CODE="true"
```

### STT

```bash
export STT_BASE_URL="https://api.groq.com/openai/v1"
export STT_API_KEY="..."
export STT_MODEL="whisper-large-v3"
export STT_LANGUAGE="zh"
```

### RAG proxy

```bash
export RAG_SERVICE_URL="http://127.0.0.1:8001"
```

### TTS

Choose one path:

CosyVoice service:

```bash
export TTS_PROVIDER="cosyvoice_service"
export TTS_SERVICE_URL="http://127.0.0.1:8010"
```

MiniMax:

```bash
export TTS_PROVIDER="minimax"
export MINIMAX_TTS_API_KEY="..."
export MINIMAX_TTS_MODEL="speech-2.5-hd-preview"
export MINIMAX_TTS_VOICE_ID="Chinese (Mandarin)_Warm_Bestie"
```

## Knowledge Base Workflow

### Export the runtime board game DB into KB files

```bash
npm run kb:export
```

Outputs:

- [`knowledge/boardgame_kb.jsonl`](/Users/yusijua/Downloads/app%202/knowledge/boardgame_kb.jsonl)
- [`knowledge/boardgame_recommendation_kb.jsonl`](/Users/yusijua/Downloads/app%202/knowledge/boardgame_recommendation_kb.jsonl)
- [`knowledge/boardgame_kb_sections.jsonl`](/Users/yusijua/Downloads/app%202/knowledge/boardgame_kb_sections.jsonl)

### Expand the game source pool

```bash
npm run kb:source:harvest
npm run kb:source:render
```

Main source files:

- [`scripts/boardgame_source_expander.py`](/Users/yusijua/Downloads/app%202/scripts/boardgame_source_expander.py)
- [`knowledge/boardgame_source_seed_slugs.txt`](/Users/yusijua/Downloads/app%202/knowledge/boardgame_source_seed_slugs.txt)
- [`src/data/gameDatabaseAutoExpansion.ts`](/Users/yusijua/Downloads/app%202/src/data/gameDatabaseAutoExpansion.ts)

### Ingest into ChromaDB

```bash
PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_kb.jsonl --reset-collection
PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_recommendation_kb.jsonl
```

## Evaluation

Run all RAG evals:

```bash
npm run rag:eval
```

Run recommendation only:

```bash
npm run rag:eval:recommendation
```

Run referee only:

```bash
npm run rag:eval:referee
```

The evaluation harness and datasets live in [`rag_evals/`](/Users/yusijua/Downloads/app%202/rag_evals).

## Common Commands

```bash
npm run dev
npm run build
npm test
npm run kb:export
npm run rag:eval:recommendation
npm run tts:eval
```

## Deployment Notes

- Frontend and Node routes are configured for Vercel via [`vercel.json`](/Users/yusijua/Downloads/app%202/vercel.json).
- The Python RAG service and TTS adapter are designed to run as sidecar services.
- Public discovery and agent-facing files live in [`public/`](/Users/yusijua/Downloads/app%202/public).

## Collaboration Notes

- Generated knowledge artifacts are intentionally committed so retrieval changes are reviewable.
- Local runtime state such as `.vercel/`, `rag/.chroma/`, `.venv/`, `dist/`, and agent-local folders are ignored.
- If you change recommendation logic, please update eval datasets when the valid answer set genuinely broadens.

## License

No license has been added yet. Treat this repository as all-rights-reserved until the owner chooses a license.
