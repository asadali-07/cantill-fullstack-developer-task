import { useState, useEffect } from 'react';
import {
  Shield,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  History,
  ArrowRight,
  Upload,
  RefreshCw,
  FileCode,
  Check,
  RotateCcw,
  Sliders,
  DollarSign,
  Calendar,
  Layers,
} from 'lucide-react';
import apiClient from '../api/client';
import toast from 'react-hot-toast';

interface PolicyVersion {
  version: string;
  effective_date: string;
  description: string;
  rules: Record<string, any>;
  is_active: boolean;
  created_at: string;
}

interface PolicyDiffItem {
  field: string;
  label?: string;
  oldValue: any;
  newValue: any;
  explanation?: string;
}

interface DiffPreview {
  currentVersion?: string;
  proposedVersion: string;
  effectiveDate?: string;
  summary: string;
  diff: PolicyDiffItem[];
  updatedRules: Record<string, any>;
}

const sampleAmendments = [
  'Amendment Nov 2026: Lower spot PO limit to ₹150,000 and emergency PO limit to ₹400,000. Increase RFQ vendor count to 4.',
  'Amendment: For Capex category items, set approval threshold to ₹500,000 and require 5 quotes.',
  'Urgent amendment: Clubbing window reduced from 14 days to 7 days, tolerance 3 days.',
];

