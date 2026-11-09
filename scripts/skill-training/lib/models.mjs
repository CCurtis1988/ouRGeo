// Student arms (spec §3). `local` arms are subject to the smart-box duty cycle
// and run one request at a time.

export const MODELS = {
  qwen: { provider: 'llamacpp', model: 'strata/Qwen3.8-Flash', localUrl: 'http://10.0.0.10:8080/v1', local: true, worstCaseMs: 10 * 60 * 1000 },
  'qwen-35b': { provider: 'llamacpp', model: 'strata/Qwen3.6-35b', localUrl: 'http://10.0.0.10:8080/v1', local: true, worstCaseMs: 12 * 60 * 1000 },
  gemma: { provider: 'ollama', model: 'gemma4:e4b', localUrl: 'http://10.0.0.10:11434', local: true, worstCaseMs: 15 * 60 * 1000 },
  haiku: { provider: 'claude-cli', model: 'haiku', local: false, worstCaseMs: 5 * 60 * 1000 },
  sonnet: { provider: 'claude-cli', model: 'sonnet', local: false, worstCaseMs: 5 * 60 * 1000 },
  opus: { provider: 'claude-cli', model: 'opus', local: false, worstCaseMs: 6 * 60 * 1000 },
}
