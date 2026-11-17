import { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Filter,
  Search,
  CheckCircle,
  AlertCircle,
  Edit3,
  Layers,
  ArrowUpDown,
  Building,
  DollarSign,
  TrendingUp,
  RefreshCw,
  FileDown,
  X,
  FileCheck,
} from 'lucide-react';
import apiClient from '../api/client';
import toast from 'react-hot-toast';

interface DecisionRow {
  _id?: string;
  id?: string;
  pr_line_id?: string;
  pr_no: string;
  pr_line: number;
  item_code: string;
  item_description: string;
  quantity: number;
  uom: string;
  plant: string;
  route: string;
  supplier_id: string;
  supplier_name?: string;
  unit_price: number;
  group_value_inr: number;
  reason: string;
  status: 'PENDING' | 'OVERRIDDEN' | 'APPROVED';
  buyer_override_reason?: string;
  created_at?: string;
}

export default function WorkspacePage() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [routeFilter, setRouteFilter] = useState('ALL');
  const [plantFilter, setPlantFilter] = useState('ALL');

  // Override modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<DecisionRow | null>(null);
  const [newRoute, setNewRoute] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [overrideComment, setOverrideComment] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  // Blind test export filename modal
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<'decisions' | 'preferred'>('decisions');
  const [customFilename, setCustomFilename] = useState('yourname__run1.csv');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch decisions on load
  const loadDecisions = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/buyer/decisions');
      if (res.data?.decisions && Array.isArray(res.data.decisions)) {
        setDecisions(res.data.decisions);
      }
    } catch {
      // If none yet or error, silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDecisions();
  }, []);

  // Handle batch file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await apiClient.post('/process-batch', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success(`Processed ${res.data.total_pr_lines} PR lines successfully!`);
      if (res.data.results) {
        setDecisions(res.data.results);
      } else {
        await loadDecisions();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to process batch CSV');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Open override modal
  const openOverrideModal = (row: DecisionRow) => {
    setSelectedDecision(row);
    setNewRoute(row.route);
    setNewSupplier(row.supplier_id || '');
    setOverrideComment('');
    setOverrideModalOpen(true);
  };

  // Submit override
  const handleOverrideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDecision) return;
    if (!overrideComment.trim()) {
      toast.error('A justification comment is mandatory for buyer overrides');
      return;
    }

    setOverrideSubmitting(true);
    try {
      const decisionId = selectedDecision._id || selectedDecision.id || selectedDecision.pr_line_id;
      const res = await apiClient.post('/buyer/override', {
        decisionId,
        overrideRoute: newRoute,
        overrideSupplier: newSupplier,
        overrideComment: overrideComment.trim(),
      });

      toast.success('Decision overridden successfully');
      setOverrideModalOpen(false);

      // Update local state
      setDecisions((prev) =>
        prev.map((d) => {
          const id = d._id || d.id || d.pr_line_id;
          if (id === decisionId) {
            return {
              ...d,
              route: newRoute,
              supplier_id: newSupplier,
              status: 'OVERRIDDEN',
              buyer_override_reason: overrideComment.trim(),
            };
          }
          return d;
        })
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit override');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  // Handle Approve
  const handleApprove = async (row: DecisionRow) => {
    const decisionId = row._id || row.id || row.pr_line_id;
    try {
      await apiClient.post('/buyer/approve', {
        decisionId,
        buyerName: 'Senior Buyer',
      });
      toast.success(`Approved PR ${row.pr_no}`);
      setDecisions((prev) =>
        prev.map((d) => {
          const id = d._id || d.id || d.pr_line_id;
          return id === decisionId ? { ...d, status: 'APPROVED' } : d;
        })
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to approve');
    }
  };

  // Handle Export CSV
  const handleExport = async (type: 'decisions' | 'preferred', filename?: string) => {
    try {
      const endpoint =
        type === 'decisions' ? '/process-batch/export' : '/suppliers/preferred/export';
      const res = await apiClient.get(endpoint, { responseType: 'blob' });

      const defaultName =
        type === 'decisions' ? 'cantill_decisions_export.csv' : 'cantill_preferred_suppliers.csv';
      const downloadName = filename || defaultName;

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', downloadName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(`Exported ${downloadName}`);
    } catch {
      toast.error('Failed to export CSV. Run a batch first.');
    }
  };

  // Filtered decisions
  const filteredDecisions = decisions.filter((d) => {
    const matchSearch =
      d.pr_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.item_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.item_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.supplier_id?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchRoute = routeFilter === 'ALL' || d.route === routeFilter;
    const matchPlant = plantFilter === 'ALL' || d.plant === plantFilter;

    return matchSearch && matchRoute && matchPlant;
  });

  // KPI calculations
  const totalValue = decisions.reduce((sum, d) => sum + (d.group_value_inr || 0), 0);
  const poCount = decisions.filter((d) => d.route.includes('PO')).length;
  const sourcingCount = decisions.filter((d) => d.route.includes('SOURCING')).length;

  const getRouteBadge = (route: string) => {
    switch (route) {
      case 'CONTRACT_PO':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'DIRECT_PO':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'APPROVED_PO':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'CATALOG_PO':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      case 'SOURCING_RFQ':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'SOURCING_RFP':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Page Header ──────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📋 Buyer Workspace</h2>
          <p className="text-xs text-slate-500">
            Batch Requisition Intake, Route Optimization & Buyer Overrides
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* File Upload Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv"
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-3.5 py-2 text-xs font-medium shadow-xs transition-colors"
          >
            <Upload size={14} />
            {uploading ? 'Processing Batch...' : 'Upload PR Batch CSV'}
          </button>

          <button
            onClick={() => {
              setExportType('decisions');
              setCustomFilename('yourname__run1.csv');
              setExportModalOpen(true);
            }}
            disabled={decisions.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 text-xs font-medium shadow-2xs transition-colors disabled:opacity-50"
          >
            <Download size={14} className="text-slate-500" />
            Export Decisions CSV
          </button>

          <button
            onClick={() => {
              setExportType('preferred');
              setCustomFilename('yourname__preferred.csv');
              setExportModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-2 text-xs font-medium shadow-2xs transition-colors"
          >
            <Download size={14} className="text-slate-500" />
            Export Preferred Suppliers
          </button>

          <button
            onClick={loadDecisions}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 shadow-2xs"
            title="Refresh decisions"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Total PR Lines</span>
            <FileSpreadsheet size={16} className="text-primary-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800">{decisions.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">From batch upload</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">PO Direct / Contract</span>
            <CheckCircle size={16} className="text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">{poCount}</div>
          <div className="text-[11px] text-emerald-600 mt-1">Ready for Purchase Order</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Sourcing RFQ / RFP</span>
            <AlertCircle size={16} className="text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-700">{sourcingCount}</div>
          <div className="text-[11px] text-amber-600 mt-1">Competitive Bidding Route</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-medium uppercase tracking-wider">Total Projected Spend</span>
            <DollarSign size={16} className="text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-slate-800">
            ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Calculated via price priority</div>
        </div>
      </div>

      {/* ── Filters & Search ──────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search PR No, item code, supplier..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-primary-500 focus:bg-white focus:ring-1 focus:ring-primary-100"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter size={13} />
            <span>Route:</span>
          </div>
          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 outline-none"
          >
            <option value="ALL">All Routes</option>
            <option value="CONTRACT_PO">CONTRACT_PO</option>
            <option value="DIRECT_PO">DIRECT_PO</option>
            <option value="APPROVED_PO">APPROVED_PO</option>
            <option value="CATALOG_PO">CATALOG_PO</option>
            <option value="SOURCING_RFQ">SOURCING_RFQ</option>
            <option value="SOURCING_RFP">SOURCING_RFP</option>
          </select>

          <select
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 outline-none"
          >
            <option value="ALL">All Plants</option>
            <option value="PUN1">PUN1 (Pune)</option>
            <option value="CHN1">CHN1 (Chennai)</option>
          </select>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">PR Line</th>
                <th className="px-4 py-3 font-semibold">Item & Description</th>
                <th className="px-4 py-3 font-semibold">Qty</th>
                <th className="px-4 py-3 font-semibold">Plant</th>
                <th className="px-4 py-3 font-semibold">Route</th>
                <th className="px-4 py-3 font-semibold">Supplier</th>
                <th className="px-4 py-3 font-semibold text-right">Unit Price</th>
                <th className="px-4 py-3 font-semibold text-right">Total (₹)</th>
                <th className="px-4 py-3 font-semibold">Policy Rationale</th>
                <th className="px-4 py-3 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDecisions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    {decisions.length === 0
                      ? 'No batch processed yet. Click "Upload PR Batch CSV" above to run decisions.'
                      : 'No decisions match the selected filters.'}
                  </td>
                </tr>
              ) : (
                filteredDecisions.map((d, index) => {
                  const id = d._id || d.id || d.pr_line_id || index;
                  return (
                    <tr key={id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {d.pr_no} #{d.pr_line}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-medium text-slate-800 truncate" title={d.item_description}>
                          {d.item_description}
                        </div>
                        <div className="text-[10px] text-slate-400">{d.item_code || 'NEW Item'}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.quantity} {d.uom}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] text-slate-700">{d.plant}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${getRouteBadge(
                            d.route
                          )}`}
                        >
                          {d.route}
                        </span>
                        {d.status === 'OVERRIDDEN' && (
                          <span className="ml-1 px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                            OVERRIDDEN
                          </span>
                        )}
                        {d.status === 'APPROVED' && (
                          <span className="ml-1 px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                            APPROVED
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-slate-800">{d.supplier_id || '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-700">
                        {d.unit_price ? `₹${d.unit_price.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-medium text-slate-900">
                        ₹{d.group_value_inr?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 max-w-sm">
                        <p className="text-[11px] text-slate-600 line-clamp-2" title={d.reason}>
                          {d.reason}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openOverrideModal(d)}
                            className="p-1 rounded hover:bg-slate-200 text-slate-600"
                            title="Override Route / Supplier"
                          >
                            <Edit3 size={13} />
                          </button>
                          {d.status !== 'APPROVED' && (
                            <button
                              onClick={() => handleApprove(d)}
                              className="p-1 rounded hover:bg-emerald-100 text-emerald-600"
                              title="Approve Decision"
                            >
                              <FileCheck size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Buyer Override Modal ──────────────────────────── */}
      {overrideModalOpen && selectedDecision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">
                Buyer Override: {selectedDecision.pr_no} #{selectedDecision.pr_line}
              </h3>
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleOverrideSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Route
                </label>
                <select
                  value={newRoute}
                  onChange={(e) => setNewRoute(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-primary-500 focus:bg-white"
                >
                  <option value="CONTRACT_PO">CONTRACT_PO</option>
                  <option value="DIRECT_PO">DIRECT_PO</option>
                  <option value="APPROVED_PO">APPROVED_PO</option>
                  <option value="CATALOG_PO">CATALOG_PO</option>
                  <option value="SOURCING_RFQ">SOURCING_RFQ</option>
                  <option value="SOURCING_RFP">SOURCING_RFP</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier ID
                </label>
                <input
                  type="text"
                  value={newSupplier}
                  onChange={(e) => setNewSupplier(e.target.value)}
                  placeholder="e.g. S013"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-primary-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Justification Comment <span className="text-red-500">* (Mandatory)</span>
                </label>
                <textarea
                  rows={3}
                  value={overrideComment}
                  onChange={(e) => setOverrideComment(e.target.value)}
                  placeholder="Explain why this route or supplier is being changed..."
                  required
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-primary-500 focus:bg-white resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overrideSubmitting || !overrideComment.trim()}
                  className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {overrideSubmitting ? 'Saving...' : 'Apply Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Blind Test Export Modal ──────────────────────── */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">Export CSV for Submission</h3>
              <button
                onClick={() => setExportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Download Filename
                </label>
                <input
                  type="text"
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-primary-500 focus:bg-white"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Required names: <code className="bg-slate-100 px-1 py-0.5 rounded">yourname__run1.csv</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">yourname__run2.csv</code>, <code className="bg-slate-100 px-1 py-0.5 rounded">yourname__preferred.csv</code>
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setExportModalOpen(false);
                    handleExport(exportType, customFilename);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
                >
                  <FileDown size={14} />
                  Download CSV
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
