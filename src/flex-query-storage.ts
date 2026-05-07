import fs from "fs/promises";
import path from "path";
import { Logger } from "./logger.js";
import os from "os";

export interface SavedFlexQuery {
  id: string;
  name: string;
  queryId: string;
  description?: string;
  createdAt: string;
  lastUsed?: string;
}

interface FlexQueriesStore {
  queries: SavedFlexQuery[];
}

/**
 * Storage manager for saved flex queries
 * Uses a JSON file to persist query information
 */
export class FlexQueryStorage {
  private storageFile: string;
  private store: FlexQueriesStore = { queries: [] };

  constructor(storageFile?: string) {
    // Use user's home directory for storage by default
    const defaultFile = path.join(
      os.homedir(),
      ".interactive-brokers-mcp",
      "flex-queries.json"
    );
    this.storageFile = storageFile || defaultFile;
  }

  /**
   * Initialize storage - create directory and file if needed
   */
  async initialize(): Promise<void> {
    try {
      const dir = path.dirname(this.storageFile);
      
      // Create directory if it doesn't exist
      try {
        await fs.access(dir);
      } catch {
        Logger.log(`[FLEX-QUERY-STORAGE] Creating directory: ${dir}`);
        await fs.mkdir(dir, { recursive: true });
      }

      // Load existing data or create new file
      try {
        await this.load();
      } catch {
        Logger.log(`[FLEX-QUERY-STORAGE] Creating new storage file: ${this.storageFile}`);
        await this.save();
      }
    } catch (error) {
      Logger.error("[FLEX-QUERY-STORAGE] Failed to initialize storage:", error);
      throw error;
    }
  }

  /**
   * Load queries from storage file
   */
  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storageFile, "utf-8");
      this.store = JSON.parse(data);
      Logger.log(`[FLEX-QUERY-STORAGE] Loaded ${this.store.queries.length} queries from storage`);
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        // File doesn't exist yet, use empty store
        this.store = { queries: [] };
        return;
      }
      throw error;
    }
  }

  /**
   * Save queries to storage file
   */
  private async save(): Promise<void> {
    try {
      const data = JSON.stringify(this.store, null, 2);
      await fs.writeFile(this.storageFile, data, "utf-8");
      Logger.log(`[FLEX-QUERY-STORAGE] Saved ${this.store.queries.length} queries to storage`);
    } catch (error) {
      Logger.error("[FLEX-QUERY-STORAGE] Failed to save queries:", error);
      throw error;
    }
  }

  /**
   * Get all saved queries
   */
  async listQueries(): Promise<SavedFlexQuery[]> {
    await this.load(); // Reload to get latest data
    return [...this.store.queries];
  }

  /**
   * Get a saved query by internal ID
   */
  async getQuery(id: string): Promise<SavedFlexQuery | null> {
    await this.load();
    const query = this.store.queries.find((q) => q.id === id);
    return query || null;
  }

  /**
   * Get a saved query by IB's query ID
   */
  async getQueryByQueryId(queryId: string): Promise<SavedFlexQuery | null> {
    await this.load();
    const query = this.store.queries.find((q) => q.queryId === queryId);
    return query || null;
  }

  /**
   * Get a saved query by name
   */
  async getQueryByName(name: string): Promise<SavedFlexQuery | null> {
    await this.load();
    const query = this.store.queries.find((q) => q.name.toLowerCase() === name.toLowerCase());
    return query || null;
  }

  /**
   * Save a new query
   */
  async saveQuery(query: Omit<SavedFlexQuery, "id" | "createdAt">): Promise<SavedFlexQuery> {
    await this.load();

    // Check if a query with this queryId (IB's ID) already exists
    const existing = this.store.queries.find((q) => q.queryId === query.queryId);
    if (existing) {
      throw new Error(`A query with the IB Query ID "${query.queryId}" already exists. Use updateQuery to modify it.`);
    }

    const newQuery: SavedFlexQuery = {
      ...query,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
    };

    this.store.queries.push(newQuery);
    await this.save();

    Logger.log(`[FLEX-QUERY-STORAGE] Saved new query: ${newQuery.name} (Query ID: ${newQuery.queryId})`);
    return newQuery;
  }

  /**
   * Update an existing query
   */
  async updateQuery(id: string, updates: Partial<Omit<SavedFlexQuery, "id" | "createdAt">>): Promise<SavedFlexQuery> {
    await this.load();

    const index = this.store.queries.findIndex((q) => q.id === id);
    if (index === -1) {
      throw new Error(`Query with ID "${id}" not found`);
    }

    // If updating name, check for conflicts
    if (updates.name) {
      const nameConflict = this.store.queries.find(
        (q) => q.id !== id && q.name.toLowerCase() === updates.name!.toLowerCase()
      );
      if (nameConflict) {
        throw new Error(`A query with the name "${updates.name}" already exists`);
      }
    }

    this.store.queries[index] = {
      ...this.store.queries[index],
      ...updates,
    };

    await this.save();

    Logger.log(`[FLEX-QUERY-STORAGE] Updated query: ${this.store.queries[index].name} (ID: ${id})`);
    return this.store.queries[index];
  }

  /**
   * Update the last used timestamp for a query
   */
  async markQueryUsed(id: string): Promise<void> {
    await this.load();

    const query = this.store.queries.find((q) => q.id === id);
    if (query) {
      query.lastUsed = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Delete a saved query
   */
  async deleteQuery(id: string): Promise<boolean> {
    await this.load();

    const index = this.store.queries.findIndex((q) => q.id === id);
    if (index === -1) {
      return false;
    }

    const deleted = this.store.queries.splice(index, 1)[0];
    await this.save();

    Logger.log(`[FLEX-QUERY-STORAGE] Deleted query: ${deleted.name} (ID: ${id})`);
    return true;
  }

  /**
   * Generate a unique ID for a query
   */
  private generateId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the storage file path
   */
  getStorageFilePath(): string {
    return this.storageFile;
  }
}


