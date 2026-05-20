/**
 * Agent persona — singleton row keyed `id='default'`. Operator-editable.
 * The runtime injects `system_prompt` as the system message on every call.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { agentProfile } from "../../db/schema.js";

export interface Profile {
  id: string;
  name: string;
  system_prompt: string;
  default_model: string;
  default_temperature: number;
  max_steps: number;
  created_at: string;
  updated_at: string;
}

export function getProfile(): Profile {
  const db = getDb();
  const row = db
    .select()
    .from(agentProfile)
    .where(eq(agentProfile.id, "default"))
    .get();
  if (!row) {
    // Initialise from defaults if the seed insert never ran (in-memory db etc).
    db.insert(agentProfile).values({ id: "default" }).run();
    return getProfile();
  }
  return row as Profile;
}

export interface UpdateProfileInput {
  name?: string;
  systemPrompt?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  maxSteps?: number;
}

export function updateProfile(input: UpdateProfileInput): Profile {
  const db = getDb();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.systemPrompt !== undefined) patch.system_prompt = input.systemPrompt;
  if (input.defaultModel !== undefined) patch.default_model = input.defaultModel;
  if (input.defaultTemperature !== undefined) patch.default_temperature = input.defaultTemperature;
  if (input.maxSteps !== undefined) patch.max_steps = input.maxSteps;
  db.update(agentProfile)
    .set(patch)
    .where(eq(agentProfile.id, "default"))
    .run();
  return getProfile();
}
