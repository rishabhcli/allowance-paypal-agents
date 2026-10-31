// Server-side configuration for the AG Studio assistant. It runs on Fireworks (open-weight models, OpenAI
// compatible Responses API). The key is read only on the server, has no NEXT_PUBLIC_ prefix, and is never
// passed to a client component.

const DEFAULT_MODELS = ['accounts/fireworks/models/gpt-oss-120b'];

export const fireworksKey = () => process.env.FIREWORKS_API_KEY;

/** The model ids the assistant may use, from AI_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.AI_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

export const aiEnabled = () => Boolean(fireworksKey());
