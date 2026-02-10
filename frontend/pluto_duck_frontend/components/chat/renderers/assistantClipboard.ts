export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>;
}

function resolveClipboard(clipboard?: ClipboardWriter): ClipboardWriter | undefined {
  if (clipboard) {
    return clipboard;
  }
  if (typeof window === 'undefined') {
    return undefined;
  }
  return navigator?.clipboard;
}

export async function writeAssistantMessageToClipboard(
  text: string,
  clipboard?: ClipboardWriter
): Promise<boolean> {
  const writer = resolveClipboard(clipboard);
  if (!writer?.writeText) {
    return false;
  }

  try {
    await writer.writeText(text);
    return true;
  } catch {
    return false;
  }
}
