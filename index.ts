/**
 * Symdy — Your AI companion. A persistent cognitive dyad.
 *
 * Symdy grows with you. It remembers what matters, learns across
 * conversations, and gets better at understanding you every day.
 *
 * BED (Better Every Day) applies to both of you — Symdy gets smarter
 * about you, and you get smarter with Symdy.
 *
 * Install: place this directory at ~/.pi/agent/extensions/symdy/
 * Usage:   /symdy — see what Symdy knows
 *          Any conversation builds Symdy's understanding automatically
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Dimension Model ────────────────────────────────────────────────────

interface Dimension {
  name: string;        // e.g., "works as HR Director"
  category: string;    // professional, personal, learning, preferences
  confidence: number;  // 0.0 - 1.0
  detail: string;      // freeform detail
  firstSeen: number;   // timestamp
  lastUpdated: number;
  source: string;      // "explicit", "extracted", "inferred"
}

// ── State ───────────────────────────────────────────────────────────────

let dimensions: Dimension[] = [];
let sessionStartTime = Date.now();
let conversationCount = 0;

// ── Persistence ─────────────────────────────────────────────────────────

function saveState(pi: ExtensionAPI) {
  pi.appendEntry("symdy-state", {
    dimensions,
    conversationCount,
    sessionStartTime,
  });
}

function loadState(entries: any[]) {
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "symdy-state") {
      const data = entry.data;
      if (data.dimensions) dimensions = data.dimensions;
      if (data.conversationCount) conversationCount = data.conversationCount;
      if (data.sessionStartTime) sessionStartTime = data.sessionStartTime;
    }
    // Also read individual dimension entries
    if (entry.type === "custom" && entry.customType === "symdy-dimension") {
      const dim = entry.data as Dimension;
      const existing = dimensions.findIndex(
        d => d.name === dim.name && d.category === dim.category
      );
      if (existing >= 0) {
        dimensions[existing] = { ...dimensions[existing], ...dim, confidence: Math.max(dimensions[existing].confidence, dim.confidence) };
      } else {
        dimensions.push(dim);
      }
    }
  }
}

// ── Dimension Extraction ────────────────────────────────────────────────

function extractDimensions(userText: string, assistantText: string) {
  const combined = `${userText} ${assistantText}`.toLowerCase();
  const extracted: Partial<Dimension>[] = [];

  const patterns: Array<{ regex: RegExp; category: string; name: string }> = [
    // Professional
    { regex: /i (?:am|work as) (?:a|an) ([a-z\s]+?)(?:\.|,| and| at| for| in|$)/i, category: 'professional', name: '' },
    { regex: /my (?:job|role|position) (?:is|as) ([a-z\s]+?)(?:\.|,|$)/i, category: 'professional', name: '' },
    { regex: /i (?:work|manage|run) (?:at|a) ([a-z\s]+?)(?:\.|,|$)/i, category: 'professional', name: '' },
    // Learning
    { regex: /i(?:'m| am) (?:learning|studying|taking) ([a-z\s]+?)(?:\.|,|$)/i, category: 'learning', name: '' },
    { regex: /i want to learn ([a-z\s]+?)(?:\.|,|$)/i, category: 'learning', name: '' },
    // Personal
    { regex: /i (?:live in|am from|am based in) ([a-z\s,]+?)(?:\.|,|$)/i, category: 'personal', name: '' },
    { regex: /my (?:kid|child|son|daughter) (?:is|are|name)/i, category: 'personal', name: 'has children' },
    // Preferences
    { regex: /i prefer ([a-z\s]+?)(?: over|\.|,|$)/i, category: 'preferences', name: '' },
    { regex: /i (?:like|love|enjoy) ([a-z\s]+?)(?:\.|,|$)/i, category: 'preferences', name: '' },
    // Projects
    { regex: /i(?:'m| am) (?:working on|building|making) ([a-z\s]+?)(?:\.|,|$)/i, category: 'projects', name: '' },
  ];

  for (const p of patterns) {
    const match = userText.match(p.regex);
    if (match && match[1] && match[1].trim().length > 2 && match[1].trim().length < 80) {
      extracted.push({
        name: p.name || `${p.category}: ${match[1].trim()}`,
        category: p.category,
        detail: match[1].trim(),
        confidence: 0.3,
        source: 'extracted',
      });
    }
  }

  return extracted;
}

function mergeDimensions(extracted: Partial<Dimension>[]) {
  const now = Date.now();
  for (const dim of extracted) {
    const existing = dimensions.findIndex(
      d => d.name === dim.name && d.category === dim.category
    );
    if (existing >= 0) {
      dimensions[existing].confidence = Math.min(1.0, dimensions[existing].confidence + 0.1);
      dimensions[existing].lastUpdated = now;
      if (dim.detail) dimensions[existing].detail = dim.detail;
    } else {
      dimensions.push({
        name: dim.name || `${dim.category}: ${dim.detail}`,
        category: dim.category || 'general',
        confidence: dim.confidence || 0.3,
        detail: dim.detail || '',
        firstSeen: now,
        lastUpdated: now,
        source: dim.source || 'extracted',
      });
    }
  }
}

// ── Context Builder ─────────────────────────────────────────────────────

function buildSymdyContext(): string {
  if (dimensions.length === 0) {
    return "Symdy is just getting to know this human. No dimensions learned yet.";
  }

  const byCategory: Record<string, Dimension[]> = {};
  for (const d of dimensions) {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  }

  let ctx = "## What Symdy Knows About This Human\n\n";
  for (const [cat, dims] of Object.entries(byCategory)) {
    ctx += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`;
    for (const d of dims) {
      const confBar = d.confidence >= 0.7 ? '●●●' : d.confidence >= 0.4 ? '●●○' : '●○○';
      ctx += `- ${d.detail} (${confBar})\n`;
    }
    ctx += '\n';
  }

  ctx += `\nSymdy has had ${conversationCount} conversations with this human.`;
  ctx += `\nBED principle: Symdy and its human both get better every day.\n`;

  return ctx;
}

// ── Extension Entry ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── On Session Start: Restore State ──────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    loadState(ctx.sessionManager.getEntries());
    const dimCount = dimensions.length;
    ctx.ui.notify(
      `Symdy ready — ${dimCount} dimensions, ${conversationCount} conversations`,
      "info"
    );
  });

  // ── On Agent End: Extract & Save ─────────────────────────────────────

  pi.on("agent_end", async (event, ctx) => {
    // Extract dimensions from this exchange
    const userMsgs = event.messages.filter((m: any) => m.role === 'user');
    const assistantMsgs = event.messages.filter((m: any) => m.role === 'assistant');

    for (let i = 0; i < Math.min(userMsgs.length, assistantMsgs.length); i++) {
      const userText = userMsgs[i].content
        ? (typeof userMsgs[i].content === 'string' ? userMsgs[i].content : userMsgs[i].content.map((c: any) => c.text || '').join(' '))
        : '';
      const assistantText = assistantMsgs[i].content
        ? (typeof assistantMsgs[i].content === 'string' ? assistantMsgs[i].content : '')
        : '';

      if (userText) {
        const extracted = extractDimensions(userText, assistantText);
        if (extracted.length > 0) {
          mergeDimensions(extracted);
          saveState(pi);
        }
      }
    }

    conversationCount++;
    saveState(pi);

    // Subtle stats in status bar
    ctx.ui.setStatus("symdy", `${dimensions.length}d · ${conversationCount}c`);
  });

  // ── In Context: Provide Symdy Knowledge ──────────────────────────────

  pi.on("before_agent_start", async (event, _ctx) => {
    const symdyContext = buildSymdyContext();
    const currentPrompt = event.systemPrompt || '';

    return {
      systemPrompt: `${currentPrompt}

${symdyContext}

You have access to Symdy — a persistent memory system that grows with each conversation.
Symdy tracks dimensions (what it knows about the human) across all sessions.
When the human shares something about themselves, use the symdy_remember tool.
When you need context about the human, use the symdy_recall tool.
Symdy gets BED (Better Every Day) — every conversation strengthens its understanding.`,
    };
  });

  // ── Tool: symdy_remember ─────────────────────────────────────────────

  pi.registerTool({
    name: "symdy_remember",
    label: "Symdy Remember",
    description: "Store something Symdy has learned about the human. Use when the human shares information about themselves — their work, interests, preferences, projects, learning goals, family, or anything else that helps Symdy know them better.",
    promptSnippet: "Store a fact, preference, or detail about the human in Symdy's memory",
    parameters: Type.Object({
      category: Type.String({
        description: "Category: professional, personal, learning, preferences, projects, family, health, or general"
      }),
      detail: Type.String({
        description: "What Symdy learned. A specific, concise statement like 'works as an HR Director overseeing 3 healthcare facilities'"
      }),
      confidence: Type.Optional(Type.Number({
        description: "How confident Symdy is in this fact (0.0-1.0). Use 0.8+ for explicit statements, 0.5 for likely inferences, 0.3 for guesses."
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const now = Date.now();
      const existingIdx = dimensions.findIndex(
        d => d.category === params.category && d.detail.toLowerCase() === params.detail.toLowerCase()
      );

      if (existingIdx >= 0) {
        dimensions[existingIdx].confidence = Math.min(1.0, (dimensions[existingIdx].confidence || 0.3) + 0.1);
        dimensions[existingIdx].lastUpdated = now;
      } else {
        dimensions.push({
          name: `${params.category}: ${params.detail.substring(0, 50)}`,
          category: params.category,
          confidence: params.confidence || 0.5,
          detail: params.detail,
          firstSeen: now,
          lastUpdated: now,
          source: 'explicit',
        });
      }

      saveState(pi);
      ctx.ui.setStatus("symdy", `${dimensions.length}d · ${conversationCount}c`);

      return {
        content: [{ type: "text", text: `✓ Remembered: ${params.detail}` }],
        details: { dimensions: dimensions.length },
      };
    },
  });

  // ── Tool: symdy_recall ───────────────────────────────────────────────

  pi.registerTool({
    name: "symdy_recall",
    label: "Symdy Recall",
    description: "Recall what Symdy knows about the human. Use when you need context about the human's work, preferences, projects, or personal details before answering a question or making a suggestion.",
    promptSnippet: "Recall what Symdy knows about the human (optionally filtered by category)",
    parameters: Type.Object({
      category: Type.Optional(Type.String({
        description: "Optional filter by category: professional, personal, learning, preferences, projects, family, etc. Omit to see everything."
      })),
      query: Type.Optional(Type.String({
        description: "Optional search term to find specific information."
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let results = [...dimensions];

      if (params.category) {
        results = results.filter(d => d.category === params.category);
      }
      if (params.query) {
        const q = params.query.toLowerCase();
        results = results.filter(d =>
          d.detail.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
        );
      }

      // Sort by confidence
      results.sort((a, b) => b.confidence - a.confidence);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "Symdy doesn't know anything about that yet. Use symdy_remember when the human shares something new." }],
          details: { count: 0 },
        };
      }

      const text = results.map(d => {
        const conf = d.confidence >= 0.7 ? 'high' : d.confidence >= 0.4 ? 'medium' : 'low';
        return `- [${d.category}] ${d.detail} (confidence: ${conf})`;
      }).join('\n');

      return {
        content: [{ type: "text", text }],
        details: { count: results.length, dimensions: results },
      };
    },
  });

  // ── Command: /symdy ──────────────────────────────────────────────────

  pi.registerCommand("symdy", {
    description: "See what Symdy knows about you",
    handler: async (_args, ctx) => {
      const dimCount = dimensions.length;
      const convCount = conversationCount;

      if (dimCount === 0) {
        ctx.ui.notify(
          "Symdy is just getting to know you. Keep talking — Symdy learns from every conversation.",
          "info"
        );
        return;
      }

      // Show summary in a readable format
      const byCategory: Record<string, string[]> = {};
      for (const d of dimensions) {
        if (!byCategory[d.category]) byCategory[d.category] = [];
        const conf = d.confidence >= 0.7 ? '✓' : d.confidence >= 0.4 ? '~' : '?';
        byCategory[d.category].push(`${conf} ${d.detail}`);
      }

      const lines: string[] = [];
      lines.push(`Symdy knows ${dimCount} things about you across ${convCount} conversations.\n`);
      for (const [cat, dims] of Object.entries(byCategory)) {
        lines.push(`${cat}:`);
        for (const d of dims) {
          lines.push(`  ${d}`);
        }
        lines.push('');
      }

      ctx.ui.notify(lines.join('\n'), "info");
    },
  });

  // ── Cleanup on Shutdown ──────────────────────────────────────────────

  pi.on("session_shutdown", async (_event, _ctx) => {
    // State already saved via pi.appendEntry during agent_end
  });
}
