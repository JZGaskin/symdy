/**
 * Symdy Router — OpenRouter API integration.
 * Sends requests to the user's preferred AI provider through OpenRouter.
 * All API keys stored in browser localStorage only. Nothing leaves
 * except the constructed prompt + conversation history.
 */

const Router = (() => {
  // Provider configurations. OpenRouter is the default gateway.
  // Users can also bring direct API keys for specific providers.
  const PROVIDERS = {
    openrouter: {
      base: 'https://openrouter.ai/api/v1',
      headers: (key) => ({
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Symdy'
      }),
      keyPrefix: 'sk-or-'
    },
    deepseek: {
      base: 'https://api.deepseek.com/v1',
      headers: (key) => ({ 'Authorization': `Bearer ${key}` }),
      keyPrefix: 'sk-'
    },
    anthropic: {
      base: 'https://api.anthropic.com/v1',
      headers: (key) => ({
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      }),
      keyPrefix: 'sk-ant-'
    },
    openai: {
      base: 'https://api.openai.com/v1',
      headers: (key) => ({ 'Authorization': `Bearer ${key}` }),
      keyPrefix: 'sk-'
    }
  };

  function _getProvider() {
    // Check for direct provider keys first, fall back to OpenRouter
    const keys = {
      openrouter: localStorage.getItem('symdy_openrouter_key') || '',
      deepseek: localStorage.getItem('symdy_deepseek_key') || '',
      anthropic: localStorage.getItem('symdy_anthropic_key') || '',
      openai: localStorage.getItem('symdy_openai_key') || ''
    };
    // OpenRouter is default gateway — use if configured
    if (keys.openrouter) return { name: 'openrouter', key: keys.openrouter, ...PROVIDERS.openrouter };
    // Direct provider fallbacks
    if (keys.deepseek) return { name: 'deepseek', key: keys.deepseek, ...PROVIDERS.deepseek };
    if (keys.anthropic) return { name: 'anthropic', key: keys.anthropic, ...PROVIDERS.anthropic };
    if (keys.openai) return { name: 'openai', key: keys.openai, ...PROVIDERS.openai };
    return null;
  }

  function _getApiKey() {
    const provider = _getProvider();
    return provider ? provider.key : '';
  }

  async function chat(messages, { model, temperature = 0.7, maxTokens = 4096 } = {}) {
    const provider = _getProvider();
    if (!provider) throw new Error('No API key configured. Go to Settings to add your API key.');

    // Translate model names for direct providers (OpenRouter uses provider/model format)
    let useModel = model || 'anthropic/claude-3.5-haiku';
    if (provider.name !== 'openrouter') {
      useModel = _translateModelForProvider(useModel, provider.name);
    }

    const body = {
      model: useModel,
      messages: messages,
      temperature,
      max_tokens: maxTokens
    };

    const res = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...provider.headers(provider.key) },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(`Invalid API key for ${provider.name}. Check your key in Settings.`);
      if (res.status === 402) throw new Error(`${provider.name} account has no credits. Add funds and try again.`);
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

  // Translate OpenRouter model IDs to provider-native model names
  function _translateModelForProvider(orModel, provider) {
    const map = {
      deepseek: {
        'anthropic/claude-3.5-haiku': 'deepseek-chat',
        'anthropic/claude-sonnet-4-20250514': 'deepseek-reasoner',
        'anthropic/claude-opus-4-20250514': 'deepseek-reasoner',
        'google/gemini-2.5-pro-preview-05-06': 'deepseek-chat'
      },
      openai: {
        'anthropic/claude-3.5-haiku': 'gpt-4o-mini',
        'anthropic/claude-sonnet-4-20250514': 'gpt-4o',
        'anthropic/claude-opus-4-20250514': 'gpt-4o',
        'google/gemini-2.5-pro-preview-05-06': 'gpt-4o'
      },
      anthropic: {
        'anthropic/claude-3.5-haiku': 'claude-3-5-haiku-latest',
        'anthropic/claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
        'anthropic/claude-opus-4-20250514': 'claude-opus-4-20250514',
        'google/gemini-2.5-pro-preview-05-06': 'claude-sonnet-4-20250514'
      }
    };
    return (map[provider] && map[provider][orModel]) ? map[provider][orModel] : orModel;
  }

  async function getConfiguredProviders() {
    const providers = [];
    if (localStorage.getItem('symdy_openrouter_key')) providers.push('openrouter');
    if (localStorage.getItem('symdy_deepseek_key')) providers.push('deepseek');
    if (localStorage.getItem('symdy_anthropic_key')) providers.push('anthropic');
    if (localStorage.getItem('symdy_openai_key')) providers.push('openai');
    return providers;
  }

  function estimateCost(modelCostPer1M, tokensUsed) {
    return (tokensUsed / 1000000) * modelCostPer1M;
  }

  return { chat, testConnection, getConfiguredProviders, estimateCost };
})();

if (typeof module !== 'undefined') module.exports = Router;
