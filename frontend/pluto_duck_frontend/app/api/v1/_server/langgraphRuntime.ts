import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonMap = Record<string, unknown>;

interface LangGraphPlanParams {
  question: string;
  model: string | null;
  approval_required: boolean;
}

export interface LangGraphPlan {
  answer: string;
  approval_required: boolean;
  tool_name: string;
  tool_input: JsonMap;
  backend: 'module' | 'fallback';
  adapter: 'deepagents_vendor' | 'langgraph_minimal' | 'fallback_stub';
  fallback_reason?: string;
}

function buildAnswer(question: string, model: string | null, suffix: string): string {
  const normalized = question.trim();
  const prefix = model ? `[${model}] ` : '';
  return `${prefix}${normalized}\n\n(${suffix})`;
}

function createFallbackPlan(params: LangGraphPlanParams, reason?: string): LangGraphPlan {
  return {
    answer: buildAnswer(params.question, params.model, 'LangGraph JS fallback response'),
    approval_required: params.approval_required,
    tool_name: params.approval_required ? 'write_file' : 'search',
    tool_input: params.approval_required
      ? { description: 'Approve file write' }
      : { query: params.question },
    backend: 'fallback',
    adapter: 'fallback_stub',
    fallback_reason: reason,
  };
}

type DynamicImport = (specifier: string) => Promise<unknown>;

function getDynamicImport(): DynamicImport {
  return new Function('specifier', 'return import(specifier);') as DynamicImport;
}

type DeepagentsAdapterModule = {
  buildPlutoDeepagentsPlan?: (params: LangGraphPlanParams) => Promise<unknown>;
  default?: {
    buildPlutoDeepagentsPlan?: (params: LangGraphPlanParams) => Promise<unknown>;
  };
};

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadDeepagentsAdapterModule(): Promise<DeepagentsAdapterModule | null> {
  const dynamicImport = getDynamicImport();
  const deepagentsSpecifiers = [
    pathToFileURL(resolve(process.cwd(), 'vendor/deepagents/dist/index.cjs')).href,
    pathToFileURL(resolve(process.cwd(), 'frontend/pluto_duck_frontend/vendor/deepagents/dist/index.cjs')).href,
    new URL('../../../../vendor/deepagents/dist/index.cjs', import.meta.url).href,
  ];

  for (const specifier of deepagentsSpecifiers) {
    try {
      const loaded = await dynamicImport(specifier);
      if (typeof loaded !== 'object' || loaded === null) {
        continue;
      }
      return loaded as DeepagentsAdapterModule;
    } catch (_error) {
      // Try next candidate path.
    }
  }
  return null;
}

async function invokeDeepagentsAdapter(
  moduleNs: DeepagentsAdapterModule,
  params: LangGraphPlanParams
): Promise<{
  answer: string;
  tool_name: string;
  tool_input: JsonMap;
} | null> {
  const planBuilder = moduleNs.buildPlutoDeepagentsPlan;
  const defaultPlanBuilder = moduleNs.default?.buildPlutoDeepagentsPlan;
  const effectivePlanBuilder =
    typeof planBuilder === 'function'
      ? planBuilder
      : typeof defaultPlanBuilder === 'function'
        ? defaultPlanBuilder
        : null;
  if (!effectivePlanBuilder) {
    return null;
  }

  const planResult = await effectivePlanBuilder(params);
  if (!isJsonMap(planResult)) {
    return null;
  }

  const answer = planResult.answer;
  const toolName = planResult.tool_name;
  const toolInput = planResult.tool_input;

  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return null;
  }
  if (typeof toolName !== 'string' || toolName.trim().length === 0) {
    return null;
  }
  if (!isJsonMap(toolInput)) {
    return null;
  }

  return {
    answer,
    tool_name: toolName,
    tool_input: toolInput,
  };
}

