import { Module } from '@nestjs/common'
import { ChunkService } from './ingestion/chunkers/chunk.service'
import { TextCleaner } from './ingestion/cleaners/text-cleaner'
import { EmbeddingService } from './ingestion/embedders/embedding.service'
import { MetadataEnricher } from './ingestion/enrichers/metadata.enricher'
import { IngestionProcessor } from './ingestion/ingestion.processor'
import { IngestionService } from './ingestion/ingestion.service'
import { DocxParser } from './ingestion/parsers/docx.parser'
import { MarkdownParser } from './ingestion/parsers/markdown.parser'
import { ParserRegistry } from './ingestion/parsers/parser.registry'
import { PdfParser } from './ingestion/parsers/pdf.parser'
import { PlainTextParser } from './ingestion/parsers/plain-text.parser'
import { YoudaoTextParser } from './ingestion/parsers/youdao-text.parser'
import { XlsxParser } from './ingestion/parsers/xlsx.parser'
import { ChunkRepository } from './ingestion/stores/chunk.repository'
import { DocumentRepository } from './ingestion/stores/document.repository'
import { IngestJobRepository } from './ingestion/stores/ingest-job.repository'
import { PgVectorRepository } from './ingestion/stores/pgvector.repository'
import { QualityValidator } from './ingestion/validators/quality.validator'
import { KnowledgeController } from './knowledge.controller'
import { KnowledgeService } from './knowledge.service'
import { ElasticsearchClient } from './retrieval/clients/elasticsearch.client'
import { Neo4jClient } from './retrieval/clients/neo4j.client'
import { Bm25Retriever } from './retrieval/bm25.retriever'
import { GraphRetriever } from './retrieval/graph.retriever'
import { HybridSearchService } from './retrieval/hybrid-search.service'
import { IndexSyncService } from './retrieval/index-sync.service'
import { VectorRetriever } from './retrieval/vector.retriever'
import { SearchController } from './search.controller'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'

@Module({
  controllers: [KnowledgeController, UploadController, SearchController],
  providers: [
    KnowledgeService,
    UploadService,
    DocumentRepository,
    ChunkRepository,
    PgVectorRepository,
    IngestJobRepository,
    PdfParser,
    DocxParser,
    XlsxParser,
    PlainTextParser,
    MarkdownParser,
    YoudaoTextParser,
    ParserRegistry,
    TextCleaner,
    ChunkService,
    MetadataEnricher,
    QualityValidator,
    EmbeddingService,
    IngestionService,
    IngestionProcessor,
    ElasticsearchClient,
    Neo4jClient,
    VectorRetriever,
    Bm25Retriever,
    GraphRetriever,
    HybridSearchService,
    IndexSyncService,
  ],
  exports: [KnowledgeService, IngestionService, HybridSearchService, IndexSyncService],
})
export class KnowledgeModule {}
