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

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsSaved?: (model: string) => void;
  onProfileSaved?: (name: string | null) => void;
  initialMenu?: SettingsMenu;
  projectId?: string | null;
  onWorkspaceReset?: () => void;
}

type SettingsMenu = 'profile' | 'preferences' | 'notifications' | 'models' | 'updates' | 'data';

interface MenuItem {
  id: SettingsMenu;
  label: string;
  icon: React.ElementType;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

const MENU_ITEMS_SETTINGS: MenuItem[] = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'updates', label: 'Updates', icon: Download },
  { id: 'data', label: 'Data', icon: Database },
];

const MODELS = ALL_MODEL_OPTIONS;

export function SettingsModal({
  open,
  onOpenChange,
  onSettingsSaved,
  onProfileSaved,
  initialMenu,
  projectId,
  onWorkspaceReset,
}: SettingsModalProps) {
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
      setError(err instanceof Error ? err.message : 'Failed to load settings');
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
          setSuccessMessage(`"${LOCAL_MODEL_OPTION_MAP[modelId]?.label ?? modelId}" 다운로드가 완료되었습니다.`);
        } else if (next?.status === 'error') {
          setError(next.detail ?? '다운로드에 실패했습니다.');
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
        setSuccessMessage(`"${option.label}" 로컬 모델이 준비되었습니다.`);
      } else {
        setLocalDownloadStates(prev => ({
          ...prev,
          [option.id]: {
            status: status as LocalDownloadStatus['status'],
            detail: response.detail,
            updated_at: new Date().toISOString(),
          },
        }));
        setSuccessMessage('모델 다운로드를 백그라운드에서 진행 중입니다. 설정 창을 닫아도 계속됩니다.');
        scheduleStatusPolling(option.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download local model';
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
    const confirmed = window.confirm(`정말로 로컬 모델 "${displayName}"을 삭제할까요?`);
    if (!confirmed) return;

    setError(null);
    setSuccessMessage(null);
    setDeletingModelId(model.id);
    try {
      await deleteLocalModel(model.id);
      await fetchLocalModels();
      setSuccessMessage(`로컬 모델 "${displayName}"을(를) 삭제했습니다.`);
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
      setError('API key must start with "sk-"');
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
      setSuccessMessage('Settings saved successfully!');
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
      setError(err instanceof Error ? err.message : 'Failed to save settings');
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
      setSuccessMessage('Database reset successfully! Please restart the application.');
      setShowResetDialog(false);

      // Close the settings modal after a delay
      setTimeout(() => {
        onOpenChange(false);
        setSuccessMessage(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset database');
      setShowResetDialog(false);
    } finally {
      setResetting(false);
    }
  };

  const handleResetWorkspaceData = async () => {
    if (!projectId) {
      setError('No active workspace selected');
      return;
    }

    setResettingWorkspace(true);
    setError(null);
    setSuccessMessage(null);

    try {
      await resetWorkspaceData(projectId);
      setSuccessMessage('Workspace reset successfully!');
      setShowResetWorkspaceDialog(false);
      onWorkspaceReset?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset workspace data');
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
              {item.label}
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
              {item.label}
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
        <h3 className="text-lg font-medium mb-2">{menuItem.label}</h3>
        <p className="text-sm">This feature is coming soon.</p>
      </div>
    );
  };

  const renderModelsContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pr-2">
        <div className="grid gap-6">
          {/* API Section */}
          <div>
            <h3 className="text-sm font-semibold mb-4">API</h3>
            <div className="grid gap-4">
              {/* Provider */}
              <div className="grid gap-2">
                <label className="text-sm font-medium">Provider</label>
                <Select value="openai" disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Currently only OpenAI is supported
                </p>
              </div>

              {/* API Key */}
              <div className="grid gap-2">
                <label htmlFor="api-key" className="text-sm font-medium">
                  API Key
                  {hasExistingKey && (
                    <span className="ml-2 text-xs font-normal text-green-600 dark:text-green-400">
                      ✓ Configured
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
                    ? 'API key is already configured. Enter a new key to replace it.'
                    : 'Your OpenAI API key (starts with sk-)'}
                </p>
              </div>

              {/* Default Model */}
              <div className="grid gap-2">
                <label htmlFor="model" className="text-sm font-medium">
                  Default Model
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
                  Model to use for new conversations
                </p>
              </div>
            </div>
          </div>

          {/* Local Models Section */}
          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-semibold mb-4">Local Models</h3>
            <p className="text-xs text-muted-foreground mb-4">
              다운로드는 백그라운드에서 진행되며, 창을 닫아도 계속됩니다.
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
                          {isInstalled ? '설치됨' : '미설치'}
                        </Badge>
                        {downloadState === 'completed' && (
                          <Badge variant="secondary">다운로드 완료</Badge>
                        )}
                        {downloadState === 'queued' && (
                          <Badge variant="secondary">대기 중</Badge>
                        )}
                        {downloadState === 'downloading' && (
                          <Badge variant="secondary">다운로드 중</Badge>
                        )}
                        {downloadState === 'error' && (
                          <Badge variant="destructive">다운로드 실패</Badge>
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
                            다운로드 중…
                          </>
                        ) : isInstalled ? (
                          '재다운로드'
                        ) : (
                          '다운로드'
                        )}
                      </Button>
                      {downloadState === 'error' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadLocalModel(option)}
                          disabled={isDownloading}
                        >
                          다시 시도
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {loadingLocalModels ? (
              <p className="text-xs text-muted-foreground mt-4">Loading local models…</p>
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
                        title="Delete local model"
                      >
                        {deletingModelId === localModel.id ? (
                          <span className="text-xs">삭제 중...</span>
                        ) : (
                          <>
                            <TrashIcon className="h-4 w-4" />
                            <span className="sr-only">Delete</span>
                          </>
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground mt-4">No local models installed yet.</p>
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
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={loading || saving}>
          {saving ? 'Saving...' : 'Save'}
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
            <h3 className="text-sm font-semibold">Auto Updates</h3>
            {currentVersion && (
              <span className="text-xs text-muted-foreground font-mono">
                v{currentVersion}
              </span>
            )}
          </div>

          {/* Auto Download Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto Download</p>
              <p className="text-xs text-muted-foreground">
                Automatically download updates in the background
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
              <p className="text-sm">Current Status</p>
              <p className="text-xs text-muted-foreground">
                {readyToRestart
                  ? `Update ready - restart to apply`
                  : updateAvailable
                  ? `Version ${updateAvailable} available`
                  : 'Up to date'}
              </p>
            </div>

            {readyToRestart ? (
              <Button size="sm" onClick={restart}>
                Restart Now
              </Button>
            ) : downloading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress}%
              </div>
            ) : updateAvailable && !autoDownload ? (
              <Button size="sm" variant="outline" onClick={downloadUpdate}>
                Download
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={checkForUpdates}
                disabled={downloading}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Check
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
      <h3 className="text-sm font-semibold">Data Management</h3>
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="grid gap-2 flex-1">
          <h4 className="text-sm font-medium">Workspace Reset</h4>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Reset all workspace data without deleting the workspace itself.
            </p>
            <p className="text-xs text-muted-foreground">
              This will delete datasets, boards, conversations, and project metadata.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowResetWorkspaceDialog(true)}
            disabled={loading || saving || resetting || resettingWorkspace || !projectId}
            className="w-fit"
          >
            Reset Workspace
          </Button>
          {!projectId && (
            <p className="text-xs text-muted-foreground">No active workspace selected.</p>
          )}
        </div>
      </div>
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="grid gap-2 flex-1">
          <h4 className="text-sm font-medium">Danger Zone</h4>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Reset the database to fix initialization issues.
            </p>
            <p className="text-xs text-muted-foreground">
              ⚠️ This will permanently delete all conversations, messages, projects, and data sources.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowResetDialog(true)}
            disabled={loading || saving || resetting || resettingWorkspace}
            className="w-fit"
          >
            Reset Database
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
      setSuccessMessage('Profile saved successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
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
      setSuccessMessage('Preferences saved successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
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
              Language
            </label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ko">Korean</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used for assistant responses
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
            Cancel
          </Button>
          <Button onClick={handleSavePreferences} disabled={loading || saving}>
            {saving ? 'Saving...' : 'Save Changes'}
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
                {userName.trim() || 'No name set'}
              </span>
            </div>

            {/* Display Name Input */}
            <div className="grid gap-2">
              <label htmlFor="display-name" className="text-sm font-medium">
                Display Name
              </label>
              <Input
                id="display-name"
                type="text"
                placeholder="Enter your name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>

            {/* Google Login (UI only) */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Google Account</label>
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
                      Connecting...
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
                      Continue with Google
                    </>
                  )}
                </Button>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">User Name</label>
                    <Input
                      value={googleFullName}
                      readOnly
                      className="bg-muted/40"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Email</label>
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
              Cancel
            </Button>
            <Button onClick={handleSaveProfile} disabled={loading || saving}>
              {saving ? 'Saving...' : 'Save Changes'}
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
          <div className="text-muted-foreground">Loading settings...</div>
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
            <DialogTitle>Settings</DialogTitle>
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
              Reset Database?
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete:
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>All conversation history and messages</li>
              <li>All projects and workspaces</li>
              <li>All data sources and imported data</li>
              <li>All user settings (except API keys which are stored separately)</li>
            </ul>

            <div className="mt-4 p-3 bg-destructive/10 rounded-md border border-destructive/20">
              <p className="text-sm font-medium text-destructive">
                Are you absolutely sure you want to continue?
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetDatabase}
              disabled={resetting}
            >
              {resetting ? 'Resetting...' : 'Yes, Reset Database'}
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
              Reset Workspace?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete data in the current workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>Datasets (file imports and cached tables)</li>
              <li>Boards and board items</li>
              <li>Conversations and messages</li>
              <li>Data source metadata and cached diagnoses</li>
            </ul>

            <div className="mt-4 p-3 bg-amber-500/10 rounded-md border border-amber-500/20">
              <p className="text-sm font-medium text-amber-700">
                The workspace will remain, but its contents will be cleared.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetWorkspaceDialog(false)}
              disabled={resettingWorkspace}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetWorkspaceData}
              disabled={resettingWorkspace}
            >
              {resettingWorkspace ? 'Resetting...' : 'Yes, Reset Workspace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
