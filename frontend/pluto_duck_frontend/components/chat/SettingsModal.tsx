'use client';

import { useState, useEffect, useRef } from 'react';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon, TrashIcon, Loader2 } from 'lucide-react';
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
import { fetchSettings, updateSettings, resetDatabase, type UpdateSettingsRequest } from '../../lib/settingsApi';
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
}

const MODELS = ALL_MODEL_OPTIONS;

export function SettingsModal({ open, onOpenChange, onSettingsSaved }: SettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);
  const [localDownloadStates, setLocalDownloadStates] = useState<Record<string, LocalDownloadStatus>>({});
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  
  // DB Reset states
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);

  const downloadPollRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const isAnyDownloadInProgress = Object.values(localDownloadStates).some(
    state => state.status === 'queued' || state.status === 'downloading',
  );

  useEffect(() => {
    if (open) {
      loadSettings();
    }
    return () => {
      Object.values(downloadPollRef.current).forEach(timer => clearTimeout(timer));
      downloadPollRef.current = {};
    };
  }, [open]);

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

  return (
    <>
      {/* Main Settings Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Configure your OpenAI API settings and preferences.
            </DialogDescription>
          </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading settings...</div>
          </div>
        ) : (
          <div className="grid gap-6 py-4">
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

            {/* Local Models */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Local Models</label>
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
                <p className="text-xs text-muted-foreground">Loading local models…</p>
              ) : localModels.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">No local models installed yet.</p>
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

            {/* Danger Zone - Database Reset */}
            <div className="mt-6 border-t border-border pt-6">
              <div className="grid gap-4">
                <div className="flex items-start gap-3">
                  <AlertTriangleIcon className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                  <div className="grid gap-2 flex-1">
                    <h3 className="text-sm font-semibold">Danger Zone</h3>
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
                      disabled={loading || saving || resetting}
                      className="w-fit"
                    >
                      Reset Database
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
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
    </>
  );
}

