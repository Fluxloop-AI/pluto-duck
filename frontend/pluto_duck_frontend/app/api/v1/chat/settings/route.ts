import { NextResponse } from 'next/server';

import { getChatSettings, updateChatSettings } from '../../_server/chat.ts';
import { ok, parseJsonBody, resolveProjectScope, toErrorResponse } from '../../_server/http.ts';

export const dynamic = 'force-dynamic';

interface ChatSettingsPayload {
  data_sources?: unknown;
  dbt_project?: unknown;
  ui_preferences?: unknown;
  llm_provider?: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    return ok(await getChatSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    resolveProjectScope(request);
    const payload = await parseJsonBody<ChatSettingsPayload>(request);
    return ok(await updateChatSettings(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
