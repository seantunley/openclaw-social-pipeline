/**
 * LLM abstraction layer.
 *
 * Uses the Anthropic SDK (@anthropic-ai/sdk) to generate text completions.
 * Falls back to a meaningful error when the SDK or API key is unavailable.
 */

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Cache the resolved API key so we only read env once
let cachedApiKey: string | undefined;

function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;
  const key =
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_API_KEY ??
    '';
  if (!key) {
    throw new Error(
      'No Anthropic API key found. Set ANTHROPIC_API_KEY or CLAUDE_API_KEY in your environment.'
    );
  }
  cachedApiKey = key;
  return key;
}

/**
 * Generate text using the Anthropic Claude API.
 *
 * @param systemPrompt - The system-level instruction for the model.
 * @param userPrompt   - The user message / task content.
 * @param options      - Optional model, temperature, and maxTokens overrides.
 * @returns The generated text string.
 */
export async function llmGenerate(
  systemPrompt: string,
  userPrompt: string,
  options?: LlmOptions
): Promise<string> {
  const {
    model = 'claude-sonnet-4-20250514',
    temperature = 0.7,
    maxTokens = 4096,
  } = options ?? {};

  const apiKey = getApiKey();

  // Dynamic import so the module only fails when actually used (not at load time)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: Anthropic } = await import('@anthropic-ai/sdk');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Extract text from the response content blocks
  const textBlocks = response.content.filter(
    (block): block is { type: 'text'; text: string } => block.type === 'text'
  );

  if (textBlocks.length === 0) {
    throw new Error('LLM returned no text content');
  }

  return textBlocks.map((b) => b.text).join('\n');
}