async function loadLangGraphModule(): Promise<Record<string, unknown> | null> {
  const dynamicImport = getDynamicImport();
  try {
    const loaded = await dynamicImport('@langchain/langgraph');
    if (typeof loaded !== 'object' || loaded === null) {
      return null;
    }
    return loaded as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

async function invokeMinimalGraph(
  moduleNs: Record<string, unknown>,
  question: string,
  model: string | null
): Promise<string | null> {
  const StateGraph = moduleNs.StateGraph;
  const Annotation = moduleNs.Annotation as
    | {
        Root?: (shape: Record<string, unknown>) => unknown;
      }
    | undefined;
  const START = (moduleNs.START as string | undefined) ?? '__start__';
  const END = (moduleNs.END as string | undefined) ?? '__end__';

  if (typeof StateGraph !== 'function' || typeof Annotation?.Root !== 'function') {
    return null;
  }

  const AnnotationFactory = moduleNs.Annotation as {
    Root: (shape: Record<string, unknown>) => unknown;
  } & ((...args: unknown[]) => unknown);

  // Keep this graph intentionally minimal until full Phase D LangGraph migration.
  const stateAnnotation = AnnotationFactory.Root({
    question: AnnotationFactory(),
    model: AnnotationFactory(),
    answer: AnnotationFactory(),
  });

  const graphBuilder = new (StateGraph as new (state: unknown) => any)(stateAnnotation);
  graphBuilder.addNode('compose_answer', async (state: { question?: unknown; model?: unknown }) => {
    const questionText = typeof state.question === 'string' ? state.question : question;
    const modelName = typeof state.model === 'string' ? state.model : model;
    return {
      answer: buildAnswer(questionText, modelName ?? null, 'LangGraph JS module response'),
    };
  });
  graphBuilder.addEdge(START, 'compose_answer');
  graphBuilder.addEdge('compose_answer', END);

  const compiled = graphBuilder.compile();
  if (!compiled || typeof compiled.invoke !== 'function') {
    return null;
  }
  const output = (await compiled.invoke({
    question,
    model,
    answer: '',
  })) as { answer?: unknown } | null;

  if (typeof output?.answer !== 'string' || output.answer.trim().length === 0) {
    return null;
  }
  return output.answer;
}

export async function buildLangGraphPlan(params: LangGraphPlanParams): Promise<LangGraphPlan> {
  const fallbackReasons: string[] = [];

  const deepagentsModuleNs = await loadDeepagentsAdapterModule();
  if (deepagentsModuleNs) {
    try {
      const deepagentsPlan = await invokeDeepagentsAdapter(deepagentsModuleNs, params);
      if (deepagentsPlan) {
        return {
          answer: deepagentsPlan.answer,
          approval_required: params.approval_required,
          tool_name: deepagentsPlan.tool_name,
          tool_input: deepagentsPlan.tool_input,
          backend: 'module',
          adapter: 'deepagents_vendor',
        };
      }
      fallbackReasons.push('deepagents_adapter_invalid_result');
    } catch (_error) {
      fallbackReasons.push('deepagents_adapter_runtime_error');
    }
  } else {
    fallbackReasons.push('deepagents_adapter_missing');
  }

  const moduleNs = await loadLangGraphModule();
  if (!moduleNs) {
    fallbackReasons.push('langgraph_module_missing');
    return createFallbackPlan(params, fallbackReasons.join(';'));
  }

  try {
    const answer = await invokeMinimalGraph(moduleNs, params.question, params.model);
    if (!answer) {
      fallbackReasons.push('langgraph_graph_compile_or_invoke_failed');
      return createFallbackPlan(params, fallbackReasons.join(';'));
    }
    return {
      answer,
      approval_required: params.approval_required,
      tool_name: params.approval_required ? 'write_file' : 'search',
      tool_input: params.approval_required
        ? { description: 'Approve file write' }
        : { query: params.question },
      backend: 'module',
      adapter: 'langgraph_minimal',
    };
  } catch (_error) {
    fallbackReasons.push('langgraph_runtime_error');
    return createFallbackPlan(params, fallbackReasons.join(';'));
  }
}
