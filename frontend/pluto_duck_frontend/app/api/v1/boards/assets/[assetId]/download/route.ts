import { NextResponse } from 'next/server';

import { StoreHttpError } from '../../../../_server/store.ts';
import { toErrorResponse } from '../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    throw new StoreHttpError(501, 'Asset download endpoint is not implemented yet');
  } catch (error) {
    return toErrorResponse(error);
  }
}
