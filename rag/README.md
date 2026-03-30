# Python RAG Backend

这个目录提供桌游 DM 项目的 Python RAG 骨架，目标是把知识摄入、向量检索、召回接口从前端逻辑里独立出来。

## 技术栈

- FastAPI
- ChromaDB PersistentClient
- FastEmbed 本地向量化
- 本地 lexical/BM25 召回
- Hybrid fusion + heuristic rerank
- Contextual chunk headers + query-time aggregation

## 目录结构

```text
rag/
├── __init__.py
├── app.py              # FastAPI 应用入口
├── chroma_store.py     # Chroma 持久化与查询封装
├── chunking.py         # 文档切块逻辑
├── config.py           # env 配置读取
├── embedding_service.py # 本地 embedding 封装
├── ingest.py           # ingest CLI + 业务逻辑
├── lexical_index.py    # 本地 lexical 索引与 BM25 风格检索
├── models.py           # 文档、chunk、接口数据模型
├── retrieval.py        # query/retrieve 服务
└── README.md
```

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-rag.txt
```

## 环境变量

默认不需要任何云端 API Key。可选配置：

```bash
export RAG_EMBEDDING_PROVIDER="fastembed"
export RAG_EMBEDDING_MODEL="BAAI/bge-small-zh-v1.5"
export RAG_EMBEDDING_CACHE_DIR="rag/.cache/fastembed"
export RAG_EMBEDDING_THREADS="4"
export RAG_CHROMA_PATH="rag/.chroma"
export RAG_COLLECTION_NAME="boardgame_knowledge"
export RAG_CHUNK_MAX_CHARS="900"
export RAG_CHUNK_OVERLAP_CHARS="120"
export RAG_EMBEDDING_BATCH_SIZE="64"
export RAG_DEFAULT_TOP_K="5"
export RAG_LEXICAL_SOURCE_PATH="knowledge/boardgame_kb.jsonl"
export RAG_DENSE_CANDIDATE_MULTIPLIER="4"
export RAG_LEXICAL_CANDIDATE_MULTIPLIER="6"
export RAG_HYBRID_DENSE_WEIGHT="0.65"
export RAG_HYBRID_LEXICAL_WEIGHT="0.35"
export RAG_RRF_K="60"
export RAG_RECOMMENDATION_GROUP_MAX_CHUNKS="2"
export RAG_REFEREE_GROUP_MAX_CHUNKS="3"
```

## 输入格式

当前 ingest 明确只消费 `json` 或 `jsonl` 文档集合，不直接解析 TS 源码。

### JSONL 示例

```json
{
  "document_id": "game:uno",
  "title": "UNO (优诺)",
  "source": "boardgame_kb_export",
  "metadata": {
    "game_id": "uno",
    "mode": "referee",
    "min_players": 2,
    "max_players": 10
  },
  "sections": [
    {
      "section_id": "target",
      "title": "获胜目标",
      "text": "最先出完手中所有牌的玩家获胜本局。"
    },
    {
      "section_id": "flow",
      "title": "流程",
      "text": "庄家左手边开始，顺时针出牌..."
    }
  ]
}
```

### 字段约定

- `document_id`: 文档唯一 ID
- `title`: 文档标题
- `source`: 来源标识，可选
- `metadata`: 文档级 metadata，建议放 `game_id`、标签、人数、复杂度
- `sections`: 推荐使用。每个 section 会优先按章节切块
- `text`: 如果没有 `sections`，可以直接提供整篇文本

## 启动服务

```bash
uvicorn rag.app:app --reload --host 0.0.0.0 --port 8001
```

首次执行 ingest 或 query 时会自动下载 embedding 模型到 `RAG_EMBEDDING_CACHE_DIR`。

## API

### `GET /health`

返回基础状态、collection 名称、embedding provider、embedding 模型和本地缓存目录。

### `POST /ingest`

```json
{
  "input_path": "data/boardgame_kb.jsonl",
  "reset_collection": true
}
```

### `POST /query`

```json
{
  "query": "UNO 什么时候必须喊 UNO？",
  "top_k": 5,
  "mode": "referee",
  "active_game_id": "uno",
  "where": {
    "mode": "referee",
    "game_id": "uno"
  },
  "debug": true
}
```

`where` 会直接传给 Chroma，用于当前游戏过滤、模式过滤等场景。

返回结果里同时包含：

- `distance`: Chroma 原始距离，越小越接近
- `score`: 融合重排后的最终分数
- `dense_score`: 向量召回分数
- `lexical_score`: lexical/BM25 分数
- `rerank_score`: 重排后的显式得分
- `retrieval_sources`: 命中来源，可能包含 `vector` / `lexical`
- `rewritten_query`: 查询改写后的检索语句
- `strategy`: 当前检索策略，例如 `hybrid_rrf_rerank_aggregated`
- `diagnostics`: 召回候选数、query expansion、section target、聚合前后命中数，以及 `latency_ms` / 分阶段耗时等调试信息

## CLI ingest

```bash
python -m rag.ingest --input data/boardgame_kb.jsonl --reset-collection
```

## 设计说明

- 当前版本把本地 embedding 放在服务侧显式计算，再写入 Chroma，避免把 embedding 逻辑散落到上层。
- 默认使用 `fastembed + BAAI/bge-small-zh-v1.5`，优先保证中文桌游规则检索的可用性，同时避免外部 API key 与兼容层不稳定问题。
- chunking 优先按 `sections` 切，再按段落与字符长度二次切块，适合桌游规则这种天然分章节文本。
- ingest 时会为每个 chunk 生成基于游戏、章节、标签、人数、时长等信息的 contextual header，并仅用于 embedding / lexical 检索；返回给上层的仍是原始正文。
- 查询阶段走 `vector + lexical` 混合召回，再结合 `mode`、`section_type`、`active_game_id` 做轻量重排。
- `recommendation` 模式会先保留更宽的候选池，再按 `game_id` 聚合，尽量避免 top-k 被同一游戏刷屏。
- `recommendation` 模式会识别显式否定偏好，例如“不想玩阵营推理”“别太伤感情”，避免把被用户排斥的候选继续顶上来。
- `referee` 模式会按 `document + section` 聚合，把同一知识段的相邻 chunk 合成更完整的上下文。
- `referee` 模式会做 section-aware query rewrite，更偏向把 `获胜目标 / 游戏流程 / FAQ / 知识库` 这类完整答案段落顶上来。
- `recommendation` 模式会做 tag/场景扩展，更偏向召回结构化推荐词条。
- 上层 `llmService` 会对明显的闲聊 / 控制类请求做动态路由，避免把“谢谢”“你是谁”“不玩这个了”之类输入也送进检索层，减少延迟和噪声上下文。
- 裁判回答会把召回片段包装成 `[证据N]` 标签，并在最终输出里追加 `参考依据`；如果模型编造了不存在的证据标签，上层会自动清洗掉无效标签。

## 待主线程集成

- 产出标准化知识文件，例如 `boardgame_kb.jsonl`
- 在前端或 Node API 层调用 `/query`
- 推荐模式补充 metadata filter 策略
- 裁判模式在 query 时固定传入当前 `game_id`
