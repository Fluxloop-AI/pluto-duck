'use client';

import { useState, useEffect, useRef } from 'react';
import {
  EyeIcon,
  EyeOffIcon,
  AlertTriangleIcon,
  TrashIcon,
  Loader2,
  RefreshCw,
  Download,
  User,
  Settings,
  Bell,
  Cpu,
  Database,
} from 'lucide-react';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  fetchSettings,
  updateSettings,
  resetDatabase,
  resetWorkspaceData,
  type UpdateSettingsRequest,
} from '../../lib/settingsApi';
import {
  downloadLocalModel,
  listLocalModels,
  deleteLocalModel,
  fetchLocalDownloadStatuses,
  type LocalModelInfo,
  type DownloadLocalModelResponse,
  type LocalDownloadStatus,
} from '../../lib/modelsApi';
import {
  ALL_MODEL_OPTIONS,
  LOCAL_MODEL_OPTIONS,
  LOCAL_MODEL_OPTION_MAP,
  type LocalModelOption,
} from '../../constants/models';
import { useTranslations } from 'next-intl';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsSaved?: (model: string) => void;
  onProfileSaved?: (name: string | null) => void;
  onPreferencesSaved?: (language: string) => void;
  initialMenu?: SettingsMenu;
  projectId?: string | null;
  onWorkspaceReset?: () => void;
}

type SettingsMenu = 'profile' | 'preferences' | 'notifications' | 'models' | 'updates' | 'data';

interface MenuItem {
  id: SettingsMenu;
  labelKey: string;
  icon: React.ElementType;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'profile', labelKey: 'menu.profile', icon: User },
  { id: 'preferences', labelKey: 'menu.preferences', icon: Settings },
  { id: 'notifications', labelKey: 'menu.notifications', icon: Bell },
];

const MENU_ITEMS_SETTINGS: MenuItem[] = [
  { id: 'models', labelKey: 'menu.models', icon: Cpu },
  { id: 'updates', labelKey: 'menu.updates', icon: Download },
  { id: 'data', labelKey: 'menu.data', icon: Database },
];

const MODELS = ALL_MODEL_OPTIONS;

