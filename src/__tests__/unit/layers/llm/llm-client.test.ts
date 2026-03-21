import { LlmClient, LlmClientError, AnthropicMessagesApi } from '../../../../layers/extraction/llm/llm-client';
import { LlmExtractionConfig, DEFAULT_LLM_CONFIG } from '../../../../layers/extraction/llm/types';

describe('LlmClient', () => {
  const config: LlmExtractionConfig = {
    ...DEFAULT_LLM_CONFIG,
    apiKey: 'test-api-key',
    maxRetries: 2,
    timeoutMs: 5000,
  };

  const mockSuccessResponse = {
    content: [{ type: 'text' as const, text: '{"name": "Test Figure"}' }],
    model: 'claude-haiku-4-5-20251001',
    usage: { input_tokens: 1000, output_tokens: 200 },
  };

  let mockCreate: jest.Mock;
  let mockMessagesApi: AnthropicMessagesApi;

  beforeEach(() => {
    mockCreate = jest.fn();
    mockMessagesApi = { create: mockCreate };
  });

  it('makes a successful API call and returns parsed response', async () => {
    mockCreate.mockResolvedValue(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('System prompt', 'User message');

    expect(result.content).toBe('{"name": "Test Figure"}');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('passes correct parameters to the API', async () => {
    mockCreate.mockResolvedValue(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    await client.extract('My system prompt', 'My user message', { model: 'custom-model', temperature: 0.5 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'custom-model',
        temperature: 0.5,
        system: 'My system prompt',
        messages: [{ role: 'user', content: 'My user message' }],
        max_tokens: config.maxOutputTokens,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('uses default model and temperature when not specified', async () => {
    mockCreate.mockResolvedValue(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    await client.extract('system', 'user');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: config.primaryModel,
        temperature: 0,
      }),
      expect.anything(),
    );
  });

  it('retries on 429 status and eventually succeeds', async () => {
    const error429 = new Error('Rate limited');
    (error429 as any).status = 429;

    mockCreate
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('system', 'user');

    expect(result.content).toBe('{"name": "Test Figure"}');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 status and eventually succeeds', async () => {
    const error500 = new Error('Server error');
    (error500 as any).status = 500;

    mockCreate
      .mockRejectedValueOnce(error500)
      .mockResolvedValueOnce(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('system', 'user');

    expect(result.content).toBe('{"name": "Test Figure"}');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on retryable errors', async () => {
    const error429 = new Error('Rate limited');
    (error429 as any).status = 429;

    mockCreate.mockRejectedValue(error429);

    const client = new LlmClient(config, mockMessagesApi);
    await expect(client.extract('system', 'user')).rejects.toThrow(LlmClientError);
    // 1 initial + 2 retries = 3 total
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-retryable errors (e.g., 400)', async () => {
    const error400 = new Error('Bad request');
    (error400 as any).status = 400;

    mockCreate.mockRejectedValue(error400);

    const client = new LlmClient(config, mockMessagesApi);
    await expect(client.extract('system', 'user')).rejects.toThrow(LlmClientError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does not retry on auth errors (401)', async () => {
    const error401 = new Error('Unauthorized');
    (error401 as any).status = 401;

    mockCreate.mockRejectedValue(error401);

    const client = new LlmClient(config, mockMessagesApi);
    await expect(client.extract('system', 'user')).rejects.toThrow(LlmClientError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('handles timeout via AbortController', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    mockCreate.mockRejectedValue(abortError);

    const client = new LlmClient({ ...config, timeoutMs: 1, maxRetries: 0 }, mockMessagesApi);
    await expect(client.extract('system', 'user')).rejects.toThrow(LlmClientError);
    await expect(client.extract('system', 'user')).rejects.toThrow(/timed out/);
  });

  it('handles response with no text block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('system', 'user');
    expect(result.content).toBe('');
  });

  it('retries on 503 status', async () => {
    const error503 = new Error('Service unavailable');
    (error503 as any).status = 503;

    mockCreate
      .mockRejectedValueOnce(error503)
      .mockResolvedValueOnce(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('system', 'user');
    expect(result.content).toBe('{"name": "Test Figure"}');
  });

  it('retries on 529 overloaded status', async () => {
    const error529 = new Error('Overloaded');
    (error529 as any).status = 529;

    mockCreate
      .mockRejectedValueOnce(error529)
      .mockResolvedValueOnce(mockSuccessResponse);

    const client = new LlmClient(config, mockMessagesApi);
    const result = await client.extract('system', 'user');
    expect(result.content).toBe('{"name": "Test Figure"}');
  });

  it('retries timeout errors when retries remain', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    mockCreate
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(mockSuccessResponse);

    const client = new LlmClient({ ...config, timeoutMs: 1, maxRetries: 2 }, mockMessagesApi);
    const result = await client.extract('system', 'user');
    expect(result.content).toBe('{"name": "Test Figure"}');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
