import { useState, useEffect, useRef } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  RotateCcw,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  Building,
  Calendar,
  Layers,
  Clock,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import apiClient from '../api/client';
import toast from 'react-hot-toast';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  action?: string;
  prData?: any;
  decisionResult?: any;
  timestamp: string;
}

const samplePrompts = [
  'I need 20 deep groove ball bearings 6205 for Pune plant PUN1 by next Monday',
  'Require 5000L Industrial Gear Oil VG 320 for Chennai plant CHN1 urgently',
  'Need 15 hydraulic directional valves for plant PUN1 needed by 2026-03-30',
  'Procure 100 safety helmets for Chennai plant CHN1 by end of month',
];

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string>(() => {
    return localStorage.getItem('cantill_chat_session') || `session-${Date.now()}`;
  });
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-1',
      role: 'assistant',
      content:
        '👋 Hello! I am your **Corvo AI Procurement Assistant**.\n\nTell me what items you need to procure (e.g. description, quantity, plant, and need-by date), and I will validate your request, match catalog items, and run Corvo Policy v5.0 to determine the optimal procurement route.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('cantill_chat_session', sessionId);
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await apiClient.post('/chat', {
        sessionId,
        message: text,
      });

      const { reply, action, prData, decisionResult } = response.data;

      const assistantMsg: Message = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: reply,
        action,
        prData,
        decisionResult,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast.error('Failed to communicate with AI assistant');
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content: '⚠️ Apologies, I encountered an error connecting to the service. Please try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = (confirm: boolean) => {
    handleSend(confirm ? 'yes' : 'no');
  };

  const handleReset = async () => {
    try {
      await apiClient.delete(`/chat/${sessionId}`);
    } catch {}
    const newSessionId = `session-${Date.now()}`;
    setSessionId(newSessionId);
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'assistant',
        content:
          '✨ Session reset! Ready for your next purchase requisition. What do you need to procure today?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    toast.success('Chat history cleared');
  };

  const getRouteBadge = (route?: string) => {
    switch (route) {
      case 'CONTRACT_PO':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'DIRECT_PO':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'APPROVED_PO':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'CATALOG_PO':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      case 'SOURCING_RFQ':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'SOURCING_RFP':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* ── Subheader ────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3.5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
            <Bot size={20} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">PR Intake Chatbot</h2>
            <p className="text-xs text-slate-500">Corvo Policy v5.0 · Auto-Item Matching · Anti-Splitting</p>
          </div>
        </div>

        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          title="Start a fresh chat session"
        >
          <RotateCcw size={13} />
          Reset Chat
        </button>
      </div>

      {/* ── Chat Messages Stream ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-3 max-w-3xl ${m.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                m.role === 'user'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-slate-800 text-white shadow-sm'
              }`}
            >
              {m.role === 'user' ? <User size={15} /> : <Bot size={15} />}
            </div>

            {/* Bubble */}
            <div className="flex flex-col gap-1.5 max-w-[85%]">
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                  m.role === 'user'
                    ? 'bg-primary-600 text-white rounded-tr-xs'
                    : 'bg-white border border-slate-200/80 text-slate-800 rounded-tl-xs'
                }`}
              >
                {/* Text Content */}
                <div className="whitespace-pre-wrap break-words">{m.content}</div>

                {/* PR Confirmation Action Box */}
                {m.action === 'confirm_pr' && m.prData && (
                  <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50/70 p-3.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-primary-200/60 font-semibold text-primary-900">
                      <span className="flex items-center gap-1.5">
                        <FileSpreadsheet size={14} className="text-primary-600" />
                        Requisition Summary
                      </span>
                      <span className="rounded-full bg-primary-200/60 px-2 py-0.5 text-[10px] text-primary-800 font-bold uppercase">
                        Pending Confirmation
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-slate-600 mb-3">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Item</span>
                        <span className="font-medium text-slate-800">{m.prData.description}</span>
                        {m.prData.item_code && (
                          <span className="text-slate-500 text-[11px] block">({m.prData.item_code})</span>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Quantity</span>
                        <span className="font-medium text-slate-800">
                          {m.prData.quantity} {m.prData.uom || 'NOS'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Plant</span>
                        <span className="font-medium text-slate-800">{m.prData.plant}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Urgency</span>
                        <span className="font-medium text-slate-800">{m.prData.urgency || 'Normal'}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleConfirmAction(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-1.5 px-3 transition-colors shadow-xs"
                      >
                        <CheckCircle2 size={13} />
                        Confirm & Submit PR
                      </button>
                      <button
                        onClick={() => handleConfirmAction(false)}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-medium py-1.5 px-3 transition-colors"
                      >
                        <XCircle size={13} />
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Submitted Decision Result Card */}
                {m.action === 'submitted' && m.decisionResult && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
                    <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-200">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <ShieldCheck size={15} className="text-emerald-600" />
                        Engine Output
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md font-semibold text-[11px] border ${getRouteBadge(
                          m.decisionResult.route
                        )}`}
                      >
                        {m.decisionResult.route}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-2.5 text-slate-600">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Supplier</span>
                        <span className="font-medium text-slate-800">
                          {m.decisionResult.supplier_id || 'To be sourced'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Unit Price</span>
                        <span className="font-medium text-slate-800">
                          {m.decisionResult.unit_price ? `₹${m.decisionResult.unit_price.toLocaleString('en-IN')}` : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Total Value</span>
                        <span className="font-bold text-slate-900">
                          ₹{m.decisionResult.group_value_inr?.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg bg-white p-2 border border-slate-200 text-slate-600">
                      <span className="text-slate-400 block text-[10px] uppercase font-semibold mb-0.5">Policy Rationale</span>
                      <p className="text-[11px] leading-relaxed text-slate-700">{m.decisionResult.reason}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <span
                className={`text-[10px] text-slate-400 px-1 ${m.role === 'user' ? 'text-right' : 'text-left'}`}
              >
                {m.timestamp}
              </span>
            </div>
          </div>
        ))}

        {/* Loading Bubble */}
        {loading && (
          <div className="flex gap-3 max-w-3xl animate-fade-in">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm">
              <Bot size={15} />
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl bg-white border border-slate-200/80 px-4 py-3 shadow-xs">
              <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="text-xs text-slate-400 ml-2">Analyzing catalog & policy...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Suggested Prompts Chips ──────────────────────── */}
      {messages.length <= 2 && (
        <div className="px-6 pb-2">
          <div className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
            <Sparkles size={12} className="text-amber-500" />
            Quick prompt suggestions:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(p)}
                className="rounded-full bg-white border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-colors flex items-center gap-1 shadow-2xs"
              >
                <span>{p}</span>
                <ArrowRight size={11} className="text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input Bar ────────────────────────────────────── */}
      <div className="border-t border-slate-200 bg-white p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 max-w-4xl mx-auto"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Type your procurement need (e.g. 'I need 20 ball bearings for PUN1 by next Monday')..."
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors shadow-xs"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
