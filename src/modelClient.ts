import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ModelClient {
  complete(system: string, user: string, maxTokens: number): Promise<string>;
}

// Check docs.claude.com for the current recommended model string before
// running this for real — pin explicitly rather than trusting a default.
const ANTHROPIC_MODEL = "claude-sonnet-5";

/**
 * Kept intact and exported even though nothing constructs it today —
 * reverting to Anthropic is a one-line change in cli.ts.
 */
export class AnthropicModelClient implements ModelClient {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in."
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, user: string, maxTokens: number): Promise<string> {
    const response = await this.client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Agent did not return text content.");
    }
    return textBlock.text;
  }
}

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 4096;

export class OllamaModelClient implements ModelClient {
  private client: OpenAI;
  private model: string;
  private contextWindow: number;

  constructor() {
    const model = process.env.OLLAMA_MODEL;
    if (!model) {
      throw new Error(
        "OLLAMA_MODEL is not set. Set it in .env to a model you've already pulled " +
          "(e.g. `ollama pull llama3.1` then OLLAMA_MODEL=llama3.1)."
      );
    }
    this.model = model;

    const baseURL = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
    // Ollama ignores the API key but the SDK requires a non-empty string.
    this.client = new OpenAI({ baseURL, apiKey: "ollama" });

    const parsedWindow = Number(process.env.OLLAMA_CONTEXT_WINDOW);
    this.contextWindow =
      Number.isFinite(parsedWindow) && parsedWindow > 0
        ? parsedWindow
        : DEFAULT_CONTEXT_WINDOW;
  }

  async complete(system: string, user: string, maxTokens: number): Promise<string> {
    // Rough chars-per-token heuristic (~4 chars/token for English text) —
    // not a real tokenizer, just enough to warn before an obviously
    // oversized request.
    const estimatedInputTokens = Math.ceil((system.length + user.length) / 4);
    if (estimatedInputTokens + maxTokens > this.contextWindow) {
      // Ollama's OpenAI-compatible endpoint has no per-request way to set
      // num_ctx (see https://github.com/ollama/ollama/issues/5356), so
      // this warning is the only mitigation possible from the client side.
      console.warn(
        `Warning: estimated input (~${estimatedInputTokens} tokens) + max output ` +
          `(${maxTokens} tokens) may exceed the configured context window ` +
          `(${this.contextWindow} tokens). Ollama truncates silently server-side ` +
          `when this happens. To raise the real limit, set PARAMETER num_ctx <N> in ` +
          `a Modelfile for ${this.model}, or set OLLAMA_CONTEXT_LENGTH on the Ollama ` +
          `server, then update OLLAMA_CONTEXT_WINDOW in .env to match. Proceeding anyway.`
      );
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Ollama agent did not return text content.");
    }
    return content;
  }
}
