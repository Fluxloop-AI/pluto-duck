import { TRANSFORMERS, type ElementTransformer, type MultilineElementTransformer } from '@lexical/markdown';
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from '@lexical/react/LexicalHorizontalRuleNode';
import {
  $createCalloutNode,
  $isCalloutNode,
  CalloutNode,
  type CalloutType,
} from './nodes/CalloutNode';

const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode) => {
    parentNode.replace($createHorizontalRuleNode());
  },
  type: 'element',
};

const CALLOUT_TYPE_BY_MARKER: Record<string, CalloutType> = {
  NOTE: 'info',
  IMPORTANT: 'info',
  WARNING: 'warning',
  TIP: 'success',
  CAUTION: 'error',
};

const CALLOUT_MARKER_BY_TYPE: Record<CalloutType, string> = {
  info: 'NOTE',
  warning: 'WARNING',
  success: 'TIP',
  error: 'CAUTION',
};

const CALLOUT_INLINE: ElementTransformer = {
  dependencies: [CalloutNode],
  export: () => null,
  regExp: /^>\s*\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*(.*)$/i,
  replace: (parentNode, _children, match) => {
    const marker = match[1]?.toUpperCase();
    const type = CALLOUT_TYPE_BY_MARKER[marker];
    if (!type) {
      return false;
    }
    const text = (match[2] || '').trim();
    parentNode.replace($createCalloutNode(type, text));
  },
  type: 'element',
};

const CALLOUT_BLOCK: MultilineElementTransformer = {
  dependencies: [CalloutNode],
  export: (node) => {
    if (!$isCalloutNode(node)) {
      return null;
    }

    const marker = CALLOUT_MARKER_BY_TYPE[node.getCalloutType()];
    const text = node.getText().trim();
    if (!text) {
      return `> [!${marker}]`;
    }

    const body = text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    return `> [!${marker}]\n${body}`;
  },
  regExpStart: /^>\s*\[!(NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]\s*$/i,
  regExpEnd: {
    optional: true,
    regExp: /^$/,
  },
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween) => {
    const marker = startMatch[1]?.toUpperCase();
    const type = CALLOUT_TYPE_BY_MARKER[marker];
    if (!type) {
      return false;
    }

    if (children) {
      const childText = children.map((node) => node.getTextContent()).join('\n').trim();
      rootNode.append($createCalloutNode(type, childText));
      return;
    }

    const lines = (linesInBetween || [])
      .map((line) => line.replace(/^>\s?/, ''))
      .map((line) => line.trimEnd());
    const text = lines.join('\n').trim();
    rootNode.append($createCalloutNode(type, text));
  },
  type: 'multiline-element',
};

export const BOARD_TRANSFORMERS = [CALLOUT_BLOCK, CALLOUT_INLINE, HORIZONTAL_RULE, ...TRANSFORMERS];
