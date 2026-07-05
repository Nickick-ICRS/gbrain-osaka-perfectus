/**
 * distiller/extract.ts — deterministic topic extractor (keyless, upstream of the decider).
 *
 * Nothing else in the repo turns brain *content* into skill candidates; this is
 * that step. It takes normalized brain records and clusters them into
 * `CandidateTopic`s the decider can act on. Deterministic (no LLM, no DB) —
 * grouping is by care lane + a stable topic key — so it's fully testable and
 * runs keyless. The LLM can refine topic boundaries later; this gives the
 * pipeline a real, honest producer now.
 *
 * The real DATA ADAPTER (Almage transmissions / a `query` result → BrainRecord)
 * is a thin seam the CLL/op layer supplies; this module is format-agnostic.
 *
 * APPI: records without a healthcare role are dropped here (they can never
 * become clinical skills) and counted in the result, never silently discarded.
 */

import type { CandidateTopic, SkillRole } from './types.ts';
import { isHealthcareRole } from '../orchestrator/custom-skills.ts';

/** A normalized unit of brain content the extractor clusters over. */
export interface BrainRecord {
  /** Stable id / slug of the source page (provenance for the audit trail). */
  id: string;
  /** The record's text content (note, transmission, record body). */
  text: string;
  /** Care lane this record belongs to. Non-clinical records are dropped. */
  role: string;
  /** Optional tags — the primary tag becomes the topic key when present. */
  tags?: string[];
  /** Optional human title; seeds the topic title + trigger. */
  title?: string;
}

export interface ExtractResult {
  topics: CandidateTopic[];
  /** Count of records dropped for lacking a healthcare role (APPI audit). */
  droppedNonClinical: number;
}

export interface ExtractOptions {
  /** Max characters kept in a topic summary. Default 1200. */
  maxSummaryChars?: number;
  /** Max trigger phrases kept per topic. Default 8. */
  maxTriggers?: number;
}

/** kebab-ish normalization for a stable topic key. */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Title-case a key for a human-readable topic title fallback. */
function titleCase(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** The stable topic key for a record: primary tag → title → 'general'. */
function topicKeyOf(r: BrainRecord): string {
  if (r.tags && r.tags.length > 0) return normKey(r.tags[0]);
  if (r.title) return normKey(r.title);
  return 'general';
}

/**
 * Cluster brain records into candidate topics. Deterministic: records are
 * grouped by `${role}::${topicKey}`, groups and their members are processed in
 * sorted order, so the same input always yields the same topics.
 */
export function extractTopics(records: BrainRecord[], opts: ExtractOptions = {}): ExtractResult {
  const maxSummaryChars = opts.maxSummaryChars ?? 1200;
  const maxTriggers = opts.maxTriggers ?? 8;

  let droppedNonClinical = 0;
  const groups = new Map<string, BrainRecord[]>();

  for (const r of records) {
    if (!isHealthcareRole(r.role)) {
      droppedNonClinical++;
      continue;
    }
    const groupId = `${r.role}::${topicKeyOf(r)}`;
    const bucket = groups.get(groupId);
    if (bucket) bucket.push(r);
    else groups.set(groupId, [r]);
  }

  const topics: CandidateTopic[] = [];
  for (const groupId of [...groups.keys()].sort()) {
    const members = groups.get(groupId)!.slice().sort((a, b) => a.id.localeCompare(b.id));
    const role = members[0].role as SkillRole;
    const key = groupId.slice(groupId.indexOf('::') + 2);

    const title = members.find((m) => m.title)?.title ?? titleCase(key);
    const summary = members
      .map((m) => m.text.replace(/\s+/g, ' ').trim())
      .join(' ')
      .slice(0, maxSummaryChars);

    // Triggers: dedup tags across the group; fall back to the topic key.
    const trigSet = new Set<string>();
    for (const m of members) for (const t of m.tags ?? []) trigSet.add(t.toLowerCase().trim());
    if (trigSet.size === 0) trigSet.add(key.replace(/-/g, ' '));
    const triggers = [...trigSet].sort().slice(0, maxTriggers);

    topics.push({
      title,
      summary,
      role,
      triggers,
      sourceIds: members.map((m) => m.id),
    });
  }

  // Stable order for callers/tests.
  topics.sort((a, b) => (a.role + a.title).localeCompare(b.role + b.title));
  return { topics, droppedNonClinical };
}
