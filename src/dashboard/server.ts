/**
 * dashboard/server.ts — the live orchestrator dashboard server.
 *
 *   bun run dashboard          # → http://localhost:4321
 *
 * Serves the single-file UI (index.html) and streams one instrumented
 * orchestrator session per request over WebSocket (`/ws`), so the browser sees
 * the three role-agents move through reviewing → deliberating → voting →
 * decision in real time. `POST /api/orchestrate` runs the same session and
 * returns all events as JSON (curl/test surface).
 *
 * Connects to the running system by importing the same modules the `gbrain`
 * CLI uses — the REAL skill catalog (skills/ dir, role frontmatter, custom-skill
 * gate) and optionally the REAL gateway chat for the LLM ranker. No DB: history
 * is whatever the user pastes (that's the dashboard's input contract), so the
 * server starts instantly on any machine with the repo + bun.
 *
 * Trust posture: binds locally, runs as a trusted local caller (remote:false),
 * and is SUGGEST-ONLY — it never executes skills. Execution stays behind the
 * explicit local-only `orchestrate_run` op (decision support, not autonomous
 * diagnosis).
 */

import { join } from 'node:path';
import type { OperationContext } from '../core/operations.ts';
import type { CandidateSkill } from '../core/orchestrator/types.ts';
import { runDashboardSession, type DashboardEvent } from './session.ts';

const PORT = Number(process.env.GBRAIN_DASHBOARD_PORT ?? 4321);
const SKILLS_DIR = process.env.GBRAIN_SKILLS_DIR ?? join(import.meta.dir, '..', '..', 'skills');
const INDEX_HTML = join(import.meta.dir, 'index.html');

/**
 * Minimal trusted-local OperationContext for the catalog reader. remote:false
 * short-circuits the publish gate; the engine stub's getConfig failing over to
 * defaults is an explicitly supported path in skill-catalog.ts.
 */
function stubCtx(): OperationContext {
  return {
    remote: false,
    engine: { getConfig: async () => null },
    config: {},
  } as unknown as OperationContext;
}

/** Load the real skill catalog (same reader the list_skills op uses). Cached. */
let catalogCache: CandidateSkill[] | null = null;
async function loadCatalog(): Promise<CandidateSkill[]> {
  if (catalogCache) return catalogCache;
  const sc = await import('../core/skill-catalog.ts');
  const ctx = stubCtx();
  const { dir, source } = sc.resolveSkillsDir(ctx, SKILLS_DIR);
  const { skills } = sc.buildSkillCatalog(ctx, dir, source);
  catalogCache = skills.map((s): CandidateSkill => ({
    name: s.name,
    path: `skills/${s.name}/SKILL.md`,
    description: s.description,
    role: s.role,
    triggers: s.triggers,
  }));
  return catalogCache;
}

interface OrchestrateRequest {
  paste: string;
  useLlm?: boolean;
}

/** Run one session, forwarding events to `emit`. Errors become error events. */
async function runSession(req: OrchestrateRequest, emit: (e: DashboardEvent) => void): Promise<void> {
  const chatFn = req.useLlm
    ? (await import('../core/ai/gateway.ts')).chat // lazy — only touched when asked
    : undefined;
  try {
    await runDashboardSession(
      {
        paste: String(req.paste ?? ''),
        useLlm: req.useLlm === true,
        chatFn,
        loadCandidateSkills: loadCatalog,
      },
      emit,
    );
  } catch {
    // The session already emitted an 'error' event; nothing more to do here.
  }
}

const server = Bun.serve<{ id: number }>({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (srv.upgrade(req, { data: { id: Date.now() } })) return undefined as unknown as Response;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(Bun.file(INDEX_HTML), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (url.pathname === '/api/health') {
      const catalog = await loadCatalog();
      const clinical = catalog.filter((s) => s.role).length;
      return Response.json({ ok: true, skills: catalog.length, clinical });
    }

    // Same pipeline as /ws but request/response — the curl/test surface.
    if (url.pathname === '/api/orchestrate' && req.method === 'POST') {
      let body: OrchestrateRequest;
      try {
        body = (await req.json()) as OrchestrateRequest;
      } catch {
        return Response.json({ error: 'invalid JSON body' }, { status: 400 });
      }
      const events: DashboardEvent[] = [];
      await runSession(body, (e) => events.push(e));
      const report = events.find((e) => e.type === 'report');
      const error = events.find((e) => e.type === 'error');
      return Response.json(
        { events, report: report && 'report' in report ? report : null },
        { status: error && !report ? 422 : 200 },
      );
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    async open(ws) {
      // Prime the UI: all three circles with their loaded skills, before any run.
      try {
        const catalog = await loadCatalog();
        const clinical = catalog.filter((s) => s.role).length;
        ws.send(
          JSON.stringify({
            type: 'stage',
            stage: 'connected',
            detail: `${clinical} clinical skill(s) loaded, ${catalog.length - clinical} generic (gated)`,
          } satisfies DashboardEvent),
        );
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    },
    async message(ws, raw) {
      let msg: { type?: string } & OrchestrateRequest;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON message' }));
        return;
      }
      if (msg.type !== 'orchestrate') {
        ws.send(JSON.stringify({ type: 'error', message: `unknown message type: ${msg.type}` }));
        return;
      }
      await runSession(msg, (e) => ws.send(JSON.stringify(e)));
    },
  },
});

console.log(`gbrain dashboard → http://localhost:${server.port} (skills: ${SKILLS_DIR})`);
