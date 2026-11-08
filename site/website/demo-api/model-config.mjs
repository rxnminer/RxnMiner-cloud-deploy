// Endpoint configuration only. Visitor credentials are supplied per request.
export function qwenConfig(env = process.env) {
  const id = env.Q38_MODEL || "Qwen3.8-Flash-Next-FP8";
  return {
    provider: "openai-compatible",
    id,
    label: "Qwen3.8-Flash-Next · local deployment",
    default: true,
    pricing: null,
    baseUrl: env.Q38_BASE_URL || "http://192.168.198.191:8015/v1",
  };
}

export function piModelCatalog(env = process.env) {
  const model = qwenConfig(env);
  return {
    providers: {
      [model.provider]: {
        baseUrl: model.baseUrl,
        api: "openai-completions",
        models: [{
          id: model.id, name: model.label,
          reasoning: true, input: ["text", "image"],
          contextWindow: 262144, maxTokens: 32768,
        }],
      },
    },
  };
}
