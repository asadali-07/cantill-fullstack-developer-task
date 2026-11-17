import { getGeminiModel } from './geminiClient';
import { Item, IItem } from '../models/Item';
import { Plant } from '../models/Plant';
import { matchItem } from '../engine/matcher';
import { runDecisionEngine } from '../engine/engine';
import { RawPRLine } from '../engine/clubber';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  pendingPR: Partial<RawPRLine> | null;
  confirmedPRs: RawPRLine[];
  state: 'idle' | 'collecting' | 'confirming' | 'processing';
}

// In-memory session store
const sessions = new Map<string, ChatSession>();

function getOrCreateSession(sessionId: string): ChatSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      pendingPR: null,
      confirmedPRs: [],
      state: 'idle',
    });
  }
  return sessions.get(sessionId)!;
}

/**
 * Build the system prompt with item catalog context
 */
function buildSystemPrompt(items: IItem[], plants: string[]): string {
  const itemList = items
    .map((i) => `${i.item_code}: ${i.description} (${i.uom}, ${i.category}, ₹${i.standard_price})`)
    .join('\n');

  return `You are a helpful procurement assistant for Corvo Engineering. Employees chat with you to raise Purchase Requisitions (PRs).

Your job:
1. Understand what item the employee needs, match it to the item catalog below.
2. Collect ALL required fields: item, quantity, plant, need-by date, urgency.
3. If description is vague, match to the closest catalog item. Common abbreviations: brg=bearing, pneu=pneumatic, hyd=hydraulic, hyd hose=hydraulic hose.
4. If you CANNOT match to any item in the catalog, mark it as a NEW item.
5. NEVER invent or hallucinate items not in the catalog.

PLANTS: ${plants.join(', ')}

ITEM CATALOG:
${itemList}

When you have enough info, respond with a JSON block in this format:
\`\`\`json
{
  "action": "confirm_pr",
  "item_code": "ITM-XXXX or NEW",
  "description": "matched item description or user's description for NEW items",
  "quantity": 100,
  "uom": "NOS",
  "plant": "PUN1",
  "need_by_date": "YYYY-MM-DD",
  "urgency": "Normal or Emergency",
  "estimated_unit_price": null,
  "confirmation_message": "A friendly message summarizing the PR for user confirmation"
}
\`\`\`

If you need more information, respond with:
\`\`\`json
{
  "action": "ask",
  "message": "Your question to the user"
}
\`\`\`

If the user confirms (yes/confirm/proceed/ok), respond with:
\`\`\`json
{
  "action": "submit",
  "message": "PR submitted message"
}
\`\`\`

If the user wants to cancel, respond with:
\`\`\`json
{
  "action": "cancel",
  "message": "Cancellation message"
}
\`\`\`

Always respond with ONLY a JSON block, no other text before or after.`;
}

/**
 * Extract JSON from Gemini response text
 */
function extractJSON(text: string): any {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {}

  // Try extracting from code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // Try finding JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  return null;
}

/**
 * Process a user chat message and return an assistant response
 */