export function SettingsModal({
  open,
  onOpenChange,
  onSettingsSaved,
  onProfileSaved,
  onPreferencesSaved,
  initialMenu,
  projectId,
  onWorkspaceReset,
}: SettingsModalProps) {
  const t = useTranslations('settings');
  const [activeMenu, setActiveMenu] = useState<SettingsMenu>('profile');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [userName, setUserName] = useState('');
  const [language, setLanguage] = useState('en');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);
  const [localDownloadStates, setLocalDownloadStates] = useState<Record<string, LocalDownloadStatus>>({});
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'loading' | 'connected'>('idle');
  const [googleFullName, setGoogleFullName] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');

  // DB Reset states
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetWorkspaceDialog, setShowResetWorkspaceDialog] = useState(false);
  const [resettingWorkspace, setResettingWorkspace] = useState(false);

  // Auto Update
  const {
    currentVersion,
    updateAvailable,
    downloading,
    progress,
    readyToRestart,
    error: updateError,
    autoDownload,
    setAutoDownload,
    checkForUpdates,
    downloadUpdate,
    restart,
  } = useAutoUpdate();

  const downloadPollRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const googleConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAnyDownloadInProgress = Object.values(localDownloadStates).some(
    state => state.status === 'queued' || state.status === 'downloading',
  );

  useEffect(() => {
    if (open) {
      setActiveMenu(initialMenu ?? 'profile');
      loadSettings();
    }
    return () => {
      Object.values(downloadPollRef.current).forEach(timer => clearTimeout(timer));
      downloadPollRef.current = {};
    };
  }, [open, initialMenu]);

  useEffect(() => {
    return () => {
      if (googleConnectTimerRef.current) {
        clearTimeout(googleConnectTimerRef.current);
        googleConnectTimerRef.current = null;
      }
    };
  }, []);

  const fetchLocalModels = async () => {
    setLoadingLocalModels(true);
    try {
      const models = await listLocalModels();
      setLocalModels(models);
    } catch (err) {
      console.error('Failed to load local models', err);
    } finally {
      setLoadingLocalModels(false);
    }
  };

  const fetchDownloadStatuses = async () => {
    try {
      const statuses = await fetchLocalDownloadStatuses();
      setLocalDownloadStates(statuses);
      return statuses;
    } catch (err) {
      console.error('Failed to fetch download status', err);
      return {};
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    setApiKey('');
    setHasExistingKey(false);
    setLocalDownloadStates({});
    try {
      const settings = await fetchSettings();
      // Check if API key exists (masked or not)
      if (settings.llm_api_key) {
        if (settings.llm_api_key.includes('***')) {
          // Masked key - show as placeholder
          setApiKey('');
          setHasExistingKey(true);
        } else {
          // Full key - show it
          setApiKey(settings.llm_api_key);
          setHasExistingKey(true);
        }
      }
      if (settings.llm_model) {
        setModel(settings.llm_model);
      }
      setUserName(settings.user_name || '');
      setLanguage(settings.language || 'en');
      await fetchLocalModels();
      await fetchDownloadStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('models.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const scheduleStatusPolling = (modelId: string) => {
    const poll = async () => {
      const statuses = await fetchDownloadStatuses();
      const next = statuses[modelId];
      if (!next || next.status === 'completed' || next.status === 'error') {
        delete downloadPollRef.current[modelId];
        await fetchLocalModels();
        if (next?.status === 'completed') {
          setSuccessMessage(
            t('models.downloadCompleteMsg', {
              name: LOCAL_MODEL_OPTION_MAP[modelId]?.label ?? modelId,
            })
          );
        } else if (next?.status === 'error') {
          setError(next.detail ?? t('models.downloadFailedMsg'));
        }
      } else {
        downloadPollRef.current[modelId] = setTimeout(poll, 2000);
      }
    };
    if (downloadPollRef.current[modelId]) {
      return;
    }
    downloadPollRef.current[modelId] = setTimeout(poll, 0);
  };

  const handleDownloadLocalModel = async (option: LocalModelOption) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const response: DownloadLocalModelResponse = await downloadLocalModel({
        repo_id: option.repoId,
        filename: option.filename,
        model_id: option.id,
      });

      const status = response.status === 'in_progress' ? 'downloading' : response.status;

      if (status === 'completed') {
        await fetchLocalModels();
        await fetchDownloadStatuses();
        setSuccessMessage(
          t('models.modelReadyMsg', {
            name: option.label,
          })
        );
      } else {
        setLocalDownloadStates(prev => ({
          ...prev,
          [option.id]: {
            status: status as LocalDownloadStatus['status'],
            detail: response.detail,
            updated_at: new Date().toISOString(),
          },
        }));
        setSuccessMessage(t('models.downloadInProgressMsg'));
        scheduleStatusPolling(option.id);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('models.downloadFailedMsg');
      setError(message);
      setLocalDownloadStates(prev => ({
        ...prev,
        [option.id]: {
          status: 'error',
          detail: message,
          updated_at: new Date().toISOString(),
        },
      }));
    }
  };

  const handleDeleteLocalModel = async (model: LocalModelInfo) => {
    const option = LOCAL_MODEL_OPTION_MAP[model.id];
    const displayName = option?.label ?? model.name ?? model.id;
    const confirmed = window.confirm(
      t('models.confirmDelete', {
        name: displayName,
      })
    );
    if (!confirmed) return;

    setError(null);
    setSuccessMessage(null);
    setDeletingModelId(model.id);
    try {
      await deleteLocalModel(model.id);
      await fetchLocalModels();
      setSuccessMessage(
        t('models.modelDeletedMsg', {
          name: displayName,
        })
      );
      if (downloadPollRef.current[model.id]) {
        clearTimeout(downloadPollRef.current[model.id]);
        delete downloadPollRef.current[model.id];
      }
      setLocalDownloadStates(prev => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete local model');
    } finally {
      setDeletingModelId(null);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccessMessage(null);

    // Validation
    if (apiKey && !apiKey.startsWith('sk-')) {
      setError(t('models.apiKeyError'));
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateSettingsRequest = {};

      // Only update API key if user entered a new one
      if (apiKey.trim()) {
        payload.llm_api_key = apiKey.trim();
      }

      // Always update model (even if just changing model)
      payload.llm_model = model;

      // If no API key entered but one exists, and model hasn't changed, nothing to do
      if (!payload.llm_api_key && hasExistingKey && !apiKey.trim()) {
        // User didn't enter new key, just update model
        delete payload.llm_api_key;
      }

      await updateSettings(payload);
      setSuccessMessage(t('models.saved'));
      setHasExistingKey(true); // Mark that we now have a key

      // Notify parent component about model change
      if (onSettingsSaved && model) {
        onSettingsSaved(model);
      }

      // Close modal after a short delay
      setTimeout(() => {
        onOpenChange(false);
        setSuccessMessage(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('models.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    setSuccessMessage(null);
    onOpenChange(false);
  };

  const handleResetDatabase = async () => {
    setResetting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await resetDatabase();
      setSuccessMessage(t('models.dbResetSuccess'));
      setShowResetDialog(false);

      // Close the settings modal after a delay
      setTimeout(() => {
        onOpenChange(false);
        setSuccessMessage(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('models.dbResetError'));
      setShowResetDialog(false);
    } finally {
      setResetting(false);
    }
  };

  const handleResetWorkspaceData = async () => {
    if (!projectId) {
      setError(t('data.noWorkspace'));
      return;
    }

    setResettingWorkspace(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await resetWorkspaceData(projectId);
      setSuccessMessage(t('models.workspaceResetSuccess'));
      setShowResetWorkspaceDialog(false);
      onWorkspaceReset?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('models.workspaceResetError'));
      setShowResetWorkspaceDialog(false);
    } finally {
      setResettingWorkspace(false);
    }
  };

  const handleGoogleConnect = () => {
    if (googleStatus === 'loading') return;
    setGoogleStatus('loading');
    if (googleConnectTimerRef.current) {
      clearTimeout(googleConnectTimerRef.current);
    }
    googleConnectTimerRef.current = setTimeout(() => {
      setGoogleStatus('connected');
      setGoogleFullName('Yoojung Kim');
      setGoogleEmail('you@gmail.com');
      googleConnectTimerRef.current = null;
    }, 900);
  };

  const renderSidebar = () => (
    <div className="w-[200px] border-r border-border py-2 flex flex-col">
      <nav className="flex flex-col gap-1 px-2">
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                activeMenu === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>
      <div className="mx-4 my-2 border-t border-border" />
      <nav className="flex flex-col gap-1 px-2">
        {MENU_ITEMS_SETTINGS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                activeMenu === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </button>
          );
        })}
      </nav>
    </div>
  );

  const renderPlaceholder = (menu: SettingsMenu) => {
    const menuItem = [...MENU_ITEMS, ...MENU_ITEMS_SETTINGS].find(m => m.id === menu);
    if (!menuItem) return null;
    const Icon = menuItem.icon;

    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Icon className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">{t(menuItem.labelKey)}</h3>
        <p className="text-sm">{t('comingSoon')}</p>
      </div>
    );
  };

  const renderModelsContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pr-2">
        <div className="grid gap-6">
          {/* API Section */}
          <div>
            <h3 className="text-sm font-semibold mb-4">{t('models.api')}</h3>
            <div className="grid gap-4">
              {/* Provider */}
              <div className="grid gap-2">
                <label className="text-sm font-medium">{t('models.provider')}</label>
                <Select value="openai" disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{t('models.openai')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('models.providerHint')}
                </p>
              </div>

              {/* API Key */}
              <div className="grid gap-2">
                <label htmlFor="api-key" className="text-sm font-medium">
                  {t('models.apiKey')}
                  {hasExistingKey && (
                    <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
                      ✓ {t('models.configured')}
                    </span>
                  )}
                </label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={hasExistingKey ? 'sk-••••••••••••••••' : 'sk-...'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showApiKey ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasExistingKey
                    ? t('models.apiKeyHintExisting')
                    : t('models.apiKeyHintNew')}
                </p>
              </div>

              {/* Default Model */}
              <div className="grid gap-2">
                <label htmlFor="model" className="text-sm font-medium">
                  {t('models.defaultModel')}
                </label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('models.modelHint')}
                </p>
              </div>
            </div>
          </div>

          {/* Local Models Section */}
          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-semibold mb-4">{t('models.localModels')}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t('models.localModelsHint')}
            </p>
            <div className="grid gap-2">
              {LOCAL_MODEL_OPTIONS.map(option => {
                const downloadState = localDownloadStates[option.id]?.status ?? 'idle';
                const downloadMessage = localDownloadStates[option.id]?.detail ?? undefined;
                const installedModel = localModels.find(m => m.id === option.id);
                const isInstalled = Boolean(installedModel);
                const isDownloading = downloadState === 'queued' || downloadState === 'downloading';

                return (
                  <div
                    key={option.id}
                    className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{option.label}</span>
                        <Badge variant={isInstalled ? 'secondary' : 'outline'}>
                          {isInstalled ? t('models.installed') : t('models.notInstalled')}
                        </Badge>
                        {downloadState === 'completed' && (
                          <Badge variant="secondary">{t('models.downloadComplete')}</Badge>
                        )}
                        {downloadState === 'queued' && (
                          <Badge variant="secondary">{t('models.queued')}</Badge>
                        )}
                        {downloadState === 'downloading' && (
                          <Badge variant="secondary">{t('models.downloading')}</Badge>
                        )}
                        {downloadState === 'error' && (
                          <Badge variant="destructive">{t('models.downloadFailed')}</Badge>
                        )}
                      </div>
                      {option.description && (
                        <p className="text-xs text-muted-foreground">{option.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{option.filename}</p>
                      {downloadState === 'error' && downloadMessage && (
                        <p className="text-xs text-destructive">{downloadMessage}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDownloadLocalModel(option)}
                        disabled={
                          isDownloading ||
                          (isAnyDownloadInProgress && !isDownloading) ||
                          loading ||
                          saving ||
                          resetting ||
                          deletingModelId !== null
                        }
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('models.downloadingBtn')}
                          </>
                        ) : isInstalled ? (
                          t('models.redownload')
                        ) : (
                          t('models.download')
                        )}
                      </Button>
                      {downloadState === 'error' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadLocalModel(option)}
                          disabled={isDownloading}
                        >
                          {t('models.retry')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {loadingLocalModels ? (
              <p className="text-xs text-muted-foreground mt-4">
                {t('models.loadingLocalModels')}
              </p>
            ) : localModels.length > 0 ? (
              <ul className="mt-4 space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
                {localModels.map(localModel => {
                  const option = LOCAL_MODEL_OPTION_MAP[localModel.id];
                  const displayName = option?.label ?? localModel.name ?? localModel.id;
                  const quantization = localModel.quantization ?? option?.quantization ?? 'custom';
                  const sizeLabel =
                    typeof localModel.size_bytes === 'number'
                      ? ` · ${(localModel.size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
                      : '';

                  return (
                    <li key={localModel.id} className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{displayName}</span>
                        <span className="text-muted-foreground">
                          {quantization}
                          {sizeLabel}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={
                          loading ||
                          saving ||
                          resetting ||
                          isAnyDownloadInProgress ||
                          deletingModelId === localModel.id
                        }
                        onClick={() => handleDeleteLocalModel(localModel)}
                        title={t('models.delete')}
                      >
                        {deletingModelId === localModel.id ? (
                          <span className="text-xs">{t('models.deleting')}</span>
                        ) : (
                          <>
                            <TrashIcon className="h-4 w-4" />
                            <span className="sr-only">{t('models.delete')}</span>
                          </>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground mt-4">
                {t('models.noLocalModels')}
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
              {successMessage}
            </div>
          )}
        </div>
      </div>

      {/* Footer for Models section */}
      <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
        <Button variant="outline" onClick={handleCancel} disabled={saving}>
          {t('button.cancel')}
        </Button>
        <Button onClick={handleSave} disabled={loading || saving}>
          {saving ? t('button.saving') : t('button.save')}
        </Button>
      </div>
    </div>
  );

  const renderUpdatesContent = () => (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <Download className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="grid gap-3 flex-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('updates.autoUpdates')}</h3>
            {currentVersion && (
              <span className="text-xs text-muted-foreground font-mono">
                v{currentVersion}
              </span>
            )}
          </div>

          {/* Auto Download Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">{t('updates.autoDownload')}</p>
              <p className="text-xs text-muted-foreground">
                {t('updates.autoDownloadHint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoDownload}
              onClick={() => setAutoDownload(!autoDownload)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoDownload ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                  autoDownload ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Update Status */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">{t('updates.currentStatus')}</p>
              <p className="text-xs text-muted-foreground">
                {readyToRestart
                  ? t('updates.readyToRestart')
                  : updateAvailable
                  ? t('updates.versionAvailable', { version: updateAvailable })
                  : t('updates.upToDate')}
              </p>
            </div>

            {readyToRestart ? (
              <Button size="sm" onClick={restart}>
                {t('updates.restartNow')}
              </Button>
            ) : downloading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress}%
              </div>
            ) : updateAvailable && !autoDownload ? (
              <Button size="sm" variant="outline" onClick={downloadUpdate}>
                {t('models.download')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={checkForUpdates}
                disabled={downloading}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {t('updates.check')}
              </Button>
            )}
          </div>

          {updateError && (
            <p className="text-xs text-destructive">{updateError}</p>
          )}
        </div>
      </div>
    </div>
  );

  const renderDataContent = () => (
    <div className="grid gap-4">
      <h3 className="text-sm font-semibold">{t('data.title')}</h3>
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="grid gap-2 flex-1">
          <h4 className="text-sm font-medium">{t('data.workspaceReset')}</h4>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {t('data.workspaceResetDesc')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('data.workspaceResetDetail')}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowResetWorkspaceDialog(true)}
            disabled={loading || saving || resetting || resettingWorkspace || !projectId}
            className="w-fit"
          >
            {t('data.resetWorkspace')}
          </Button>
          {!projectId && (
            <p className="text-xs text-muted-foreground">
              {t('data.noWorkspace')}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="grid gap-2 flex-1">
          <h4 className="text-sm font-medium">{t('data.dangerZone')}</h4>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {t('data.dbResetDesc')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('data.dbResetWarning')}
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowResetDialog(true)}
            disabled={loading || saving || resetting || resettingWorkspace}
            className="w-fit"
          >
            {t('button.resetDatabase')}
          </Button>
        </div>
      </div>
    </div>
  );

  const handleSaveProfile = async () => {
    setError(null);
    setSuccessMessage(null);
    setSaving(true);

    try {
      const nextName = userName.trim();
      const payload: UpdateSettingsRequest = {
        user_name: nextName || undefined,
      };

      await updateSettings(payload);
      onProfileSaved?.(nextName || null);
      setSuccessMessage(t('profile.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setError(null);
    setSuccessMessage(null);
    setSaving(true);

    try {
      const payload: UpdateSettingsRequest = {
        language,
      };

      await updateSettings(payload);
      setSuccessMessage(t('preferences.saved'));
      onPreferencesSaved?.(language);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preferences.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const renderPreferencesContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <label htmlFor="language" className="text-sm font-medium">
              {t('preferences.language')}
            </label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t('preferences.languageEn')}</SelectItem>
                <SelectItem value="ko">{t('preferences.languageKo')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('preferences.languageHint')}
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border mt-4">
        <div className="min-h-[16px] text-xs text-green-600 dark:text-green-400">
          {successMessage ?? ''}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            {t('button.cancel')}
          </Button>
          <Button onClick={handleSavePreferences} disabled={loading || saving}>
            {saving ? t('button.saving') : t('button.saveChanges')}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderProfileContent = () => {
    const getInitials = (name: string) => {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return '?';
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    };
    const avatarLetter = userName.trim() ? getInitials(userName) : '?';

    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-6">
            {/* Avatar and Name Display */}
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 text-xl">
              <AvatarFallback>{avatarLetter}</AvatarFallback>
            </Avatar>
            <span className="text-lg font-medium">
              {userName.trim() || t('profile.noName')}
            </span>
          </div>

          {/* Display Name Input */}
          <div className="grid gap-2">
            <label htmlFor="display-name" className="text-sm font-medium">
              {t('profile.displayName')}
            </label>
            <Input
              id="display-name"
              type="text"
              placeholder={t('profile.enterName')}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
            />
          </div>

          {/* Google Login (UI only) */}
          <div className="grid gap-2">
            <label className="text-sm font-medium">{t('profile.googleAccount')}</label>
            {googleStatus !== 'connected' ? (
              <Button
                type="button"
                onClick={handleGoogleConnect}
                disabled={googleStatus === 'loading'}
                  className="w-1/2 h-auto justify-center gap-3 rounded-full border border-black/10 bg-white py-[12px] text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-black/5 disabled:opacity-70"
                >
                  {googleStatus === 'loading' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('profile.connecting')}
                    </>
                  ) : (
                    <>
                      <svg
                        aria-hidden="true"
                        className="h-5 w-5"
                        viewBox="0 0 48 48"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.24 0 6.14 1.1 8.42 2.89l6.24-6.24C35.03 3.02 29.77.5 24 .5 14.7.5 6.84 5.86 3.24 13.64l7.3 5.66C12.32 13.48 17.7 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.5 24.5c0-1.62-.14-2.78-.44-3.98H24v7.53h12.9c-.26 2.08-1.66 5.22-4.77 7.32l7.33 5.68c4.38-4.04 6.94-9.98 6.94-16.55z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.54 28.3A14.7 14.7 0 0 1 9.7 24c0-1.5.25-2.96.82-4.3l-7.3-5.66A23.99 23.99 0 0 0 .5 24c0 3.84.92 7.47 2.72 10.64l7.32-5.66z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 47.5c5.76 0 10.59-1.9 14.12-5.45l-7.33-5.68c-1.95 1.36-4.58 2.3-6.79 2.3-6.3 0-11.68-3.98-13.46-9.5l-7.3 5.66C6.84 42.14 14.7 47.5 24 47.5z"
                        />
                      </svg>
                      {t('profile.continueWithGoogle')}
                    </>
                  )}
                </Button>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">{t('profile.userName')}</label>
                    <Input
                      value={googleFullName}
                      readOnly
                      className="bg-muted/40"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">{t('profile.email')}</label>
                    <Input
                      value={googleEmail}
                      readOnly
                      className="bg-muted/40"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-4 border-t border-border mt-4">
          <div className="min-h-[16px] text-xs text-green-600 dark:text-green-400">
            {successMessage ?? ''}
          </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            {t('button.cancel')}
          </Button>
          <Button onClick={handleSaveProfile} disabled={loading || saving}>
            {saving ? t('button.saving') : t('button.saveChanges')}
          </Button>
        </div>
      </div>
    </div>
  );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted-foreground">{t('loading')}</div>
        </div>
      );
    }

    switch (activeMenu) {
      case 'models':
        return renderModelsContent();
      case 'updates':
        return renderUpdatesContent();
      case 'data':
        return renderDataContent();
      case 'profile':
        return renderProfileContent();
      case 'preferences':
        return renderPreferencesContent();
      case 'notifications':
        return renderPlaceholder(activeMenu);
      default:
        return null;
    }
  };

  return (
    <>
      {/* Main Settings Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[750px] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>

          <div className="flex h-[500px]">
            {renderSidebar()}
            <div className="flex-1 p-6 overflow-hidden">
              {renderContent()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Database Reset */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangleIcon className="h-5 w-5" />
              {t('dialog.resetDbTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('dialog.resetDbDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>{t('dialog.resetDbItem1')}</li>
              <li>{t('dialog.resetDbItem2')}</li>
              <li>{t('dialog.resetDbItem3')}</li>
              <li>{t('dialog.resetDbItem4')}</li>
            </ul>

            <div className="mt-4 p-3 bg-destructive/10 rounded-md border border-destructive/20">
              <p className="text-sm font-medium text-destructive">
                {t('dialog.resetDbConfirm')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              {t('button.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetDatabase}
              disabled={resetting}
            >
              {resetting ? t('dialog.resetting') : t('dialog.yesResetDb')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Workspace Data Reset */}
      <Dialog open={showResetWorkspaceDialog} onOpenChange={setShowResetWorkspaceDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangleIcon className="h-5 w-5" />
              {t('dialog.resetWsTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('dialog.resetWsDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>{t('dialog.resetWsItem1')}</li>
              <li>{t('dialog.resetWsItem2')}</li>
              <li>{t('dialog.resetWsItem3')}</li>
              <li>{t('dialog.resetWsItem4')}</li>
            </ul>

            <div className="mt-4 p-3 bg-amber-500/10 rounded-md border border-amber-500/20">
              <p className="text-sm font-medium text-amber-700">
                {t('dialog.resetWsNote')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetWorkspaceDialog(false)}
              disabled={resettingWorkspace}
            >
              {t('button.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetWorkspaceData}
              disabled={resettingWorkspace}
            >
              {resettingWorkspace ? t('dialog.resetting') : t('dialog.yesResetWs')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
