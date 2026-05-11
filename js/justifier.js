/**
 * Symdy Justifier — task classifier + model selector.
 *
 * Classifies the user's message into a task class, then maps to
 * the optimal model based on user budget, context length, and
 * whether documents are attached.
 *
 * User never sees model names unless they go to Settings → Advanced.
 */

const Justifier = (() => {
  // ── Default Model Map ────────────────────────────────────────────────
  // Prices: approximate per 1M tokens (input/output avg). Used for budget calc.

  const DEFAULT_MODELS = {
    chat: {
      id: 'anthropic/claude-3.5-haiku',
      name: 'Default',
      costPer1M: 1.25,
      description: 'Fast responses for everyday conversation'
    },
    analysis: {
      id: 'anthropic/claude-sonnet-4-20250514',
      name: 'Analysis',
      costPer1M: 3.0,
      description: 'Deeper reasoning for analysis and explanations'
    },
    complex: {
      id: 'anthropic/claude-opus-4-20250514',
      name: 'Complex',
      costPer1M: 15.0,
      description: 'Maximum reasoning for difficult multi-step problems'
    },
    creative: {
      id: 'anthropic/claude-sonnet-4-20250514',
      name: 'Creative',
      costPer1M: 3.0,
      description: 'Writing, ideation, creative work'
    },
    document: {
      id: 'google/gemini-2.5-pro-preview-05-06',
      name: 'Document',
      costPer1M: 2.5,
      description: 'Large context window for document analysis',
      maxContext: 1000000
    }
  };

  // ── Task Classification Patterns ─────────────────────────────────────
  // Scored by keyword + structural signals. Higher score = more complex.

  const PATTERNS = {
    complex: {
      keywords: [
        'analyze', 'compare and contrast', 'evaluate', 'diagnose',
        'what is wrong with', 'debug', 'trace', 'why does', 'how would you',
        'design a system', 'architecture', 'trade-offs', 'pros and cons',
        'multiple steps', 'step by step', 'comprehensive', 'detailed plan',
        'legal', 'compliance', 'regulatory', 'liability'
      ],
      signals: [
        msg => msg.length > 500,
        msg => (msg.match(/\?/g) || []).length >= 3,
        msg => msg.split('\n').length > 8
      ]
    },
    analysis: {
      keywords: [
        'explain', 'how does', 'what is', 'summarize', 'break down',
        'review', 'assess', 'compare', 'difference between', 'why is',
        'recommend', 'suggest', 'should i', 'what are',
      ],
      signals: [
        msg => msg.length > 200 && msg.length <= 800,
        msg => (msg.match(/\?/g) || []).length >= 1 && (msg.match(/\?/g) || []).length <= 2
      ]
    },
    creative: {
      keywords: [
        'write', 'draft', 'compose', 'create', 'generate',
        'story', 'email', 'letter', 'poem', 'script', 'copy',
        'rewrite', 'rephrase', 'tone', 'style', 'voice',
        'persuasive', 'engaging', 'compelling'
      ],
      signals: [
        msg => msg.includes('write') || msg.includes('draft')
      ]
    },
    document: {
      keywords: [
        'document', 'pdf', 'handbook', 'policy', 'contract',
        'regulation', 'manual', 'report', 'uploaded', 'attached'
      ],
      signals: [
        msg => msg.length > 2000
      ]
    }
  };

  function _score(msg, patterns) {
    const lower = msg.toLowerCase();
    let score = 0;
    for (const kw of patterns.keywords) {
      if (lower.includes(kw)) score += 1;
    }
    for (const sig of patterns.signals) {
      if (sig(msg)) score += 1;
    }
    return score;
  }

  function classify(message, hasDocuments = false) {
    if (hasDocuments) return 'document';

    const scores = {
      complex: _score(message, PATTERNS.complex),
      analysis: _score(message, PATTERNS.analysis),
      creative: _score(message, PATTERNS.creative),
      document: _score(message, PATTERNS.document),
    };

    // Find highest scoring class
    let best = 'chat';
    let bestScore = 0;
    for (const [cls, score] of Object.entries(scores)) {
      if (score > bestScore) {
        best = cls;
        bestScore = score;
      }
    }

    // Minimum threshold to escalate beyond chat
    if (bestScore === 0) return 'chat';
    if (bestScore <= 1 && best === 'complex') return 'analysis';
    return best;
  }

  function selectModel(taskClass, budgetRemaining = Infinity, contextLength = 0) {
    const models = { ...DEFAULT_MODELS };

    // If user has custom model preferences in settings, override defaults
    // (handled by caller, not here — this is pure selection)

    let choice = models[taskClass] || models.chat;

    // Budget fallback: if choosing the ideal model would blow the budget
    if (budgetRemaining < choice.costPer1M * 0.01) {
      choice = models.chat;
    }

    // Context: if very long context, prefer document model
    if (contextLength > 50000 && taskClass !== 'document') {
      choice = models.document;
    }

    return choice;
  }

  function getDefaultModels() {
    return DEFAULT_MODELS;
  }

  function explain(classification, model) {
    const reasons = {
      chat:     'Quick response for everyday conversation',
      analysis: 'Moderate reasoning for analysis and explanation',
      complex:  'Deep reasoning for multi-step or difficult problems',
      creative: 'Creative writing and ideation mode',
      document:'Processing with extended context for your documents'
    };
    return {
      task: classification,
      model: model.name,
      reason: reasons[classification] || 'Default mode',
      cost: `~$${model.costPer1M}/1M tokens`
    };
  }

  return { classify, selectModel, getDefaultModels, explain };
})();

if (typeof module !== 'undefined') module.exports = Justifier;
