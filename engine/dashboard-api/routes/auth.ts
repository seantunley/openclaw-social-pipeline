import type { FastifyInstance, FastifyPluginCallback } from 'fastify';

const authRoutes: FastifyPluginCallback = (
  fastify: FastifyInstance,
  _opts,
  done,
) => {
  // ── GET /api/social/auth/codex/status ──────────────────────────────────────
  fastify.get('/api/social/auth/codex/status', async (_request, reply) => {
    try {
      const { getCurrentAuthStatus } = await import(
        '../../src/services/auth/codex-login-flow.js'
      );
      const status = await getCurrentAuthStatus();
      return reply.send(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      fastify.log.error({ err }, 'Failed to read codex auth status');
      return reply.status(500).send({ error: message });
    }
  });

  // ── POST /api/social/auth/codex/login ──────────────────────────────────────
  // Starts a new sign-in flow. Returns `{ flowId, url }` immediately. The
  // dashboard opens the URL in a new tab; user completes OAuth; pi-ai's
  // local callback server (port 1455) handles the rest.
  fastify.post('/api/social/auth/codex/login', async (_request, reply) => {
    try {
      const { startCodexLogin } = await import(
        '../../src/services/auth/codex-login-flow.js'
      );
      const result = await startCodexLogin();
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      fastify.log.error({ err }, 'Failed to start codex login flow');
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/auth/codex/flow/:flowId ────────────────────────────────
  // Poll the in-memory flow state. Dashboard hits this every ~2 seconds while
  // the OAuth tab is open.
  fastify.get('/api/social/auth/codex/flow/:flowId', async (request, reply) => {
    const { flowId } = request.params as { flowId: string };
    try {
      const { getFlowStatus } = await import(
        '../../src/services/auth/codex-login-flow.js'
      );
      const result = getFlowStatus(flowId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: message });
    }
  });

  // ── GET /api/social/auth/env-status ────────────────────────────────────────
  // Boolean presence-check for every env var the engine reads. Never returns
  // the value itself — just whether it's set + the length, so the operator
  // knows what's configured without leaking secrets.
  fastify.get('/api/social/auth/env-status', async (_request, reply) => {
    const inspect = (name: string, isSecret = true) => {
      const v = process.env[name] ?? '';
      const set = v.length > 0 && v !== '...' && !v.startsWith('sk-ant-...');
      return {
        name,
        set,
        // Display value only for non-secrets; otherwise just length.
        value: set && !isSecret ? v : null,
        length: set ? v.length : 0,
      };
    };

    return reply.send({
      llm: [
        inspect('LLM_PROVIDER', false),
        inspect('ANTHROPIC_API_KEY'),
        inspect('LLM_OPENAI_CODEX_MODEL', false),
        inspect('OPENAI_API_KEY'),
      ],
      media: [
        inspect('FAL_API_KEY'),
        inspect('IMAGE_PROVIDER', false),
        inspect('VIDEO_PROVIDER', false),
      ],
      postiz: [
        inspect('POSTIZ_MODE', false),
        inspect('POSTIZ_API_URL', false),
        inspect('POSTIZ_API_KEY'),
        inspect('POSTIZ_DEFAULT_INTEGRATION_ID', false),
      ],
      telegram: [
        inspect('TELEGRAM_BOT_TOKEN'),
        inspect('TELEGRAM_AUTHORIZED_USER_ID', false),
        inspect('BOT_DEFAULT_PLATFORM', false),
      ],
      api: [
        inspect('API_PORT', false),
        inspect('CORS_ORIGIN', false),
        inspect('DB_PATH', false),
      ],
    });
  });

  // ── POST /api/social/auth/codex/logout ─────────────────────────────────────
  fastify.post('/api/social/auth/codex/logout', async (_request, reply) => {
    try {
      const { clearCodexAuth } = await import(
        '../../src/services/auth/codex-login-flow.js'
      );
      await clearCodexAuth();
      return reply.send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      fastify.log.error({ err }, 'Failed to clear codex auth');
      return reply.status(500).send({ error: message });
    }
  });

  done();
};

export default authRoutes;
