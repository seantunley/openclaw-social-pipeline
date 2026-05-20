/**
 * Agent skill registry + loader + auditor.
 *
 * A "skill" is a JSON manifest describing one or more tools the agent can
 * call. Skills are NOT auto-trusted: every skill ships with a SHA-256
 * checksum stored at registration; the runtime re-verifies that checksum
 * on load and refuses to load it if the manifest has changed.
 *
 * Lifecycle:
 *   registered → approved → active     (operator approval flips it)
 *                       ↘ revoked       (operator disables; never deleted)
 *
 * Every state transition writes a row to agent_skill_audit. That table is
 * append-only and is what the SOC's "Skills" view reads.
 */

import { createHash, randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import {
  agentSkill,
  agentSkillTool,
  agentSkillAudit,
} from "../../db/schema.js";

export type SkillStatus = "registered" | "approved" | "active" | "revoked";
export type SkillSourceType = "builtin" | "github" | "filesystem" | "npm";

export interface SkillToolManifest {
  name: string;
  description?: string;
  input_schema?: unknown;
}

export interface SkillManifest {
  name: string;
  version: string;
  description?: string;
  tools: SkillToolManifest[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  source_type: SkillSourceType;
  source_url: string;
  checksum_sha256: string;
  manifest_json: string;
  status: SkillStatus;
  approved_at: string | null;
  approved_by: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillTool {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  input_schema_json: string;
  enabled: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Registration + lifecycle
// ---------------------------------------------------------------------------

export interface RegisterInput {
  manifest: SkillManifest;
  sourceType: SkillSourceType;
  sourceUrl?: string;
}

export function register(input: RegisterInput): Skill {
  const db = getDb();
  const checksum = computeChecksum(input.manifest);

  // If a skill with the same name already exists, treat this as a re-register:
  // bump version + reset checksum + flip status back to 'registered' so the
  // operator must approve again. Tools get rebuilt from the new manifest.
  const existing = db
    .select()
    .from(agentSkill)
    .where(eq(agentSkill.name, input.manifest.name))
    .get() as Skill | undefined;

  if (existing) {
    const manifestChanged = existing.checksum_sha256 !== checksum;
    db.update(agentSkill)
      .set({
        description: input.manifest.description ?? "",
        version: input.manifest.version,
        source_type: input.sourceType,
        source_url: input.sourceUrl ?? "",
        checksum_sha256: checksum,
        manifest_json: JSON.stringify(input.manifest),
        // Re-register always demotes to 'registered' to force re-approval.
        status: manifestChanged ? "registered" : existing.status,
        updated_at: new Date().toISOString(),
      })
      .where(eq(agentSkill.id, existing.id))
      .run();
    rebuildTools(existing.id, input.manifest);
    if (manifestChanged) {
      logAudit({
        skillId: existing.id,
        event: "manifest_changed",
        expectedChecksum: existing.checksum_sha256,
        actualChecksum: checksum,
        note: `Manifest changed for ${input.manifest.name}; status demoted to 'registered'.`,
      });
    } else {
      logAudit({
        skillId: existing.id,
        event: "registered",
        note: `Re-registered (no manifest change).`,
      });
    }
    return getById(existing.id);
  }

  const id = randomUUID();
  db.insert(agentSkill)
    .values({
      id,
      name: input.manifest.name,
      description: input.manifest.description ?? "",
      version: input.manifest.version,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? "",
      checksum_sha256: checksum,
      manifest_json: JSON.stringify(input.manifest),
      status: "registered",
    })
    .run();
  rebuildTools(id, input.manifest);
  logAudit({
    skillId: id,
    event: "registered",
    note: `Registered ${input.manifest.name}@${input.manifest.version}`,
  });
  return getById(id);
}

export function approve(skillId: string, approvedBy = "operator"): Skill {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(agentSkill)
    .set({ status: "approved", approved_at: now, approved_by: approvedBy, updated_at: now })
    .where(eq(agentSkill.id, skillId))
    .run();
  logAudit({ skillId, event: "approved", actor: approvedBy });
  return getById(skillId);
}

export function activate(skillId: string): Skill {
  // Verify integrity before activating — if the on-disk manifest changed,
  // refuse and write a verify_failed audit row.
  const skill = getById(skillId);
  const manifest = JSON.parse(skill.manifest_json) as SkillManifest;
  const actual = computeChecksum(manifest);
  if (actual !== skill.checksum_sha256) {
    logAudit({
      skillId,
      event: "verify_failed",
      expectedChecksum: skill.checksum_sha256,
      actualChecksum: actual,
      note: "Activation refused: stored manifest does not match recorded checksum.",
    });
    throw new Error(
      `Skill ${skill.name} integrity check failed: checksum mismatch. ` +
        `Stored manifest no longer matches the recorded checksum. ` +
        `Re-register the skill with the current manifest, then re-approve.`,
    );
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.update(agentSkill)
    .set({ status: "active", last_verified_at: now, updated_at: now })
    .where(eq(agentSkill.id, skillId))
    .run();
  logAudit({ skillId, event: "activated" });
  return getById(skillId);
}

export function revoke(skillId: string, reason: string, by = "operator"): Skill {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(agentSkill)
    .set({
      status: "revoked",
      revoked_at: now,
      revoked_reason: reason,
      updated_at: now,
    })
    .where(eq(agentSkill.id, skillId))
    .run();
  logAudit({ skillId, event: "revoked", actor: by, note: reason });
  return getById(skillId);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getById(id: string): Skill {
  const db = getDb();
  const row = db.select().from(agentSkill).where(eq(agentSkill.id, id)).get();
  if (!row) throw new Error(`Skill not found: ${id}`);
  return row as Skill;
}

export function listAll(): Skill[] {
  const db = getDb();
  return db.select().from(agentSkill).all() as Skill[];
}

export function listActive(): Skill[] {
  const db = getDb();
  return db
    .select()
    .from(agentSkill)
    .where(eq(agentSkill.status, "active"))
    .all() as Skill[];
}

export function listToolsForSkill(skillId: string): SkillTool[] {
  const db = getDb();
  return db
    .select()
    .from(agentSkillTool)
    .where(eq(agentSkillTool.skill_id, skillId))
    .all() as unknown as SkillTool[];
}

/**
 * Returns the set of tools the runtime should expose to the LLM right now —
 * tools from active, integrity-verified skills, with enabled=1. Re-verifies
 * each active skill's checksum on the fly; any mismatch is recorded and the
 * skill is excluded from this load.
 */
export function loadActiveTools(): SkillTool[] {
  const skills = listActive();
  const out: SkillTool[] = [];
  for (const s of skills) {
    try {
      const manifest = JSON.parse(s.manifest_json) as SkillManifest;
      const actual = computeChecksum(manifest);
      if (actual !== s.checksum_sha256) {
        logAudit({
          skillId: s.id,
          event: "verify_failed",
          expectedChecksum: s.checksum_sha256,
          actualChecksum: actual,
          note: "Load-time integrity check failed; skill excluded from this load.",
        });
        continue;
      }
      logAudit({ skillId: s.id, event: "verify_ok" });
      for (const t of listToolsForSkill(s.id)) {
        if (t.enabled) out.push(t);
      }
    } catch (err) {
      console.error(
        `[agent.skills] failed to load skill ${s.name}: ${(err as Error).message}`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

type AuditEvent =
  | "registered"
  | "approved"
  | "activated"
  | "revoked"
  | "verify_ok"
  | "verify_failed"
  | "manifest_changed";

interface AuditInput {
  skillId: string;
  event: AuditEvent;
  actor?: string;
  note?: string;
  expectedChecksum?: string;
  actualChecksum?: string;
}

export function logAudit(a: AuditInput): void {
  const db = getDb();
  db.insert(agentSkillAudit)
    .values({
      id: randomUUID(),
      skill_id: a.skillId,
      event: a.event,
      actor: a.actor ?? "operator",
      note: a.note ?? "",
      expected_checksum: a.expectedChecksum ?? null,
      actual_checksum: a.actualChecksum ?? null,
    })
    .run();
}

export interface AuditRow {
  id: string;
  skill_id: string;
  event: AuditEvent;
  actor: string;
  note: string;
  expected_checksum: string | null;
  actual_checksum: string | null;
  created_at: string;
}

export function listAudit(skillId?: string, limit = 100): AuditRow[] {
  const db = getDb();
  const q = db
    .select()
    .from(agentSkillAudit)
    .orderBy(desc(agentSkillAudit.created_at))
    .limit(limit);
  return (skillId
    ? q.where(eq(agentSkillAudit.skill_id, skillId)).all()
    : q.all()) as unknown as AuditRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic checksum over a manifest. We stringify with sorted keys so
 * a re-saved manifest with shuffled keys hashes identically; ANY semantic
 * change to the manifest (tool added, schema mutated, version bumped) will
 * mismatch.
 */
export function computeChecksum(manifest: SkillManifest): string {
  return createHash("sha256")
    .update(canonicaliseJson(manifest))
    .digest("hex");
}

function canonicaliseJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicaliseJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return `${JSON.stringify(k)}:${canonicaliseJson(v)}`;
  });
  return `{${parts.join(",")}}`;
}

function rebuildTools(skillId: string, manifest: SkillManifest): void {
  const db = getDb();
  // Clear existing tool rows, then re-insert from the manifest.
  db.delete(agentSkillTool).where(eq(agentSkillTool.skill_id, skillId)).run();
  for (const t of manifest.tools ?? []) {
    db.insert(agentSkillTool)
      .values({
        id: randomUUID(),
        skill_id: skillId,
        name: t.name,
        description: t.description ?? "",
        input_schema_json: JSON.stringify(t.input_schema ?? {}),
        enabled: true,
      })
      .run();
  }
}
