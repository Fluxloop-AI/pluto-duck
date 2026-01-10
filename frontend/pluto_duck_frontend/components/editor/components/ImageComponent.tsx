'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Image as ImageIcon, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_DELETE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  NodeKey,
} from 'lexical';

interface ImageComponentProps {
  src: string;
  altText: string;
  width: number;
  height: number;
  nodeKey: NodeKey;
  resizable: boolean;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export function ImageComponent({
  src,
  altText,
  width,
  height,
  nodeKey,
  resizable,
}: ImageComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Loading state
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [isInView, setIsInView] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  const MAX_RETRIES = 3;

  // Delete handling
  const onDelete = useCallback((payload: KeyboardEvent) => {
    if (isSelected && $isNodeSelection($getSelection())) {
      const event: KeyboardEvent = payload;
      event.preventDefault();
      const node = $getNodeByKey(nodeKey);
      if (node) {
        node.remove();
        return true; // Stop propagation - we handled this command
      }
    }
    return false;
  }, [isSelected, nodeKey]);

  // Register click and keyboard handlers
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          if (containerRef.current?.contains(event.target as Node)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, nodeKey, onDelete, setSelected]);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (!src || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before entering viewport
        threshold: 0,
      }
    );

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [src]);

  // Load image when in view
  useEffect(() => {
    if (!isInView || !src || loadState === 'loaded') return;

    setLoadState('loading');

    const img = new Image();
    
    img.onload = () => {
      setLoadState('loaded');
      setRetryCount(0);
    };
    
    img.onerror = () => {
      if (retryCount < MAX_RETRIES) {
        // Auto retry with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`[ImageComponent] Load failed, retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms`);
        
        setTimeout(() => {
          setRetryCount((prev) => prev + 1);
          // Reset loadState to trigger reload
          setLoadState('idle');
        }, delay);
      } else {
        setLoadState('error');
      }
    };
    
    img.src = src;
  }, [isInView, src, retryCount, loadState]);

  // Manual retry
  const handleRetry = useCallback(() => {
    setRetryCount(0);
    setLoadState('idle');
  }, []);

  // No source - show placeholder
  if (!src) {
    return (
      <div 
        ref={containerRef}
        className={`relative inline-block ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      >
        <div 
          className="flex items-center justify-center bg-muted rounded-lg border-2 border-dashed border-muted-foreground/25"
          style={{ width, height }}
        >
          <div className="text-center text-muted-foreground">
            <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <span className="text-sm">No Image</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`relative inline-block ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      style={{ width, height, maxWidth: '100%' }}
    >
      {/* Blur placeholder / skeleton */}
      {(loadState === 'idle' || loadState === 'loading') && (
        <div 
          className="absolute inset-0 bg-muted rounded-lg animate-pulse flex items-center justify-center"
          style={{ width, height }}
        >
          <div className="text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 mx-auto mb-1 animate-spin opacity-50" />
            <span className="text-xs">
              {retryCount > 0 ? `Retry ${retryCount}/${MAX_RETRIES}...` : 'Loading...'}
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadState === 'error' && (
        <div 
          className="absolute inset-0 bg-muted rounded-lg flex items-center justify-center"
          style={{ width, height }}
        >
          <div className="text-center text-muted-foreground space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto text-red-500 opacity-70" />
            <span className="text-xs block">Failed to load</span>
            <button
              onClick={handleRetry}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 mx-auto"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Actual image - only render when loaded */}
      <img
        ref={imageRef}
        src={loadState === 'loaded' ? src : undefined}
        alt={altText}
        style={{ 
          width, 
          height, 
          maxWidth: '100%',
          opacity: loadState === 'loaded' ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out',
        }}
        className="rounded-lg object-cover"
        loading="lazy"
      />
      
      {/* Selection Overlay */}
      {isSelected && resizable && (
        <div className="absolute inset-0 pointer-events-none border-2 border-blue-500 rounded-lg" />
      )}
    </div>
  );
}
