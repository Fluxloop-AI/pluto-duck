'use client';

import { useState, useEffect } from 'react';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { fetchSettings, updateSettings, resetDatabase, type UpdateSettingsRequest } from '../../lib/settingsApi';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsSaved?: (model: string) => void;
}

const MODELS = [
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
];

export function SettingsModal({ open, onOpenChange, onSettingsSaved }: SettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-5-mini');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // DB Reset states
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    setApiKey('');
    setHasExistingKey(false);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
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

