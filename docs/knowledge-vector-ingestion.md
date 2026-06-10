# MemBot 知识库文档向量化入库方案

> 版本：v1.2  
> 范围：有道笔记同步 + 本地上传 → Ingestion Pipeline → PostgreSQL + pgvector  
> 技术栈：LangChain（Document Loader / Text Splitter / Embeddings）+ PostgreSQL（pgvector）  
> 目标：为后续三路混合检索（向量 / 全文 / 图谱）打好数据基础

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [总体架构](#2-总体架构)
3. [LangChain 技术选型](#3-langchain-技术选型)
4. [存储分层](#4-存储分层)
5. [核心数据模型](#5-核心数据模型)
6. [Pipeline 触发与编排](#6-pipeline-触发与编排)
7. [步骤一：按文档类型解析](#7-步骤一按文档类型解析)
8. [步骤二：文本清洗](#8-步骤二文本清洗)
9. [步骤三：内容结构提取](#9-步骤三内容结构提取)
10. [步骤四：文本分块](#10-步骤四文本分块)
11. [步骤五：元数据附加](#11-步骤五元数据附加)
12. [步骤六：向量化](#12-步骤六向量化)
13. [步骤七：质量校验与去重](#13-步骤七质量校验与去重)
14. [步骤八：写入向量库](#14-步骤八写入向量库)
15. [模块与目录规划](#15-模块与目录规划)
16. [配置项](#16-配置项)
17. [API 设计](#17-api-设计)
18. [实施阶段](#18-实施阶段)

---

## 1. 背景与目标

### 1.1 现状

| 组件 | 状态 |
|------|------|
| 有道笔记同步 | 已实现，原始文本存 Redis（`knowledge:youdao:notes:{userId}`） |
| 本地上传 | 前端演示，未接后端 |
| Ingestion Pipeline | 未实现 |
| 向量库 | 未实现 |
| `knowledge_search` | AGENT.md 已规划，Chat 未接入 |

### 1.2 本期目标

完成 **文档 → 向量库** 全链路，使 Chat 可通过向量检索命中知识片段。

本期**不做**三路混合检索，但数据模型和存储分层需预留扩展位（`chunk_id` 作为三路锚点）。

### 1.3 设计原则

- **单一事实源**：PostgreSQL 统一存文档、分块原文、元数据、向量（pgvector），不引入独立向量库
- **幂等可重跑**：`content_hash` 不变则跳过，`chunk_hash` 不变则跳过 re-embed
- **策略可插拔**：解析器、分块器按文档类型注册
- **LangChain 优先**：标准能力（Loader / Splitter / Embeddings / PGVector Store）用 LangChain，业务差异用薄封装
- **异步处理**：同步/上传后不阻塞 HTTP，通过任务队列 ingest
- **与 Mem0 分离**：Mem0 存用户偏好；知识库存文档事实

---

## 2. 总体架构

```mermaid
flowchart TB
    subgraph Sources["数据源"]
        YN[有道笔记 Sync]
        UP[本地上传 Upload]
    end

    subgraph Buffer["过渡层（逐步废弃正文存储）"]
        Redis[(Redis 同步缓冲)]
    end

    subgraph SOT["事实源（PostgreSQL + pgvector）"]
        PG[(documents)]
        CHK[(document_chunks + embedding)]
        OBJ[对象存储 storage/]
    end

    subgraph Pipeline["Ingestion Pipeline"]
        S1[1 类型解析]
        S2[2 文本清洗]
        S3[3 结构提取]
        S4[4 文本分块]
        S5[5 元数据附加]
        S6[6 向量化]
        S7[7 质量校验与去重]
        S8[8 写入 PG embedding]
    end

    subgraph LC["LangChain 层"]
        LDR[Document Loaders]
        SPL[Text Splitters]
        EMB[OpenAIEmbeddings]
    end

    subgraph Consumer["消费方"]
        KS[knowledge_search]
        CHAT[ChatService]
    end

    YN --> Redis
    YN --> PG
    UP --> OBJ
    UP --> PG
    PG --> LDR --> S1 --> S2 --> S3 --> SPL --> S4 --> S5 --> EMB --> S6 --> S7 --> S8 --> CHK
    KS --> CHK
    CHAT --> KS
```

---

## 3. LangChain 技术选型

项目已安装 `langchain`、`@langchain/core`、`@langchain/openai`，可直接复用，无需自研分块/向量化底层。

### 3.1 职责划分

| 能力 | 用 LangChain | 自研薄封装 |
|------|-------------|-----------|
| PDF/TXT/MD 文件加载 | ✅ `@langchain/community` Document Loaders | — |
| 有道笔记解析 | — | ✅ `YoudaoTextParser`（无官方 Loader） |
| 文本分块 | ✅ Text Splitters | 策略路由层（按 block.type 选 Splitter） |
| 向量化 | ✅ `OpenAIEmbeddings` | 缓存层（Redis chunkHash） |
| 写入/检索向量 | ✅ `PGVector` VectorStore 或 SQL | 向量与 chunk 同表，无需回表 |
| 质量校验 / 去重 | — | ✅ 业务规则，LangChain 不提供 |
| 元数据附加 | 部分 ✅ `Document.metadata` | ✅ Enricher 写 PG |
| Pipeline 编排 | — | ✅ `IngestionService` |

### 3.2 依赖补充

```bash
npm install @langchain/community @langchain/textsplitters pg
```

| 包 | 用途 |
|----|------|
| `@langchain/textsplitters` | RecursiveCharacterTextSplitter、MarkdownHeaderTextSplitter 等 |
| `@langchain/community` | PDFLoader、TextLoader、PGVector Store |
| `pg` | PostgreSQL 驱动（NestJS 也可用 TypeORM / Prisma） |

### 3.3 LangChain Document 作为管道中间格式

Pipeline 各步骤之间统一用 LangChain `Document` 传递：

```typescript
import { Document } from '@langchain/core/documents'

// 步骤一输出
const doc = new Document({
  pageContent: plainText,
  metadata: {
    docId, userId, source, sourceId, title,
    mimeType, folderId, contentHash,
  },
})

// 步骤四输出（分块后）
const chunks: Document[] = splitter.splitDocuments([doc])
// 每个 chunk.metadata 继承文档级字段 + chunkIndex / chunkType / headingPath
```

### 3.4 LangChain 组件映射表

| Pipeline 步骤 | LangChain 组件 | 说明 |
|--------------|---------------|------|
| 解析 PDF | `PDFLoader` | `@langchain/community/document_loaders/fs/pdf` |
| 解析 TXT/MD | `TextLoader` | 本地文件 |
| 解析 DOCX | `DocxLoader` | P1 阶段 |
| 分块-段落 | `RecursiveCharacterTextSplitter` | 支持中文分隔符 |
| 分块-Markdown | `MarkdownHeaderTextSplitter` + `RecursiveCharacterTextSplitter` | 先按标题切，再递归 |
| 分块-代码 | `RecursiveCharacterTextSplitter` | `chunkOverlap: 0`，按 `\n\n` 切 |
| 向量化 | `OpenAIEmbeddings` | 对接 OpenRouter |
| 写入 pgvector | `PGVector.fromDocuments()` / SQL UPDATE embedding | 向量写入 `document_chunks` |
| 检索 | `PGVector.similaritySearchWithScore()` 或 SQL `<=>` | 支持 WHERE 元数据过滤 |

### 3.5 分块策略路由（LangChain 版）

```typescript
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { MarkdownHeaderTextSplitter } from '@langchain/textsplitters'

// 中文友好分隔符
const paragraphSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,
  chunkOverlap: 64,
  separators: ['\n\n', '\n', '。', '！', '？', '. ', ' ', ''],
})

const codeSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,
  chunkOverlap: 0,
  separators: ['\n\n', '\n'],
})

const markdownSplitter = new MarkdownHeaderTextSplitter({
  headersToSplitOn: [
    ['#', 'h1'], ['##', 'h2'], ['###', 'h3'],
  ],
})

function splitByBlockType(block: ContentBlock, baseDoc: Document): Document[] {
  switch (block.type) {
    case 'code':
      return codeSplitter.splitDocuments([
        new Document({ pageContent: block.text, metadata: { ...baseDoc.metadata, chunkType: 'code' } }),
      ])
    case 'section':
    case 'paragraph':
    default:
      return paragraphSplitter.splitDocuments([
        new Document({ pageContent: block.text, metadata: { ...baseDoc.metadata, chunkType: block.type } }),
      ])
  }
}
```

### 3.6 Embeddings（对接 OpenRouter）

```typescript
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.EMBEDDING_API_KEY,
  configuration: { baseURL: process.env.EMBEDDING_BASE_URL },
  model: process.env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
  dimensions: 1536,
})
```

### 3.7 PGVector（LangChain 封装）

```typescript
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const vectorStore = await PGVectorStore.initialize(embeddings, {
  pool,
  tableName: 'document_chunks',
  columns: {
    idColumnName: 'id',
    vectorColumnName: 'embedding',
    contentColumnName: 'text',
    metadataColumnName: 'metadata',  // JSONB，或拆为独立列
  },
})

// 检索时带过滤
const results = await vectorStore.similaritySearchWithScore(query, 5, {
  userId: 'demo_user_001',
})
```

**推荐（P0）**：向量直接存在 `document_chunks.embedding` 列，用 SQL 检索，不依赖 LangChain PGVector 的独立表结构：

```sql
SELECT c.id, c.text, c.chunk_type, d.title,
       1 - (c.embedding <=> $1::vector) AS score
FROM document_chunks c
JOIN documents d ON d.id = c.doc_id
WHERE d.user_id = $2
  AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> $1::vector
LIMIT 5;
```

> LangChain `PGVectorStore` 适合快速验证；生产推荐自研 `PgVectorRepository`，向量与 chunk 同表，元数据用 SQL WHERE 过滤，无需维护两套存储。

### 3.8 什么不用 LangChain

| 场景 | 原因 |
|------|------|
| 有道 MCP 笔记 | 无标准 Loader，内容来自 API |
| 质量校验（乱码/过短） | 业务规则，自行实现 |
| L1/L2 哈希去重 | 需查 PG，非 LangChain 职责 |
| PostgreSQL 事实源 | LangChain 不管持久化原文 |
| BullMQ 任务编排 | 应用层职责 |

---

## 4. 存储分层

| 层级 | 组件 | 存什么 | 本期 | 后续 |
|------|------|--------|------|------|
| 同步缓冲 | Redis | API 配置、同步状态、任务队列 | ✅ | 去掉正文大 JSON |
| 事实源 | PostgreSQL | 文档、分块、ingest 状态 | ✅ | 统一主库 |
| 向量索引 | PostgreSQL pgvector | `document_chunks.embedding` + HNSW 索引 | ✅ | 向量路，无需独立向量库 |
| 原始文件 | `storage/uploads/` | PDF/DOCX 等二进制 | P1 | MinIO |
| 全文索引 | PG `tsvector` 或 Meilisearch | BM25 / 全文检索 | P2 | 全文路可先用 PG |
| 图谱 | PG 关系表 | 实体关系 | P2 | 图谱路也可放 PG |
| 缓存 | Redis | embedding 缓存、检索缓存 | ✅ | 可选 |

**关键决策**：Redis **不再**作为文档正文的主存储。有道 sync 完成后立即写入 PG，并 enqueue ingest job。

---

## 5. 核心数据模型

### 5.1 PostgreSQL 表结构

```sql
-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 文档表
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       VARCHAR(64)  NOT NULL,
  source        VARCHAR(16)  NOT NULL,  -- 'youdao' | 'upload'
  source_id     VARCHAR(128) NOT NULL, -- 有道 noteId / 上传 fileId
  title         TEXT         NOT NULL,
  file_name     TEXT,
  mime_type     VARCHAR(128),
  raw_path      TEXT,                  -- 上传文件路径，有道可为空
  plain_text    TEXT,                  -- 解析后纯文本
  content_hash  VARCHAR(64) NOT NULL,  -- sha256(plain_text)
  folder_id     VARCHAR(128),          -- 有道目录
  language      VARCHAR(16),
  page_count    INT,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- pending | parsing | chunked | embedded | indexed | failed
  error_message TEXT,
  synced_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, source_id)
);

CREATE INDEX idx_documents_user_source ON documents(user_id, source);
CREATE INDEX idx_documents_content_hash ON documents(content_hash);
CREATE INDEX idx_documents_status ON documents(status);

-- 分块表（三路检索锚点 + 向量字段）
CREATE TABLE document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INT  NOT NULL,
  text          TEXT NOT NULL,
  token_count   INT  NOT NULL,
  chunk_type    VARCHAR(32) NOT NULL,
  -- paragraph | section | code | table | list | page
  heading_path  TEXT[],               -- {'前端框架','Vue'}
  page_number   INT,
  chunk_hash    VARCHAR(64) NOT NULL, -- sha256(text)
  char_count    INT  NOT NULL,
  quality       VARCHAR(16) DEFAULT 'ok', -- ok | low | dropped
  embedding     vector(1536),         -- pgvector，步骤八写入
  embedded_at   TIMESTAMPTZ,          -- 向量化完成时间
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX idx_chunks_doc_id ON document_chunks(doc_id);
CREATE INDEX idx_chunks_hash ON document_chunks(chunk_hash);

-- 向量语义检索索引（HNSW，余弦相似度）
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 256);

-- 元数据过滤索引（检索时 WHERE 条件）
CREATE INDEX idx_chunks_doc_source ON document_chunks(doc_id);
-- documents 表上已有 user_id / source / folder_id 索引，JOIN 过滤
CREATE INDEX idx_documents_user_folder ON documents(user_id, folder_id);
CREATE INDEX idx_documents_source ON documents(user_id, source);

-- 全文检索预留（P2，可替代 Meilisearch）
-- ALTER TABLE document_chunks ADD COLUMN text_search tsvector;
-- CREATE INDEX idx_chunks_fts ON document_chunks USING gin(text_search);

-- Ingest 任务表
CREATE TABLE ingest_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id       VARCHAR(64) NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'queued',
  -- queued | running | success | failed
  attempt       INT  NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ingest_jobs_status ON ingest_jobs(status);
```

### 5.2 TypeScript 类型

```typescript
type DocumentSource = 'youdao' | 'upload'
type ChunkType = 'paragraph' | 'section' | 'code' | 'table' | 'list' | 'page'
type DocumentStatus = 'pending' | 'parsing' | 'chunked' | 'embedded' | 'indexed' | 'failed'

interface RawDocument {
  userId: string
  source: DocumentSource
  sourceId: string
  title: string
  fileName?: string
  mimeType: string
  rawContent: string | Buffer
  folderId?: string
  syncedAt?: string
}

interface ParsedDocument {
  docId: string
  plainText: string
  structure: DocumentStructure
  language?: string
  pageCount?: number
}

interface DocumentChunk {
  chunkId: string
  docId: string
  index: number
  text: string
  tokenCount: number
  chunkType: ChunkType
  headingPath: string[]
  pageNumber?: number
  metadata: ChunkMetadata
}

interface ChunkWithEmbedding {
  chunkId: string        // document_chunks.id
  docId: string
  text: string
  embedding: number[]    // 1536 维，写入 PG vector 列
  metadata: ChunkMetadata
}
```

> 向量与 chunk 同存 `document_chunks` 表，无需独立的 `VectorRecord` / payload 结构。检索时 JOIN `documents` 获取 `user_id`、`source`、`folder_id` 等过滤字段。
```

---

## 6. Pipeline 触发与编排

### 6.1 触发时机

| 事件 | 动作 |
|------|------|
| 有道 sync 完成，笔记 `content` 变化 | upsert `documents` → enqueue `ingest_job` |
| 有道 sync，笔记未变化 | 跳过（`content_hash` 相同） |
| 本地上传完成 | 存 `storage/` → insert `documents` → enqueue |
| 手动重建索引 | `POST /knowledge/reindex` → 批量 enqueue |

### 6.2 编排服务

```typescript
class IngestionService {
  async ingestDocument(docId: string): Promise<IngestResult> {
    const doc = await this.docRepo.findById(docId)

    // Step 1-3
    const parsed = await this.parse(doc)
    const cleaned = await this.clean(parsed)
    const structured = await this.extractStructure(cleaned)

    // Step 4-5
    const chunks = await this.chunk(structured)
    const enriched = await this.enrichMetadata(chunks, doc)

    // Step 6-7
    const validated = await this.validateAndDedup(enriched, doc.userId)
    const vectors = await this.embed(validated)

    // Step 8：先落 chunk，再写 embedding
    await this.chunkRepo.saveBatch(validated)
    await this.pgVector.upsertEmbeddings(vectors)
    await this.docRepo.updateStatus(docId, 'indexed')

    return { docId, chunkCount: validated.length }
  }
}
```

### 6.3 任务队列

使用 **BullMQ**（基于现有 Redis）：

```typescript
// Queue: knowledge:ingest
interface IngestJobData {
  docId: string
  userId: string
  force?: boolean  // 忽略 content_hash，强制重跑
}
```

配置：
- 并发：2（避免 embedding API 限流）
- 重试：3 次，指数退避
- 超时：单文档 10 分钟

### 6.4 流程时序

```mermaid
sequenceDiagram
    participant API as KnowledgeController
    participant SVC as KnowledgeService
    participant PG as PostgreSQL
    participant Q as BullMQ
    participant W as IngestionProcessor
    participant EMB as Embedding API

    API->>SVC: POST /youdao/sync
    SVC->>SVC: 拉取有道笔记
    SVC->>PG: upsert documents (changed only)
    SVC->>Q: enqueue ingest jobs
    API-->>API: 返回 synced/skipped

    Q->>W: process(docId)
    W->>PG: status = running
    W->>W: Step 1-7
    W->>EMB: embed batches
    W->>PG: INSERT chunks + UPDATE embedding
    W->>PG: status = indexed
```

---

## 7. 步骤一：按文档类型解析

### 7.1 目标

将不同格式的原始输入统一为 `ParsedDocument.plainText`，并保留结构解析所需的中间信息。

### 7.2 类型检测

```typescript
function detectMimeType(doc: RawDocument): string {
  // 优先级：显式 mimeType > 扩展名 > source 默认值
}
```

| 扩展名 | MIME | 解析器 |
|--------|------|--------|
| `.note` / 有道 | `text/plain` | `YoudaoTextParser` |
| `.md` | `text/markdown` | `MarkdownParser` |
| `.txt` | `text/plain` | `PlainTextParser` |
| `.pdf` | `application/pdf` | `PdfParser` |
| `.docx` | `application/vnd...docx` | `DocxParser` |
| `.doc` | `application/msword` | `DocParser`（或转 docx） |
| `.csv` | `text/csv` | `CsvParser` |
| `.xlsx` | `application/vnd...sheet` | `XlsxParser` |
| `.pptx` | `application/vnd...presentation` | `PptxParser` |

### 7.3 解析器接口

```typescript
interface DocumentParser {
  readonly name: string
  supports(doc: RawDocument): boolean
  parse(doc: RawDocument): Promise<ParseResult>
}

interface ParseResult {
  plainText: string
  structureHints?: StructureHints  // 预提取的标题/页码等
  pageCount?: number
  warnings?: string[]
}
```

### 7.4 各解析器详细设计

#### YoudaoTextParser（P0 优先，自研）

```
输入：有道 getNoteTextContent 返回的 content 字段
处理：
  1. 若为 JSON，取 content 字段
  2. 若含 HTML 标签，标记 needsHtmlClean=true（交给步骤二）
  3. 首行或文件名去 .note 后缀作为 title
输出：纯文本 + structureHints.headings（# / ## 正则提取）
```

#### MarkdownParser（LangChain + 自研）

```
P0：TextLoader 读文件 → Document
P1：MarkdownHeaderTextSplitter 预提取 structureHints
输出：LangChain Document { pageContent, metadata }
```

#### PdfParser（LangChain）

```
依赖：@langchain/community PDFLoader
处理：
  const loader = new PDFLoader(filePath, { splitPages: true })
  const docs = await loader.load()   // 每页一个 Document
  metadata.pageNumber = doc.metadata.loc.pageNumber
注意：扫描版 PDF 需 OCR（本期不做，标记 failed）
```

#### DocxParser（LangChain，P1）

```
依赖：@langchain/community DocxLoader
const loader = new DocxLoader(filePath)
const docs = await loader.load()
```

#### PlainTextParser（LangChain）

```
依赖：TextLoader
const loader = new TextLoader(filePath)
const docs = await loader.load()
```

### 7.5 解析器注册表

```typescript
@Injectable()
class ParserRegistry {
  private parsers: DocumentParser[] = [
    youdaoParser,
    markdownParser,
    pdfParser,
    docxParser,
    plainTextParser,
    // ...
  ]

  resolve(doc: RawDocument): DocumentParser {
    const parser = this.parsers.find(p => p.supports(doc))
    if (!parser) throw new UnsupportedFormatError(doc.mimeType)
    return parser
  }
}
```

### 7.6 错误处理

| 错误 | 处理 |
|------|------|
| 格式不支持 | `documents.status = failed`，记录 error_message |
| 解析结果为空 | failed |
| 文件损坏 | failed，保留 raw_path 供人工排查 |
| 部分页失败（PDF） | 记录 warnings，继续处理成功页 |

---

## 8. 步骤二：文本清洗

### 8.1 目标

去除噪声，规范化文本，提升 embedding 质量。

### 8.2 清洗流水线

```typescript
interface TextCleaner {
  name: string
  appliesTo: 'all' | DocumentSource | string  // mime
  clean(text: string, ctx: CleanContext): string
}
```

按顺序执行：

| 序号 | 清洗器 | 规则 | 适用 |
|------|--------|------|------|
| 1 | `HtmlTagStripper` | 去除 HTML 标签，`<br>` → 换行 | 有道、docx |
| 2 | `HtmlEntityDecoder` | `&nbsp;` `&lt;` 等解码 | 同上 |
| 3 | `ControlCharRemover` | 移除 `\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F` | 全部 |
| 4 | `WhitespaceNormalizer` | 连续空行 → 最多 2 个换行；行尾空格 trim | 全部 |
| 5 | `RepeatedLineRemover` | 出现率 > 80% 的相同行（页眉页脚） | PDF |
| 6 | `ZeroWidthRemover` | 移除零宽字符 | 全部 |
| 7 | `GarbledDetector` | 非可读字符占比 > 30% → 标记 `quality=low` | 全部 |

### 8.3 清洗上下文

```typescript
interface CleanContext {
  source: DocumentSource
  mimeType: string
  pageCount?: number
  lines: string[]          // 按行分析页眉页脚
  stats: {
    charCountBefore: number
    charCountAfter: number
    removedLines: number
  }
}
```

### 8.4 输出

```typescript
interface CleanedDocument {
  plainText: string
  language: string         // franc 检测，默认 'zh'
  quality: 'ok' | 'low'
  stats: CleanStats
}
```

### 8.5 配置

```env
CLEAN_MAX_BLANK_LINES=2
CLEAN_HEADER_FOOTER_THRESHOLD=0.8
CLEAN_GARBLED_THRESHOLD=0.3
```

---

## 9. 步骤三：内容结构提取

### 9.1 目标

从清洗后文本中提取层级结构，为分块策略提供语义边界。

### 9.2 结构模型

```typescript
interface DocumentStructure {
  title: string
  sections: Section[]
  blocks: ContentBlock[]
}

interface Section {
  level: number           // 1-6 对应 h1-h6
  title: string
  startOffset: number
  endOffset: number
  parentIndex?: number
}

interface ContentBlock {
  type: ChunkType
  text: string
  startOffset: number
  endOffset: number
  sectionIndex?: number
  pageNumber?: number
  meta?: Record<string, unknown>
}
```

### 9.3 提取策略

| 来源 | 方法 |
|------|------|
| Markdown | 复用 marked AST，直接映射 block |
| 有道笔记 | 正则匹配 `^#{1,6}\s` 或独立标题行；首行作 title |
| PDF | 按 `--- page N ---` 分段；页内按空行分段 |
| Word | mammoth heading 样式 → section |
| 纯文本 | 双换行分段；无标题则 `sections=[]` |

### 9.4 提取器接口

```typescript
interface StructureExtractor {
  extract(
    plainText: string,
    hints?: StructureHints,
    source?: DocumentSource,
  ): DocumentStructure
}
```

### 9.5 标题路径生成

分块时，每个 block 继承当前 section 栈：

```
文档标题: "Vue3 的 diff 算法"
章节路径: ["前端框架", "Vue", "Vue3 的 diff 算法"]

→ chunk.headingPath = ["前端框架", "Vue", "Vue3 的 diff 算法"]
```

### 9.6 边界情况

| 情况 | 处理 |
|------|------|
| 无标题 | `headingPath = [document.title]` |
| 标题层级跳跃（h1 → h4） | 自动补全中间层级或压平 |
| 代码块内含 `#` | Markdown AST 级别处理，不走正则 |
| 表格 | 独立 `table` block，不拆散到 paragraph |

---

## 10. 步骤四：文本分块

### 10.1 目标

将结构化文档切分为适合 embedding 的 chunk，**不同内容类型使用不同策略**。核心分块器使用 **LangChain Text Splitters**，自研层只做策略路由和 metadata 注入。

### 10.2 全局参数

```env
INGEST_CHUNK_SIZE=512        # 目标 token 数
INGEST_CHUNK_OVERLAP=64      # 重叠 token 数
INGEST_MIN_CHUNK_CHARS=20
INGEST_MAX_CHUNK_TOKENS=2000
```

Token 计数：LangChain Splitter 内部按 `chunkSize` 字符/长度计算；中文场景 `chunkSize` 建议按字符数配置（512 字符 ≈ 300–400 token）。

### 10.3 LangChain Splitter 映射

| 策略 | LangChain 类 | 包 |
|------|-------------|-----|
| 普通段落 | `RecursiveCharacterTextSplitter` | `@langchain/textsplitters` |
| Markdown 章节 | `MarkdownHeaderTextSplitter` | `@langchain/textsplitters` |
| 代码块 | `RecursiveCharacterTextSplitter`（overlap=0） | `@langchain/textsplitters` |
| Token 精确切分 | `TokenTextSplitter` | `@langchain/textsplitters`（可选） |
| 语义分块（P2） | `SemanticChunker` | `@langchain/experimental`（可选） |

### 10.4 分块策略注册（薄封装）

```typescript
import { RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter } from '@langchain/textsplitters'
import type { Document } from '@langchain/core/documents'

interface ChunkStrategy {
  name: string
  supports(block: ContentBlock): boolean
  split(block: ContentBlock, baseMetadata: Record<string, unknown>): Promise<Document[]>
}
```

### 10.5 各策略详细设计

#### 10.5.1 RecursiveCharacterTextSplitter（paragraph）

```typescript
const paragraphSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 512,
  chunkOverlap: 64,
  separators: ['\n\n', '\n', '。', '！', '？', '. ', ' ', ''],
})
// 用法
const chunks = await paragraphSplitter.splitDocuments([doc])
```

#### 10.5.2 MarkdownHeaderTextSplitter（section / markdown）

```typescript
const mdSplitter = new MarkdownHeaderTextSplitter({
  headersToSplitOn: [
    ['#', 'h1'], ['##', 'h2'], ['###', 'h3'],
  ],
})
// 先按标题切 → 超长 section 再交给 paragraphSplitter
const headerChunks = await mdSplitter.splitText(mdText)
```

#### 10.5.3 CodeBlockSplitter（code）

```typescript
const codeSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,
  chunkOverlap: 0,
  separators: ['\n\n', '\n'],
})
// metadata.chunkType = 'code'
```

#### 10.5.4 TableAwareSplitter（table，自研）

```
LangChain 无专用表格 Splitter，自研薄封装：
  1. 提取表头行
  2. 按数据行分组（每 20 行一组）
  3. 每块前置表头 → new Document({ pageContent, metadata: { chunkType: 'table' } })
```

#### 10.5.5 ListSplitter（list，自研）

```
按列表项切分，输出 Document[]，metadata.chunkType = 'list'
```

#### 10.5.6 PageSplitter（page，配合 PDFLoader）

```
PDFLoader({ splitPages: true }) 已在步骤一按页产出 Document
每页 Document 再交给 paragraphSplitter
metadata.pageNumber 来自 loader
```

#### 10.5.7 SingleChunk（短文档）

```
if (doc.pageContent.length < 300 * 1.5) → 不切分，直接作为单 Document 输出
```

### 10.6 分块决策流程

```mermaid
flowchart TD
    A[DocumentStructure.blocks] --> B{遍历 block}
    B --> C{block.type}
    C -->|code| D[CodeBlockSplitter]
    C -->|table| E[TableAwareSplitter]
    C -->|list| F[ListSplitter]
    C -->|section| G[SemanticSectionSplitter]
    C -->|paragraph| H[RecursiveCharacterSplitter]
    C -->|page| I[PageSplitter]
    D & E & F & G & H & I --> J{token > MAX?}
    J -->|是| H
    J -->|否| K[RawChunk]
    K --> L[全文 < 300 tokens?]
    L -->|是| M[合并为 SingleChunk]
    L -->|否| N[输出 Document 列表]
```

### 10.7 输出

分块结果为 `Document[]`，统一格式：

```typescript
import type { Document } from '@langchain/core/documents'

// 每个 chunk
{
  pageContent: string,
  metadata: {
    docId, userId, source, chunkIndex, chunkType,
    headingPath, pageNumber, ...
  }
}
```

---

## 11. 步骤五：元数据附加

### 11.1 目标

为每个 chunk 附加完整元数据，供向量库 filter 和检索结果展示。

### 11.2 元数据字段

```typescript
interface ChunkMetadata {
  // 文档级
  userId: string
  docId: string
  source: DocumentSource
  sourceId: string
  title: string
  fileName?: string
  mimeType: string
  contentHash: string       // 文档级 sha256
  chunkHash: string         // chunk 级 sha256

  // 结构级
  chunkIndex: number
  chunkType: ChunkType
  headingPath: string[]
  pageNumber?: number
  language: string
  tokenCount: number
  charCount: number

  // 业务级
  folderId?: string
  tags: string[]
  ingestVersion: string     // pipeline 版本，如 '1.0.0'
  createdAt: string
  updatedAt: string
}
```

### 11.3 自动标签规则

| 来源 | 规则 |
|------|------|
| 有道 | `folderId` 映射目录名 → tags；文件名关键词 |
| 上传 | 扩展名标签（`pdf`, `markdown`）；文件名分词 |
| 通用 | `headingPath` 前两级加入 tags |

```typescript
// 示例
{
  folderId: "前端框架",
  tags: ["前端框架", "Vue", "markdown"]
}
```

### 11.4 Enricher 实现

元数据写入 LangChain `Document.metadata`，同时落 PG `document_chunks`：

```typescript
import type { Document } from '@langchain/core/documents'

@Injectable()
class MetadataEnricher {
  enrich(
    chunks: Document[],
    doc: DocumentRow,
    pipelineVersion: string,
  ): Document[] {
    const contentHash = doc.content_hash
    const now = new Date().toISOString()

    return chunks.map((chunk, i) => {
      const chunkHash = sha256(chunk.pageContent)
      return new Document({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          chunkId: `${doc.id}:${i}`,
          docId: doc.id,
          userId: doc.user_id,
          source: doc.source,
          sourceId: doc.source_id,
          title: doc.title,
          contentHash,
          chunkHash,
          chunkIndex: i,
          charCount: chunk.pageContent.length,
          folderId: doc.folder_id,
          tags: this.buildTags(doc, chunk),
          ingestVersion: pipelineVersion,
          createdAt: now,
          updatedAt: now,
        },
      })
    })
  }
}
```

---

## 12. 步骤六：向量化

### 12.1 目标

将 chunk 文本转换为 embedding 向量，使用 **LangChain `OpenAIEmbeddings`**。

### 12.2 Embedding 提供方（LangChain）

```typescript
import { OpenAIEmbeddings } from '@langchain/openai'

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.EMBEDDING_API_KEY,
  configuration: { baseURL: process.env.EMBEDDING_BASE_URL },
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  batchSize: 32,
})

// 批量
const vectors = await embeddings.embedDocuments(texts)
// 单条 query
const queryVector = await embeddings.embedQuery(query)
```

推荐配置：

```env
EMBEDDING_API_KEY=<同 OPENROUTER 或独立 key>
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
EMBEDDING_BATCH_SIZE=32
```

### 12.3 输入文本构造

为提升检索效果，embedding 输入拼接上下文，**pageContent 仍保留原始 chunk 文本**：

```typescript
function buildEmbedInput(doc: Document): string {
  const { title, headingPath } = doc.metadata
  const path = Array.isArray(headingPath) ? headingPath.join(' > ') : ''
  return path
    ? `${title} > ${path}\n${doc.pageContent}`
    : `${title}\n${doc.pageContent}`
}
```

### 12.4 批量与缓存

```typescript
class EmbeddingService {
  constructor(private readonly embeddings: OpenAIEmbeddings) {}

  async embedDocuments(docs: Document[]): Promise<{ doc: Document; vector: number[] }[]> {
    const uncached: Document[] = []
    const results: { doc: Document; vector: number[] }[] = []

    for (const doc of docs) {
      const cached = await this.cache.get(doc.metadata.chunkHash)
      if (cached) {
        results.push({ doc, vector: cached })
      } else {
        uncached.push(doc)
      }
    }

    const inputs = uncached.map(buildEmbedInput)
    const vectors = await this.embeddings.embedDocuments(inputs)

    for (let i = 0; i < uncached.length; i++) {
      await this.cache.set(uncached[i].metadata.chunkHash, vectors[i], TTL_7D)
      results.push({ doc: uncached[i], vector: vectors[i] })
    }

    return results
  }
}
```

### 12.5 错误处理

| 错误 | 处理 |
|------|------|
| API 限流 429 | 指数退避重试，最多 3 次 |
| 单条超长 | 截断到 8192 token 再 embed |
| 维度不匹配 | 抛错，停止 ingest |

---

## 13. 步骤七：质量校验与去重

> 此步骤 LangChain 不提供，保持自研。

### 13.1 质量校验

```typescript
interface QualityRule {
  name: string
  check(chunk: Document): QualityResult
}

interface QualityResult {
  pass: boolean
  quality: 'ok' | 'low'
  reason?: string
}
```

| 规则 | 条件 | 处理 |
|------|------|------|
| `MinLengthRule` | `charCount < 20` | 丢弃 |
| `MaxTokenRule` | `tokenCount > 2000` | 强制二次切分后重新校验 |
| `EmptyRule` | trim 后为空 | 丢弃 |
| `GarbledRule` | 可读字符 < 70% | 标记 `low`，默认丢弃 |
| `RepeatedCharRule` | 单字符重复 > 50% | 丢弃 |
| `DuplicateLineRule` | 仅含相同行 | 丢弃 |

```typescript
class QualityValidator {
  validate(chunks: Document[]): Document[] {
    return chunks
      .map(chunk => this.applyRules(chunk))
      .filter(chunk => chunk.metadata.quality !== 'dropped')
  }
}
```

### 13.2 去重策略

三层去重，按顺序执行：

```mermaid
flowchart TD
    A[新 chunk] --> B{L1: 文档 contentHash 未变?}
    B -->|是且非 force| C[跳过整篇 ingest]
    B -->|否| D{L2: chunkHash 已存在?}
    D -->|是| E[跳过该 chunk]
    D -->|否| F{L3: 向量 cosine > 0.95?}
    F -->|是| G[标记 duplicate_of，跳过]
    F -->|否| H[进入向量化]
```

#### L1 文档级

```sql
-- sync 时
SELECT id, content_hash FROM documents
WHERE user_id = $1 AND source = 'youdao' AND source_id = $2
-- hash 相同 → 不 enqueue
```

#### L2 Chunk 级

```sql
SELECT id FROM document_chunks
WHERE chunk_hash = $1 AND doc_id IN (
  SELECT id FROM documents WHERE user_id = $2
)
-- 存在 → 跳过该 chunk 的 embed 和 upsert
```

#### L3 语义级（可选，默认关闭）

```
对新 chunk 在 PG 中做向量 top1 检索
若 score > INGEST_DEDUP_SIMILARITY (0.95) → 视为重复
```

成本高，建议 P2 再开启。

### 13.3 输出统计

```typescript
interface DedupResult {
  accepted: Document[]
  stats: {
    input: number
    droppedQuality: number
    skippedHash: number
    skippedSemantic: number
    accepted: number
  }
}
```

---

## 14. 步骤八：写入向量（pgvector）

### 14.1 选型：PostgreSQL + pgvector

理由：
- **架构简化**：文档、分块、向量、元数据全在 PG，无需维护 Milvus 等独立组件
- **事务一致**：chunk 插入与 embedding 写入可在同一事务内完成
- **过滤自然**：元数据过滤用标准 SQL `WHERE` + `JOIN`，比 Milvus expr 更直观
- **规模够用**：个人知识库（数千～数万 chunk）HNSW 索引性能完全足够
- **LangChain 支持**：`@langchain/community/vectorstores/pgvector` 可直接对接

`docker-compose.yml` 扩展：

```yaml
postgres:
  image: pgvector/pgvector:pg16
  container_name: postgres-membot
  restart: always
  ports:
    - '5432:5432'
  environment:
    POSTGRES_USER: membot
    POSTGRES_PASSWORD: membot
    POSTGRES_DB: membot
  volumes:
    - ./volumes/postgres:/var/lib/postgresql/data
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U membot -d membot']
    interval: 5s
    timeout: 5s
    retries: 5
```

### 14.2 向量字段与索引

向量存在 `document_chunks.embedding` 列（见 §5.1），与 `text`、`chunk_hash` 等同表。

| 配置项 | 值 |
|--------|-----|
| 列类型 | `vector(1536)` |
| 距离算子 | `<=>`（余弦距离） |
| 索引类型 | HNSW（`vector_cosine_ops`） |
| 相似度换算 | `score = 1 - (embedding <=> query_vector)` |

### 14.3 PgVectorRepository 接口

```typescript
interface PgVectorRepository {
  upsertEmbeddings(
    chunks: Array<{ chunkId: string; embedding: number[] }>,
  ): Promise<void>

  clearEmbeddingsByDocId(docId: string): Promise<void>

  similaritySearch(
    queryVector: number[],
    filter: VectorFilter,
    topK: number,
    scoreThreshold?: number,
  ): Promise<ScoredChunk[]>
}

interface VectorFilter {
  userId: string
  source?: DocumentSource[]
  folderId?: string
  chunkType?: ChunkType[]
  docId?: string
}
```

### 14.4 写入流程（推荐：SQL 直写）

```typescript
class PgVectorRepository {
  async upsertEmbeddings(
    chunks: Array<{ chunkId: string; embedding: number[] }>,
  ): Promise<void> {
    const sql = `
      UPDATE document_chunks
      SET embedding = $2::vector,
          embedded_at = NOW()
      WHERE id = $1
    `
    for (const batch of chunkArray(chunks, 50)) {
      await Promise.all(
        batch.map(c =>
          this.pool.query(sql, [c.chunkId, `[${c.embedding.join(',')}]`]),
        ),
      )
    }
  }

  async clearEmbeddingsByDocId(docId: string): Promise<void> {
    await this.pool.query(
      `UPDATE document_chunks SET embedding = NULL, embedded_at = NULL WHERE doc_id = $1`,
      [docId],
    )
  }
}
```

**步骤八完整流程**：

```
1. INSERT document_chunks（步骤四～五已完成，embedding = NULL）
2. embedDocuments() 得到向量
3. UPDATE document_chunks SET embedding = $vec WHERE id = $chunkId
4. documents.status = 'indexed'
```

### 14.5 语义检索 SQL

```typescript
async similaritySearch(
  queryVector: number[],
  filter: VectorFilter,
  topK: number,
  scoreThreshold = 0.7,
): Promise<ScoredChunk[]> {
  const conditions = ['d.user_id = $2', 'c.embedding IS NOT NULL']
  const params: unknown[] = [
    `[${queryVector.join(',')}]`,
    filter.userId,
  ]

  if (filter.source?.length) {
    params.push(filter.source)
    conditions.push(`d.source = ANY($${params.length})`)
  }
  if (filter.folderId) {
    params.push(filter.folderId)
    conditions.push(`d.folder_id = $${params.length}`)
  }
  if (filter.chunkType?.length) {
    params.push(filter.chunkType)
    conditions.push(`c.chunk_type = ANY($${params.length})`)
  }
  if (filter.docId) {
    params.push(filter.docId)
    conditions.push(`c.doc_id = $${params.length}`)
  }

  params.push(topK)

  const sql = `
    SELECT
      c.id, c.text, c.chunk_type, c.chunk_index, c.heading_path,
      d.title, d.source, d.folder_id,
      1 - (c.embedding <=> $1::vector) AS score
    FROM document_chunks c
    JOIN documents d ON d.id = c.doc_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $${params.length}
  `

  const rows = await this.pool.query(sql, params)
  return rows
    .filter(r => r.score >= scoreThreshold)
    .map(r => ({ ...r, metadata: buildMetadata(r) }))
}
```

### 14.6 LangChain PGVector 方式（可选，快速验证）

```typescript
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector'

const store = await PGVectorStore.initialize(embeddings, {
  pool,
  tableName: 'document_chunks',
  columns: {
    idColumnName: 'id',
    vectorColumnName: 'embedding',
    contentColumnName: 'text',
  },
})

await store.addDocuments(chunks)
const results = await store.similaritySearchWithScore(query, 5)
```

> LangChain PGVector 默认会自建表结构，与我们的 `document_chunks` schema 可能冲突。**P0 推荐 SQL 直写**，LangChain 只用于 Splitter 和 Embeddings。

### 14.7 增量更新策略

```
文档 content_hash 变化时：
  1. DELETE FROM document_chunks WHERE doc_id = $1
  2. 重新执行 Step 4-8（INSERT chunks + UPDATE embedding）
  3. documents.status = 'indexed'
```

### 14.8 检索接口（供 Chat 使用）

```typescript
// KnowledgeRetrievalService
async search(req: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
  const queryVector = await this.embeddings.embedQuery(req.query)

  const hits = await this.pgVector.similaritySearch(
    queryVector,
    { userId: req.userId, ...req.filter },
    req.topK ?? 5,
    req.scoreThreshold ?? 0.7,
  )

  // 向量与 text 同表，无需额外回表
  return { chunks: hits }
}
```

### 14.9 pgvector vs Milvus 对比（本项目）

| 维度 | pgvector | Milvus |
|------|----------|--------|
| 部署复杂度 | 低（一个 PG 容器） | 高（独立服务 + 依赖） |
| 数据一致性 | 事务保证 | 需同步 PG ↔ Milvus |
| 个人知识库规模 | ✅ 足够 | 过度 |
| 元数据过滤 | SQL WHERE | expr 表达式 |
| 百万级向量 | 需调优 | 更强 |

**结论**：MemBot 个人知识库场景，pgvector 是更合理的选择。

---

## 15. 模块与目录规划

```
end/src/knowledge/
├── knowledge.module.ts
├── knowledge.controller.ts
├── knowledge.service.ts              # 有道 sync（改造：写 PG + enqueue）
├── types.ts
├── youdao-mcp.client.ts
│
├── ingestion/
│   ├── ingestion.module.ts
│   ├── ingestion.service.ts          # Pipeline 编排
│   ├── ingestion.processor.ts        # BullMQ worker
│   │
│   ├── parsers/
│   │   ├── parser.registry.ts
│   │   ├── parser.interface.ts
│   │   ├── youdao-text.parser.ts     # P0
│   │   ├── plain-text.parser.ts      # P0
│   │   ├── markdown.parser.ts        # P1
│   │   └── pdf.parser.ts             # P1
│   │
│   ├── cleaners/
│   │   ├── cleaner.pipeline.ts
│   │   └── rules/
│   │       ├── html-strip.rule.ts
│   │       ├── whitespace.rule.ts
│   │       └── garbled.rule.ts
│   │
│   ├── extractors/
│   │   ├── structure.extractor.ts
│   │   └── markdown.extractor.ts
│   │
│   ├── chunkers/
│   │   ├── chunker.registry.ts       # 策略路由
│   │   ├── langchain-splitters.ts    # LangChain Splitter 工厂
│   │   └── table.chunker.ts          # 表格自研
│   │
│   ├── enrichers/
│   │   └── metadata.enricher.ts
│   │
│   ├── embedders/
│   │   └── embedding.service.ts      # 封装 OpenAIEmbeddings + 缓存
│   │
│   ├── validators/
│   │   ├── quality.validator.ts
│   │   └── dedup.service.ts
│   │
│   └── stores/
│       ├── document.repository.ts    # PG documents
│       ├── chunk.repository.ts       # PG chunks
│       └── pgvector.repository.ts    # pgvector 写入与语义检索
│
└── retrieval/
    ├── retrieval.module.ts
    ├── knowledge-retrieval.service.ts
    └── knowledge-search.tool.ts      # ChatService 调用
```

---

## 16. 配置项

`.env` 扩展：

```env
# PostgreSQL
DATABASE_URL=postgresql://membot:membot@localhost:5432/membot

# Embedding（向量写入 document_chunks.embedding，维度需与 pgvector 列一致）
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
EMBEDDING_BATCH_SIZE=32

# Ingestion
INGEST_CHUNK_SIZE=512
INGEST_CHUNK_OVERLAP=64
INGEST_MIN_CHUNK_CHARS=20
INGEST_MAX_CHUNK_TOKENS=2000
INGEST_DEDUP_SIMILARITY=0.95
INGEST_PIPELINE_VERSION=1.0.0
INGEST_CONCURRENCY=2

# Upload
UPLOAD_DIR=./storage/uploads
UPLOAD_MAX_SIZE_MB=20
```

---

## 17. API 设计

### 17.1 现有接口改造

| 接口 | 改造 |
|------|------|
| `POST /knowledge/youdao/sync` | sync 后 upsert PG + enqueue ingest |
| `GET /knowledge/youdao/status` | 增加 `indexedCount`, `pendingIngest` |

### 17.2 新增接口

```
POST /knowledge/upload
  Content-Type: multipart/form-data
  Body: files[]
  Response: { files: [{ fileId, status: 'processing' }] }

GET /knowledge/ingest/status?userId=
  Response: {
    total, indexed, pending, failed,
    jobs: [{ docId, title, status, error }]
  }

POST /knowledge/reindex
  Body: { userId, source?, docId? }
  Response: { enqueued: number }

POST /knowledge/search
  Body: { query, userId, topK?, filter? }
  Response: { chunks: [{ text, score, metadata }] }
```

---

## 18. 实施阶段

### P0：有道笔记 → pgvector（本期）

| 任务 | 说明 |
|------|------|
| docker-compose 增加 `pgvector/pgvector:pg16` | 基础设施 |
| 安装 `@langchain/community` `@langchain/textsplitters` `pg` | 依赖 |
| PG 迁移：启用 `vector` 扩展 + 建表 + HNSW 索引 | documents / document_chunks / ingest_jobs |
| 改造 `syncYoudaoNotes` | 写 PG 替代 Redis 正文 |
| YoudaoTextParser（自研） | 有道解析 → LangChain Document |
| Cleaner + StructureExtractor | 清洗和结构 |
| LangChain RecursiveCharacterTextSplitter + MarkdownHeaderTextSplitter | 分块 |
| MetadataEnricher | 元数据写入 Document.metadata |
| OpenAIEmbeddings（OpenRouter） | 向量化 |
| QualityValidator + HashDedup | 校验去重 |
| PgVectorRepository | UPDATE document_chunks.embedding |
| BullMQ IngestionProcessor | 异步任务 |
| `knowledge_search` 接入 ChatService | SQL 语义检索 |

### P1：本地上传

| 任务 | 说明 |
|------|------|
| `POST /knowledge/upload` | 文件上传 |
| LangChain PDFLoader + TextLoader | 扩展解析 |
| 前端 LocalUploadTab 接真实 API | 上传 |

### P2：增强

| 任务 | 说明 |
|------|------|
| DocxLoader / 其他 LangChain Loader | 扩展格式 |
| 语义去重 L3（pgvector top1） | 可选开启 |
| PG tsvector 或 Meilisearch 全文索引 | 二路检索 |
| 监控指标 + LangSmith 追踪 | 可观测 |

---

## 附录 A：Redis 职责收缩对照

| Key | 现在 | 目标 |
|-----|------|------|
| `knowledge:youdao:config:{userId}` | API 配置 | 保留 |
| `knowledge:youdao:meta:{userId}` | 同步状态 | 保留 |
| `knowledge:youdao:notes:{userId}` | 整包笔记 JSON | **删除**，迁移到 PG |
| `embed:cache:{chunkHash}` | — | 新增 |
| `knowledge:ingest` (BullMQ) | — | 新增 |

---

## 附录 B：chunk_id 作为三路锚点

后续接入全文路（Meilisearch）和图谱路（Neo4j）时，均以 `document_chunks.id` 为主键：

```
document_chunks.id
  ├── pgvector 向量行（embedding 列）
  ├── Meilisearch / PG tsvector 文档 id（P2 全文路）
  └── 图谱节点引用（P2，可存 PG 关系表）
```

向量已在 PG 内；后续全文路、图谱路 fan-out 时复用同一 `chunk_id`，无需独立向量库。
