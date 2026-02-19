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
import {
  CALLOUT_BLOCK_START_REGEXP,
  CALLOUT_INLINE_REGEXP,
  HORIZONTAL_RULE_REGEXP,
  resolveCalloutType,
  stripCalloutQuotePrefix,
} from './transformerUtils';

const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? '---' : null),
  regExp: HORIZONTAL_RULE_REGEXP,
  replace: (parentNode) => {
    parentNode.replace($createHorizontalRuleNode());
  },
  type: 'element',
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
  regExp: CALLOUT_INLINE_REGEXP,
  replace: (parentNode, _children, match) => {
    const type = resolveCalloutType(match[1]);
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
  regExpStart: CALLOUT_BLOCK_START_REGEXP,
  regExpEnd: {
    optional: true,
    regExp: /^$/,
  },
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween) => {
    const type = resolveCalloutType(startMatch[1]);
    if (!type) {
      return false;
    }

    if (children) {
      const childText = children.map((node) => node.getTextContent()).join('\n').trim();
      rootNode.append($createCalloutNode(type, childText));
      return;
    }

    const lines = (linesInBetween || []).map((line) => stripCalloutQuotePrefix(line));
    const text = lines.join('\n').trim();
    rootNode.append($createCalloutNode(type, text));
  },
  type: 'multiline-element',
};

export const BOARD_TRANSFORMERS = [CALLOUT_BLOCK, CALLOUT_INLINE, HORIZONTAL_RULE, ...TRANSFORMERS];
