/**
 * Symdy Router — OpenRouter API integration.
 * Sends requests to the user's preferred AI provider through OpenRouter.
 * All API keys stored in browser localStorage only. Nothing leaves
 * except the constructed prompt + conversation history.
 */

const Router = (() => {
  const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

  function _getApiKey() {
    return localStorage.getItem('symdy_openrouter_key') || '';
  }

  function _getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_getApiKey()}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Symdy'
    };
  }

  async function chat(messages, { model, temperature = 0.7, maxTokens = 4096 } = {}) {
    const key = _getApiKey();
    if (!key) throw new Error('No API key configured. Go to Settings to add your OpenRouter key.');

    const body = {
      model: model || 'anthropic/claude-3.5-haiku',
      messages: messages,
      temperature,
      max_tokens: maxTokens
    };

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: _getHeaders(),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('Invalid API key. Check your OpenRouter key in Settings.');
      if (res.status === 402) throw new Error('OpenRouter account has no credits. Add funds at openrouter.ai/credits.');
      if (res.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
      throw new Error(err.error?.message || `API error (${res.status})`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from model');

    return {
      content: choice.message?.content || '',
      model: data.model || model,
      tokens: {
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
        total: data.usage?.total_tokens || 0
      },
      finishReason: choice.finish_reason || 'stop'
    };
  }

  async function testConnection() {
    try {
      await chat([{ role: 'user', content: 'Hi' }], { maxTokens: 10, temperature: 0 });
      return { connected: true };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }

  async function getModelList() {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/models`, {
        headers: { 'Authorization': `Bearer ${_getApiKey()}` }
      });
      const data = await res.json();
      return (data.data || []).filter(m => !m.id.includes('free') || m.id.includes('gemini'));
    } catch {
      return [];
    }
  }

  function estimateCost(modelCostPer1M, tokensUsed) {
    return (tokensUsed / 1000000) * modelCostPer1M;
  }

  return { chat, testConnection, getModelList, estimateCost };
})();

if (typeof module !== 'undefined') module.exports = Router;
