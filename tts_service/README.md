# CosyVoice TTS Service

这个目录提供一个轻量的 Python TTS adapter，用来把站点的 `/api/tts` 接到自托管 `CosyVoice` 运行时。

## 推荐架构

```text
浏览器
  -> /api/tts (Vercel / Node proxy)
  -> tts_service/app.py
  -> CosyVoice 官方 FastAPI runtime
```

这样做的好处是：

- 前端永远只认 `/api/tts`
- 语音模型换代时不用再改前端
- prompt 音频、音色策略、克隆链路都能留在 Python 服务侧

## 依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-tts.txt
```

## 环境变量

```bash
export COSYVOICE_RUNTIME_URL="http://127.0.0.1:50000"
export COSYVOICE_MODE="instruct2"
export COSYVOICE_PROMPT_WAV_PATH="/absolute/path/to/luosi_prompt.wav"
export COSYVOICE_INSTRUCTION="请用温柔、自然、亲切、像熟悉桌游的女生朋友一样的语气说话。"
export COSYVOICE_SAMPLE_RATE="24000"
```

如果你想走 `zero_shot`：

```bash
export COSYVOICE_MODE="zero_shot"
export COSYVOICE_PROMPT_TEXT="大家好呀，今晚我们别纠结，现在就玩。"
export COSYVOICE_PROMPT_WAV_PATH="/absolute/path/to/luosi_prompt.wav"
```

如果你想走 `sft`：

```bash
export COSYVOICE_MODE="sft"
export COSYVOICE_SPK_ID="中文女"
```

## 启动

```bash
uvicorn tts_service.app:app --reload --host 0.0.0.0 --port 8010
```

然后在前端 / Vercel 侧配置：

```bash
export TTS_PROVIDER="cosyvoice_service"
export TTS_SERVICE_URL="http://127.0.0.1:8010"
```

## API

### `GET /health`

返回当前 provider、mode、sample rate，以及 prompt 配置是否齐全。

### `POST /synthesize`

请求体：

```json
{
  "text": "欢迎来到今晚的桌游局。",
  "instruction": "温柔、自然、亲切，像熟悉桌游的女生朋友一样开场。"
}
```

响应：

- `audio/wav`

## 关于官方 CosyVoice runtime

这个 adapter 默认假设你已经按官方仓库把 `CosyVoice` runtime 跑起来，并复用它的接口：

- `inference_instruct2`
- `inference_zero_shot`
- `inference_sft`

官方仓库：

- https://github.com/FunAudioLLM/CosyVoice

其中 `runtime/python/fastapi/server.py` 和 `runtime/python/fastapi/client.py` 是这层接法的主要参考。

另外，当前 adapter 会自动兼容 CosyVoice2/3 官方 prompt 约定：

- `instruct2` 模式下，如果 `COSYVOICE_INSTRUCTION` 里没有 `<|endofprompt|>`，会自动补成 `You are a helpful assistant. ... <|endofprompt|>`
- `zero_shot` 模式下，如果 `COSYVOICE_PROMPT_TEXT` 里没有 `<|endofprompt|>`，会自动补成 `You are a helpful assistant.<|endofprompt|>...`
