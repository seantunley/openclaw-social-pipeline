/**
 * Embedding pipeline — computes vectors and writes them to the sqlite-vec
 * mirrors (`agent_message_vec`, `agent_fact_vec`). Run as a background
 * task; the chat loop never blocks on this.
 *
 * Vec virtual tables don't support `INSERT OR REPLACE` on the rowid column
 * we declared as PK, so we DELETE existing rows for the id before inserting
 * to keep this idempotent.
 */

import { sql } from "drizzle-orm";
import { getSqlite } from "../../db/index.js";
import * as messagesRepo from "./messages.js";
import * as factsRepo from "./facts.js";
import { embedText, vectorToBuffer } from "./embeddings.js";

interface EmbedSweepResult {
  messagesEmbedded: number;
  factsEmbedded: number;
  failures: number;
}

export async function embedMessage(messageId: string): Promise<void> {
  const sqlite = getSqlite();
  const msg = messagesRepo.getById(messageId);
  if (!msg.content.trim()) {
    messagesRepo.markEmbedded(messageId);
    return;
  }
  const { vector } = await embedText(msg.content);
  sqlite
    .prepare(`DELETE FROM agent_message_vec WHERE message_id = ?`)
    .run(messageId);
  sqlite
    .prepare(
      `INSERT INTO agent_message_vec(message_id, embedding) VALUES (?, ?)`,
    )
    .run(messageId, vectorToBuffer(vector));
  messagesRepo.markEmbedded(messageId);
}

export async function embedFact(factId: string): Promise<void> {
  const sqlite = getSqlite();
  const f = factsRepo.getById(factId);
  if (!f.content.trim()) {
    factsRepo.markEmbedded(factId);
    return;
  }
  const { vector } = await embedText(f.content);
  sqlite
    .prepare(`DELETE FROM agent_fact_vec WHERE fact_id = ?`)
    .run(factId);
  sqlite
    .prepare(`INSERT INTO agent_fact_vec(fact_id, embedding) VALUES (?, ?)`)
    .run(factId, vectorToBuffer(vector));
  factsRepo.markEmbedded(factId);
}

export async function embedBacklog(batchSize = 50): Promise<EmbedSweepResult> {
  let messagesEmbedded = 0;
  let factsEmbedded = 0;
  let failures = 0;

  for (const m of messagesRepo.listUnembedded(batchSize)) {
    try {
      await embedMessage(m.id);
      messagesEmbedded += 1;
    } catch (err) {
      failures += 1;
      console.error(
        `[agent.embedder] message ${m.id} failed: ${(err as Error).message}`,
      );
    }
  }
  for (const f of factsRepo.listUnembedded(batchSize)) {
    try {
      await embedFact(f.id);
      factsEmbedded += 1;
    } catch (err) {
      failures += 1;
      console.error(
        `[agent.embedder] fact ${f.id} failed: ${(err as Error).message}`,
      );
    }
  }

  return { messagesEmbedded, factsEmbedded, failures };
}