export default function PolicyPage() {
  const [activePolicy, setActivePolicy] = useState<PolicyVersion | null>(null);
  const [allVersions, setAllVersions] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState(false);

  // Amendment Input
  const [amendmentText, setAmendmentText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [diffPreview, setDiffPreview] = useState<DiffPreview | null>(null);
  const [approving, setApproving] = useState(false);

  const loadPolicyData = async () => {
    setLoading(true);
    try {
      const [activeRes, versionsRes] = await Promise.all([
        apiClient.get('/policy/active'),
        apiClient.get('/policy/versions'),
      ]);

      const active = activeRes.data?.policy || activeRes.data;
      if (active && typeof active === 'object') {
        setActivePolicy(active);
      }

      const versions = Array.isArray(versionsRes.data?.versions)
        ? versionsRes.data.versions
        : Array.isArray(versionsRes.data)
        ? versionsRes.data
        : [];
      setAllVersions(versions);
    } catch (err: any) {
      toast.error('Failed to load policy data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicyData();
  }, []);

  // Handle Preview Amendment
  const handlePreview = async () => {
    if (!amendmentText.trim()) {
      toast.error('Please enter amendment text or upload a document');
      return;
    }

    setPreviewing(true);
    try {
      const res = await apiClient.post('/policy/preview-amendment', {
        text: amendmentText.trim(),
        amendmentText: amendmentText.trim(),
      });

      const data = res.data;
      setDiffPreview({
        currentVersion: data.currentVersion || data.previous_version || '5.0',
        proposedVersion: data.proposedVersion || data.new_version || '5.1',
        effectiveDate: data.effectiveDate,
        summary: data.summary || data.diff?.summary || 'Policy rules update detected',
        diff: Array.isArray(data.diff)
          ? data.diff
          : Array.isArray(data.diff?.changed_rules)
          ? data.diff.changed_rules.map((c: any) => ({
              field: c.rule || c.field,
              label: c.rule || c.field,
              oldValue: c.old_value ?? c.oldValue,
              newValue: c.new_value ?? c.newValue,
              explanation: `Changed ${c.rule || c.field} from ${c.old_value} to ${c.new_value}`,
            }))
          : [],
        updatedRules: data.updatedRules || data.proposed_policy || {},
      });

      toast.success('Gemini AI analyzed policy amendment!');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to preview amendment');
    } finally {
      setPreviewing(false);
    }
  };

  // Handle Approve Amendment
  const handleApprove = async () => {
    if (!diffPreview) return;

    setApproving(true);
    try {
      await apiClient.post('/policy/approve-amendment', {
        version: diffPreview.proposedVersion,
        new_version: diffPreview.proposedVersion,
        rules: diffPreview.updatedRules,
        proposed_policy: diffPreview.updatedRules,
        description: diffPreview.summary || amendmentText,
        summary: diffPreview.summary,
        diff: diffPreview.diff,
        effectiveDate: diffPreview.effectiveDate,
      });

      toast.success(`Activated Policy ${diffPreview.proposedVersion} successfully!`);
      setDiffPreview(null);
      setAmendmentText('');
      await loadPolicyData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to approve policy amendment');
    } finally {
      setApproving(false);
    }
  };

  // Handle Activate / Rollback
  const handleActivateVersion = async (version: string) => {
    try {
      await apiClient.post(`/policy/activate/${version}`);
      toast.success(`Switched active policy to ${version}`);
      await loadPolicyData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to activate version');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Page Header ──────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800">🛡️ Policy-as-Data</h2>
            {activePolicy && (
              <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                Active: {activePolicy.version}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Data-driven procurement rules. Upload amendments to change decision logic without code changes.
          </p>
        </div>

        <button
          onClick={loadPolicyData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-2xs"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left 2 Columns: Active Rules & Amendment Intake ─ */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Rules Grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-primary-600" />
                <h3 className="text-sm font-bold text-slate-800">
                  Current Active Rules ({activePolicy?.version || 'v5.0'})
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                Effective: {activePolicy?.effective_date ? new Date(activePolicy.effective_date).toLocaleDateString() : 'N/A'}
              </span>
            </div>

            {activePolicy?.rules ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Spot PO Limit
                  </span>
                  <div className="text-base font-bold text-slate-800">
                    ₹{activePolicy.rules.spot_po_limit?.toLocaleString('en-IN') ?? '0'}
                  </div>
                  <span className="text-[10px] text-slate-500">Clause 5.3 single quote</span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Emergency PO Limit
                  </span>
                  <div className="text-base font-bold text-slate-800">
                    ₹{activePolicy.rules.emergency_po_limit?.toLocaleString('en-IN') ?? '0'}
                  </div>
                  <span className="text-[10px] text-slate-500">Clause 5.4 fast-track</span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    RFQ Ceiling
                  </span>
                  <div className="text-base font-bold text-slate-800">
                    ₹{activePolicy.rules.rfq_limit?.toLocaleString('en-IN') ?? '0'}
                  </div>
                  <span className="text-[10px] text-slate-500">Clause 5.5 (3 quotes)</span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    RFP Threshold
                  </span>
                  <div className="text-base font-bold text-slate-800">
                    ₹{activePolicy.rules.rfp_threshold?.toLocaleString('en-IN') ?? '0'}
                  </div>
                  <span className="text-[10px] text-slate-500">Clause 5.6 (5 quotes)</span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Clubbing Window
                  </span>
                  <div className="text-base font-bold text-slate-800">
                    {activePolicy.rules.clubbing_window_days ?? 14} Days
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Tolerance: ±{activePolicy.rules.clubbing_needby_tolerance_days ?? 7}d
                  </span>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Vendor Counts
                  </span>
                  <div className="text-xs font-semibold text-slate-800">
                    RFQ: {activePolicy.rules.rfq_vendor_count || 3} · RFP: {activePolicy.rules.rfp_vendor_count || 5}
                  </div>
                  <span className="text-[10px] text-slate-500">Capex: {activePolicy.rules.capex_vendor_count || 5}</span>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400">Loading policy rules...</div>
            )}
          </div>

          {/* Amendment Intake Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-500" />
                <h3 className="text-sm font-bold text-slate-800">Amend Policy (No Code Change)</h3>
              </div>
              <span className="text-[10px] font-semibold text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">
                Gemini 2.5 AI Powered
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-3">
              Paste procurement policy amendment memos or natural language updates. The AI extracts threshold changes, displays an exact diff, and updates policy rules dynamically.
            </p>

            {/* Sample Chips */}
            <div className="mb-3">
              <span className="text-[10px] font-semibold uppercase text-slate-400 block mb-1">
                Quick test templates:
              </span>
              <div className="space-y-1">
                {sampleAmendments.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => setAmendmentText(chip)}
                    className="w-full text-left rounded-lg bg-slate-50 hover:bg-primary-50 hover:text-primary-800 border border-slate-200/80 px-2.5 py-1.5 text-[11px] text-slate-600 transition-colors"
                  >
                    "{chip}"
                  </button>
                ))}
              </div>
            </div>

            <textarea
              rows={4}
              value={amendmentText}
              onChange={(e) => setAmendmentText(e.target.value)}
              placeholder="Enter amendment memo or rules update (e.g. 'Effective immediately, reduce spot PO limit to 150000 and emergency limit to 400000')..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-primary-500 focus:bg-white resize-none"
            />

            <div className="flex justify-end gap-2 mt-3">
              {diffPreview && (
                <button
                  type="button"
                  onClick={() => setDiffPreview(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Clear Preview
                </button>
              )}
              <button
                onClick={handlePreview}
                disabled={previewing || !amendmentText.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-4 py-1.5 text-xs font-medium shadow-xs disabled:opacity-50 transition-colors"
              >
                <Sparkles size={13} />
                {previewing ? 'Analyzing with Gemini...' : 'Preview Amendment Diff'}
              </button>
            </div>
          </div>

          {/* AI Diff Preview Box */}
          {diffPreview && (
            <div className="rounded-2xl border-2 border-primary-400 bg-primary-50/40 p-5 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-primary-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-primary-700" />
                  <h4 className="text-sm font-bold text-slate-900">
                    Proposed Version: {diffPreview.proposedVersion}
                  </h4>
                </div>
                <span className="text-[11px] text-primary-800 font-medium">
                  Base: {diffPreview.currentVersion}
                </span>
              </div>

              {/* Summary */}
              <div className="rounded-xl bg-white p-3 border border-primary-100 text-xs text-slate-700 mb-4 shadow-2xs">
                <span className="font-semibold text-primary-900 block mb-0.5">AI Interpretation Summary:</span>
                <p className="leading-relaxed">{diffPreview.summary}</p>
              </div>

              {/* Changed Rules Table */}
              <div className="space-y-2 mb-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                  Rule Changes:
                </span>
                {!diffPreview.diff || diffPreview.diff.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">No direct threshold changes detected.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Rule / Field</th>
                          <th className="px-3 py-2 text-red-600">Previous Value</th>
                          <th className="px-3 py-2 text-emerald-600">New Proposed Value</th>
                          <th className="px-3 py-2">Explanation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {diffPreview.diff.map((change, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono font-medium text-slate-800">
                              {change.label || change.field}
                            </td>
                            <td className="px-3 py-2 text-red-700 font-mono">
                              {typeof change.oldValue === 'number'
                                ? `₹${change.oldValue.toLocaleString('en-IN')}`
                                : JSON.stringify(change.oldValue)}
                            </td>
                            <td className="px-3 py-2 text-emerald-700 font-mono font-bold">
                              {typeof change.newValue === 'number'
                                ? `₹${change.newValue.toLocaleString('en-IN')}`
                                : JSON.stringify(change.newValue)}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-[11px]">
                              {change.explanation || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Approve & Activate Button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setDiffPreview(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Discard
                </button>
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-xs font-bold shadow-xs transition-colors"
                >
                  <Check size={14} />
                  {approving ? 'Activating...' : `Approve & Activate ${diffPreview.proposedVersion}`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Column: Version History Sidebar ────────── */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
              <History size={16} className="text-slate-600" />
              <h3 className="text-sm font-bold text-slate-800">Policy Version History</h3>
            </div>

            <div className="space-y-3">
              {!Array.isArray(allVersions) || allVersions.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">No versions found.</div>
              ) : (
                allVersions.map((v) => (
                  <div
                    key={v.version}
                    className={`rounded-xl border p-3.5 transition-all ${
                      v.is_active
                        ? 'border-emerald-300 bg-emerald-50/50 shadow-2xs ring-1 ring-emerald-200'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-xs text-slate-800">{v.version}</span>
                      {v.is_active ? (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.2 text-[10px] font-bold text-white">
                          ACTIVE
                        </span>
                      ) : (
                        <button
                          onClick={() => handleActivateVersion(v.version)}
                          className="text-[10px] font-semibold text-primary-600 hover:text-primary-800 hover:underline"
                        >
                          Activate / Rollback
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-600 line-clamp-2 mb-2">{v.description}</p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                      <span>{v.effective_date ? new Date(v.effective_date).toLocaleDateString() : 'N/A'}</span>
                      <span>Spot: ₹{v.rules?.spot_po_limit?.toLocaleString('en-IN') || 0}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
