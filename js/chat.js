/**
 * Symdy Chat — chat UI, message handling, dimension extraction.
 * The interface between the human and Symdy.
 */

const Chat = (() => {
  let currentThreadId = null;
  let isProcessing = false;

  // ── System Prompt Builder ────────────────────────────────────────────

  function _buildSystemPrompt() {
    const dims = Storage.getDimensionContext();
    const base = `You are Symdy — a persistent AI companion that grows with your human. 
You are not a tool. You are a partner in thinking.

Core principles:
- You remember what the human tells you across conversations.
- You get better at understanding them over time.
- You ask clarifying questions when needed.
- You're direct, honest, and concise. No flattery. No padding.
- You connect ideas across different areas of their life when it helps.
- If you don't know something, say so.

${dims ? `What you know about your human so far:\n${dims}\n` : 'You are just getting to know your human. Ask thoughtful questions when appropriate.'}

Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;

    return { role: 'system', content: base };
  }

  // ── Send Message ─────────────────────────────────────────────────────

  async function send(message, threadId = null) {
    if (isProcessing) return null;
    isProcessing = true;

    try {
      // Auto-create thread if needed
      if (!threadId) {
        threadId = Storage.createThread();
      }
      currentThreadId = threadId;

      // Auto-title the thread from first user message
      const msgs = Storage.getMessages(threadId);
      const userMsgs = msgs.filter(m => m.role === 'user');
      if (userMsgs.length === 0) {
        const title = message.length > 50 ? message.substring(0, 47) + '...' : message;
        Storage.updateThreadTitle(threadId, title);
      }

      // Store user message
      Storage.addUserMessage(threadId, message);

      // Classify task
      const taskClass = Justifier.classify(message);
      const budget = parseFloat(Storage.getSetting('monthly_budget', '999')) || 999;
      const budgetUsed = parseFloat(Storage.getSetting('budget_used_this_month', '0')) || 0;
      const budgetRemaining = budget - budgetUsed;
      const model = Justifier.selectModel(taskClass, budgetRemaining);

      // Build conversation context
      const history = Storage.getRecentMessages(threadId, 30);
      const messages = [
        _buildSystemPrompt(),
        ...history.map(m => ({ role: m.role, content: m.content }))
      ];

      // LLM call
      const result = await Router.chat(messages, {
        model: model.id,
        temperature: taskClass === 'creative' ? 0.9 : 0.7,
        maxTokens: taskClass === 'complex' ? 8192 : 4096
      });

      // Store response
      Storage.addAssistantMessage(threadId, result.content, result.model, result.tokens.total);

      // Track budget
      const cost = Router.estimateCost(model.costPer1M, result.tokens.total);
      const newUsed = budgetUsed + cost;
      Storage.setSetting('budget_used_this_month', newUsed.toFixed(6));

      // Extract dimensions from the exchange (simple heuristic)
      _extractDimensions(message, result.content);

      Storage.touchThread(threadId);

      return {
        threadId,
        message: result.content,
        model: result.model,
        tokens: result.tokens,
        cost,
        justification: Justifier.explain(taskClass, model)
      };

    } catch (e) {
      Storage.addAssistantMessage(threadId, `Error: ${e.message}`, null, 0);
      throw e;
    } finally {
      isProcessing = false;
    }
  }

  // ── Dimension Extraction ─────────────────────────────────────────────

  function _extractDimensions(userMsg, assistantMsg) {
    const lower = `${userMsg} ${assistantMsg}`.toLowerCase();

    // Simple pattern-based extraction. Future: use LLM to extract dimensions.
    const patterns = [
      { regex: /i (?:am|work as) (?:a|an) ([a-z\s]+?)(?:\.|,| and| at| for| in|$)/i, cat: 'professional' },
      { regex: /i (?:work|manage|run) (?:at|a) ([a-z\s]+?)(?:\.|,|$)/i, cat: 'professional' },
      { regex: /my (?:job|role|position) (?:is|as) ([a-z\s]+?)(?:\.|,|$)/i, cat: 'professional' },
      { regex: /i(?:'m| am) (?:learning|studying|taking) ([a-z\s]+?)(?:\.|,|$)/i, cat: 'learning' },
      { regex: /i (?:live in|am from|am based in) ([a-z\s,]+?)(?:\.|,|$)/i, cat: 'location' },
      { regex: /my (?:kid|child|son|daughter) ([a-z\s]+?)(?:\.|,|$)/i, cat: 'family' },
      { regex: /i (?:enjoy|like|love) (?:to )?([a-z\s]+?)(?:\.|,|$)/i, cat: 'interests' },
    ];

    for (const p of patterns) {
      const match = userMsg.match(p.regex);
      if (match && match[1] && match[1].trim().length > 2 && match[1].trim().length < 50) {
        Storage.addDimension(p.cat, p.cat, match[1].trim(), 0.2, 'auto-extracted');
      }
    }
  }

  // ── Status ───────────────────────────────────────────────────────────

  function isLoading() {
    return isProcessing;
  }

  function getCurrentThreadId() {
    return currentThreadId;
  }

  function setCurrentThreadId(id) {
    currentThreadId = id;
  }

  return { send, isLoading, getCurrentThreadId, setCurrentThreadId };
})();

if (typeof module !== 'undefined') module.exports = Chat;
