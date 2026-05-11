/**
 * Symdy App — main application controller.
 * Wires together storage, chat, justifier, and UI.
 */

const App = (() => {
  // ── State ─────────────────────────────────────────────────────────────
  let currentView = 'chat';
  let sidebarOpen = true;

  // ── Init ──────────────────────────────────────────────────────────────

  async function init() {
    await Storage.init();

    // Check if first visit
    const visited = localStorage.getItem('symdy_visited');
    if (!visited) {
      _showOnboarding();
      localStorage.setItem('symdy_visited', '1');
    }

    _renderThreadList();
    _checkApiKey();

    // If no threads, create one
    const threads = Storage.getThreads();
    if (threads.length === 0) {
      const id = Storage.createThread('Welcome');
      Chat.setCurrentThreadId(id);
      _renderMessages(id);
    } else {
      Chat.setCurrentThreadId(threads[0].id);
      _renderMessages(threads[0].id);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeSettings();
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); _newThread(); }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); _openSettings(); }
    });

    _updateStats();
  }

  // ── Onboarding ───────────────────────────────────────────────────────

  function _showOnboarding() {
    const el = document.getElementById('onboarding');
    if (el) el.style.display = 'flex';
  }

  window.closeOnboarding = function() {
    document.getElementById('onboarding').style.display = 'none';
  };

  // ── API Key ──────────────────────────────────────────────────────────

  function _checkApiKey() {
    const hasKey = localStorage.getItem('symdy_openrouter_key') ||
                   localStorage.getItem('symdy_deepseek_key') ||
                   localStorage.getItem('symdy_anthropic_key') ||
                   localStorage.getItem('symdy_openai_key');
    const banner = document.getElementById('key-warning');
    if (!hasKey && banner) {
      banner.style.display = 'block';
    } else if (banner) {
      banner.style.display = 'none';
    }
  }

  function saveAllKeys() {
    const providers = {
      openrouter: document.getElementById('api-key-openrouter').value.trim(),
      deepseek: document.getElementById('api-key-deepseek').value.trim(),
      anthropic: document.getElementById('api-key-anthropic').value.trim()
    };
    if (providers.openrouter) localStorage.setItem('symdy_openrouter_key', providers.openrouter);
    if (providers.deepseek) localStorage.setItem('symdy_deepseek_key', providers.deepseek);
    if (providers.anthropic) localStorage.setItem('symdy_anthropic_key', providers.anthropic);
    _checkApiKey();
    _closeSettings();
  }

  window.saveAllKeys = saveAllKeys;

  // ── Thread List ──────────────────────────────────────────────────────

  function _renderThreadList() {
    const container = document.getElementById('thread-list');
    if (!container) return;
    const threads = Storage.getThreads();
    const currentId = Chat.getCurrentThreadId();

    container.innerHTML = threads.map(t => `
      <div class="thread-item ${t.id === currentId ? 'active' : ''}" 
           onclick="App.selectThread('${t.id}')">
        <span class="thread-title">${_escapeHtml(t.title || 'New Thread')}</span>
      </div>
    `).join('') || '<div class="thread-empty">No conversations yet</div>';
  }

  function _newThread() {
    const id = Storage.createThread();
    Chat.setCurrentThreadId(id);
    _renderThreadList();
    _renderMessages(id);
    document.getElementById('chat-input').focus();
  }

  function selectThread(id) {
    Chat.setCurrentThreadId(id);
    _renderThreadList();
    _renderMessages(id);
    document.getElementById('chat-input').focus();
  }

  window.App = { selectThread };  // expose for onclick

  // ── Messages ─────────────────────────────────────────────────────────

  function _renderMessages(threadId) {
    const container = document.getElementById('messages');
    if (!container) return;
    const msgs = Storage.getMessages(threadId);

    container.innerHTML = msgs.map(m => {
      if (m.role === 'system') return '';
      const cls = m.role === 'user' ? 'msg-user' : 'msg-assistant';
      const content = m.role === 'assistant' 
        ? _formatMarkdown(m.content)
        : _escapeHtml(m.content);
      return `<div class="message ${cls}">
        <div class="msg-content">${content}</div>
        ${m.model ? `<div class="msg-meta">${m.model.split('/').pop()} · ${m.tokens_used || '?'} tokens</div>` : ''}
      </div>`;
    }).filter(Boolean).join('');

    container.scrollTop = container.scrollHeight;
  }

  function _formatMarkdown(text) {
    // Simple markdown: bold, italic, code blocks, inline code, lists
    return text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Send Message ─────────────────────────────────────────────────────

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || Chat.isLoading()) return;

    input.value = '';
    const threadId = Chat.getCurrentThreadId();

    // Show user message immediately
    _renderMessages(threadId);
    const container = document.getElementById('messages');

    // Add typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'message msg-assistant typing';
    typingEl.innerHTML = '<div class="msg-content"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
    container.appendChild(typingEl);
    container.scrollTop = container.scrollHeight;

    try {
      const result = await Chat.send(message, threadId);
      typingEl.remove();
      _renderMessages(threadId);
      _renderThreadList(); // update title if auto-titled
      _updateStats();

      // Show model justification subtly
      if (result.justification.model !== 'Default') {
        console.log(`Symdy justifier: ${result.justification.reason} (${result.justification.model}, ~$${result.cost.toFixed(6)})`);
      }
    } catch (e) {
      typingEl.remove();
      _renderMessages(threadId);
      console.error('Chat error:', e);
    }
  }

  window.sendMessage = sendMessage;

  // Handle Enter key
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('chat-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
  });

  // ── Settings ─────────────────────────────────────────────────────────

  function _openSettings() {
    document.getElementById('settings-panel').style.display = 'flex';
    document.getElementById('api-key-openrouter').value = localStorage.getItem('symdy_openrouter_key') || '';
    document.getElementById('api-key-deepseek').value = localStorage.getItem('symdy_deepseek_key') || '';
    document.getElementById('api-key-anthropic').value = localStorage.getItem('symdy_anthropic_key') || '';
    const budget = Storage.getSetting('monthly_budget', '');
    document.getElementById('budget-input').value = budget;
  }

  function _closeSettings() {
    document.getElementById('settings-panel').style.display = 'none';
  }

  function _saveBudget() {
    const val = document.getElementById('budget-input').value;
    if (val && !isNaN(val)) {
      Storage.setSetting('monthly_budget', val);
    }
    _closeSettings();
  }

  window.openSettings = _openSettings;
  window.closeSettings = _closeSettings;
  window.saveBudget = _saveBudget;

  // ── Export / Import ──────────────────────────────────────────────────

  window.exportData = function() {
    const blob = Storage.exportDatabase();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `symdy-backup-${new Date().toISOString().split('T')[0]}.symdy`;
    a.click();
    URL.revokeObjectURL(url);
  };

  window.importData = function() {
    const input = document.getElementById('import-file');
    input.click();
  };

  document.addEventListener('DOMContentLoaded', () => {
    const importInput = document.getElementById('import-file');
    if (importInput) {
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          await Storage.importDatabase(file);
          Chat.setCurrentThreadId(null);
          const threads = Storage.getThreads();
          if (threads.length > 0) {
            Chat.setCurrentThreadId(threads[0].id);
            _renderMessages(threads[0].id);
          }
          _renderThreadList();
          _updateStats();
        }
      });
    }
  });

  // ── New Thread Button ────────────────────────────────────────────────

  window.newThread = _newThread;

  // ── Stats ─────────────────────────────────────────────────────────────

  function _updateStats() {
    const s = Storage.stats();
    const el = document.getElementById('stats');
    if (el) {
      el.innerHTML = `${s.threads} threads · ${s.messages} msgs · ${s.dimensions} learned · ${s.sizeKb}KB`;
    }
  }

  // ── Init on Load ─────────────────────────────────────────────────────

  window.addEventListener('DOMContentLoaded', init);

  return { init, selectThread, sendMessage };
})();
