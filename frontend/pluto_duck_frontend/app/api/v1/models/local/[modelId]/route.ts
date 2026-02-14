import { NextResponse } from 'next/server';

import { deleteLocalModel } from '../../../_server/assets.ts';
import { noContent, requireRouteParam, toErrorResponse, withRequestTimeout } from '../../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    modelId: string;
  };
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const modelId = requireRouteParam((await context.params).modelId, 'model_id');
    await withRequestTimeout(() => deleteLocalModel(modelId), {
      timeoutMs: 10_000,
      detail: 'Local model delete timed out',
    });
    return noContent();
  } catch (error) {
    return toErrorResponse(error);
  }
}
