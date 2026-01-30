import { exportAnalysisCsv } from './assetsApi';
import { apiBlob } from './apiClient';
import { isTauriRuntime } from './tauriRuntime';

export interface DownloadAnalysisCsvOptions {
  projectId?: string;
  force?: boolean;
  suggestedName?: string;
}

export async function downloadAnalysisCsv(
  analysisId: string,
  options: DownloadAnalysisCsvOptions = {}
): Promise<void> {
  const suggestedName = options.suggestedName ?? analysisId;
  const force = options.force ?? false;

  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const filePath = await save({
      defaultPath: `${suggestedName}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });

    if (!filePath || typeof filePath !== 'string') {
      return;
    }

    await exportAnalysisCsv(
      analysisId,
      {
        file_path: filePath,
        force,
      },
      options.projectId
    );
    return;
  }

  if (typeof window === 'undefined') {
    throw new Error('CSV download requires a browser environment');
  }

  const query = new URLSearchParams({ force: force ? 'true' : 'false' }).toString();
  const path = `/api/v1/asset/analyses/${analysisId}/download?${query}`;
  const blob = await apiBlob(path, { projectId: options.projectId });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `${suggestedName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
