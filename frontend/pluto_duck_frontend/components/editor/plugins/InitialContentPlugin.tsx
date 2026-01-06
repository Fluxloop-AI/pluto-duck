import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useState } from 'react';

export function InitialContentPlugin({ content }: { content: string | null }) {
  const [editor] = useLexicalComposerContext();
  const [isLoaded, setIsLoaded] = useState(false);

  // Reset loaded state when content changes significantly (e.g. board switch)
  // Actually, since we force remount BoardEditor with key, this component will also remount.
  // But strictly speaking, if we want to support external updates without remount, we might need this.
  // Given the current architecture, BoardEditor is remounted, so we just need to ensure
  // it loads if content is present.

  useEffect(() => {
    // If content is null/empty string, we might want to clear editor or do nothing.
    // Assuming empty string means empty document.
    
    if (isLoaded) return;

    // Use queueMicrotask to defer setEditorState outside of React's rendering cycle
    // This prevents the "flushSync was called from inside a lifecycle method" warning
    queueMicrotask(() => {
      try {
        console.log('[InitialContentPlugin] Loading content:', content ? content.substring(0, 100) + '...' : 'null');
        if (content) {
            const editorState = editor.parseEditorState(content);
            editor.setEditorState(editorState);
            console.log('[InitialContentPlugin] Content loaded successfully');
        } else {
            console.log('[InitialContentPlugin] No content to load');
        }
        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load initial content:', error);
      }
    });
  }, [content, editor, isLoaded]);

  return null;
}

