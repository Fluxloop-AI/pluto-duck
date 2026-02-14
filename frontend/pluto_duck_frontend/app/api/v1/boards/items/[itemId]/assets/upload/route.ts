import { NextResponse } from 'next/server';

import { uploadBoardAsset } from '../../../../../_server/boards.ts';
import {
  created,
  requireRouteParam,
  resolveProjectScope,
  toErrorResponse,
} from '../../../../../_server/http.ts';
import { StoreHttpError } from '../../../../../_server/store.ts';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: {
    itemId: string;
  };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const itemId = requireRouteParam(context.params.itemId, 'Item id');
    const scope = resolveProjectScope(request);
    const formData = await request.formData();
    const fileField = formData.get('file');
    if (!(fileField instanceof File)) {
      throw new StoreHttpError(400, 'File payload is required');
    }

    const uploaded = await uploadBoardAsset(
      itemId,
      {
        file_name: fileField.name,
        mime_type: fileField.type || null,
        content: new Uint8Array(await fileField.arrayBuffer()),
      },
      scope.project_id
    );
    return created(uploaded);
  } catch (error) {
    return toErrorResponse(error);
  }
}
