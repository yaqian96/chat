import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import neo4j, { Driver } from 'neo4j-driver'

@Injectable()
export class Neo4jClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jClient.name)
  private driver: Driver | null = null
  private available = false

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const uri = this.config.get<string>('NEO4J_URI')
    const user = this.config.get<string>('NEO4J_USER', 'neo4j')
    const password = this.config.get<string>('NEO4J_PASSWORD')

    if (!uri || !password) {
      this.logger.warn('NEO4J_URI / NEO4J_PASSWORD not set — GraphRAG disabled')
      return
    }

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        encrypted: false,
      })
      await this.driver.verifyConnectivity()
      await this.ensureSchema()
      this.available = true
      this.logger.log(`Neo4j connected: ${uri}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`Neo4j unavailable: ${message}`)
      await this.driver?.close()
      this.driver = null
    }
  }

  async onModuleDestroy() {
    await this.driver?.close()
  }

  isAvailable(): boolean {
    return this.available && this.driver !== null
  }

  getDriver(): Driver {
    if (!this.driver) throw new Error('Neo4j is not available')
    return this.driver
  }

  private async ensureSchema() {
    const session = this.driver!.session()
    try {
      await session.run(`
        CREATE CONSTRAINT chunk_id IF NOT EXISTS
        FOR (c:Chunk) REQUIRE c.id IS UNIQUE
      `)
      await session.run(`
        CREATE CONSTRAINT doc_id IF NOT EXISTS
        FOR (d:Document) REQUIRE d.id IS UNIQUE
      `)
      await session.run(`
        CREATE CONSTRAINT entity_name_unique IF NOT EXISTS
        FOR (e:Entity) REQUIRE e.name IS UNIQUE
      `)
      await session.run(`
        CREATE FULLTEXT INDEX chunk_text IF NOT EXISTS
        FOR (c:Chunk) ON EACH [c.text, c.title]
      `)
      await session.run(`
        CREATE FULLTEXT INDEX entity_name_ft IF NOT EXISTS
        FOR (e:Entity) ON EACH [e.name]
      `)
    } finally {
      await session.close()
    }
  }
}