export async function processChat(
  sessionId: string,
  userMessage: string
): Promise<{
  reply: string;
  action: string;
  prData?: any;
  decisionResult?: any;
}> {
  const session = getOrCreateSession(sessionId);

  // Load reference data
  const [items, plants] = await Promise.all([
    Item.find().lean() as unknown as Promise<IItem[]>,
    Plant.find().lean(),
  ]);
  const plantCodes = plants.map((p) => p.plant);

  session.messages.push({ role: 'user', content: userMessage });

  // Handle confirmation state
  if (session.state === 'confirming' && session.pendingPR) {
    const lower = userMessage.toLowerCase().trim();
    const isConfirm = /^(yes|y|confirm|ok|proceed|submit|go|sure|approved|lgtm)/.test(lower);
    const isCancel = /^(no|n|cancel|stop|abort|reject|never)/.test(lower);

    if (isConfirm) {
      // Submit the PR
      const pr = session.pendingPR as RawPRLine;
      pr.created_at = new Date();
      pr.pr_no = `PR-CHAT-${Date.now()}`;
      pr.pr_line = 1;
      pr.requester = 'Chat User';
      pr.department = 'General';

      try {
        const { results } = await runDecisionEngine([pr]);
        const decision = results[0];

        const reply = `✅ **PR Created & Processed!**\n\n` +
          `📋 **PR Number:** ${pr.pr_no}\n` +
          `📦 **Item:** ${pr.description} (${pr.item_code || 'NEW'})\n` +
          `🔢 **Quantity:** ${pr.quantity} ${pr.uom}\n` +
          `🏭 **Plant:** ${pr.plant}\n` +
          `📅 **Need By:** ${pr.need_by_date.toISOString().split('T')[0]}\n\n` +
          `---\n\n` +
          `### Decision Engine Result:\n` +
          `🎯 **Route:** ${decision.route}\n` +
          `${decision.supplier_id ? `🏢 **Supplier:** ${decision.supplier_id}` : ''}\n` +
          `${decision.unit_price ? `💰 **Unit Price:** ₹${decision.unit_price}` : ''}\n` +
          `💵 **Total Value:** ₹${decision.group_value_inr.toLocaleString('en-IN')}\n\n` +
          `📝 **Reason:** ${decision.reason}\n\n` +
          `Would you like to raise another purchase request?`;

        session.state = 'idle';
        session.pendingPR = null;
        session.messages.push({ role: 'assistant', content: reply });

        return { reply, action: 'submitted', prData: pr, decisionResult: decision };
      } catch (err: any) {
        const reply = `❌ Error processing PR: ${err.message}. Please try again.`;
        session.state = 'idle';
        session.pendingPR = null;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, action: 'error' };
      }
    }

    if (isCancel) {
      session.state = 'idle';
      session.pendingPR = null;
      const reply = '❌ PR request cancelled. Feel free to raise a new one anytime!';
      session.messages.push({ role: 'assistant', content: reply });
      return { reply, action: 'cancelled' };
    }

    // User wants to modify — fall through to Gemini
  }

  // Send to Gemini
  try {
    const systemPrompt = buildSystemPrompt(items, plantCodes);
    const model = getGeminiModel('gemini-2.5-flash', systemPrompt);

    const chatHistory = session.messages.map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    }));

    // Remove the last user message since we pass it via sendMessage
    const historyForChat = chatHistory.slice(0, -1);

    const chat = model.startChat({
      history: historyForChat,
    });

    const result = await chat.sendMessage(userMessage);
    const responseText = result.response.text();

    const parsed = extractJSON(responseText);

    if (!parsed) {
      // Gemini responded with plain text — just relay it
      const reply = responseText.trim();
      session.messages.push({ role: 'assistant', content: reply });
      return { reply, action: 'chat' };
    }

    switch (parsed.action) {
      case 'confirm_pr': {
        // Match item if needed
        let itemCode = parsed.item_code || '';
        let resolvedDesc = parsed.description || '';
        let uom = parsed.uom || 'NOS';

        if (itemCode && itemCode !== 'NEW') {
          const { matchedItem } = matchItem(itemCode, resolvedDesc, items);
          if (matchedItem) {
            itemCode = matchedItem.item_code;
            resolvedDesc = matchedItem.description;
            uom = matchedItem.uom;
          }
        } else if (!itemCode || itemCode === '') {
          const { matchedItem, resolvedCode } = matchItem(null, resolvedDesc, items);
          if (matchedItem) {
            itemCode = resolvedCode;
            resolvedDesc = matchedItem.description;
            uom = matchedItem.uom;
          } else {
            itemCode = 'NEW';
          }
        }

        // Store pending PR
        session.pendingPR = {
          item_code: itemCode === 'NEW' ? '' : itemCode,
          description: resolvedDesc,
          quantity: parsed.quantity,
          uom,
          plant: parsed.plant,
          need_by_date: new Date(parsed.need_by_date),
          urgency: parsed.urgency || 'Normal',
          estimated_unit_price: parsed.estimated_unit_price || undefined,
        };
        session.state = 'confirming';

        const confirmMsg = `📋 **Please confirm your Purchase Request:**\n\n` +
          `| Field | Value |\n` +
          `|-------|-------|\n` +
          `| **Item** | ${resolvedDesc} (${itemCode}) |\n` +
          `| **Quantity** | ${parsed.quantity} ${uom} |\n` +
          `| **Plant** | ${parsed.plant} |\n` +
          `| **Need By** | ${parsed.need_by_date} |\n` +
          `| **Urgency** | ${parsed.urgency || 'Normal'} |\n\n` +
          `Type **yes** to submit or **no** to cancel.`;

        session.messages.push({ role: 'assistant', content: confirmMsg });
        return { reply: confirmMsg, action: 'confirm_pr', prData: session.pendingPR };
      }

      case 'ask': {
        session.state = 'collecting';
        const reply = parsed.message;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, action: 'ask' };
      }

      case 'cancel': {
        session.state = 'idle';
        session.pendingPR = null;
        const reply = parsed.message || 'Request cancelled.';
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, action: 'cancel' };
      }

      default: {
        const reply = parsed.message || responseText;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, action: parsed.action || 'chat' };
      }
    }
  } catch (err: any) {
    console.error('[Chat AI Error]:', err.message);
    const reply = `I'm having trouble processing your request right now. Please try again or use the batch upload feature.\n\nError: ${err.message}`;
    session.messages.push({ role: 'assistant', content: reply });
    return { reply, action: 'error' };
  }
}

/**
 * Get chat history for a session
 */
export function getChatHistory(sessionId: string): ChatMessage[] {
  const session = sessions.get(sessionId);
  return session?.messages || [];
}

/**
 * Clear a chat session
 */
export function clearChatSession(sessionId: string): void {
  sessions.delete(sessionId);
}
