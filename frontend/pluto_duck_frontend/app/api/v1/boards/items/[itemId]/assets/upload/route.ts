import { NextResponse } from 'next/server';

import { StoreHttpError } from '../../../../../_server/store.ts';
import { toErrorResponse } from '../../../../../_server/http.ts';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    throw new StoreHttpError(501, 'Asset upload endpoint is not implemented yet');
  } catch (error) {
    return toErrorResponse(error);
  }
}
