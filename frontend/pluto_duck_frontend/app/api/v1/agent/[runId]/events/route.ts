import { createAgentEventStream } from '../../../_server/agentRuntime.ts';
import { requireRouteParam, resolveProjectScope } from '../../../_server/http.ts';
import { StoreHttpError } from '../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    runId: string;
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const runId = requireRouteParam((await context.params).runId, 'Run id');
    const scope = resolveProjectScope(request);
    const stream = createAgentEventStream(runId, request.signal, scope.project_id);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof StoreHttpError) {
      return new Response(JSON.stringify({ detail: error.detail }), {
        status: error.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    }

    return new Response(JSON.stringify({ detail: 'Internal server error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  }
}
