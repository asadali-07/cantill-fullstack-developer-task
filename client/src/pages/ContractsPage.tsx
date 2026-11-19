import { useState, useEffect, useRef, Fragment } from 'react';
import {
  FileText,
  Search,
  Upload,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Building,
  DollarSign,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  X,
  FileCheck,
} from 'lucide-react';
import apiClient from '../api/client';
import toast from 'react-hot-toast';

interface ContractLine {
  item_code: string;
  item_description?: string;
  contracted_price: number;
  uom: string;
}

interface Contract {
  _id?: string;
  contract_ref: string;
  supplier_id: string;
  supplier_name?: string;
  contract_type: string;
  valid_from: string;
  valid_to: string;
  ceiling_value: number;
  cumulative_spend: number;
  plant: string;
  is_active: boolean;
  lines: ContractLine[];
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRef, setExpandedRef] = useState<string | null>(null);

  // Upload PDF modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadContracts = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/contracts');
      const list = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.contracts)
        ? res.data.contracts
        : [];

      const normalized: Contract[] = list.map((c: any) => ({
        ...c,
        contract_ref: c.contract_ref || c.contract_id || '',
        supplier_id: c.supplier_id || '',
        supplier_name: c.supplier_name || c.supplier_id || '',
        contract_type: c.contract_type || 'Rate Contract',
        valid_from: c.valid_from || c.start_date || '',
        valid_to: c.valid_to || c.end_date || '',
        ceiling_value: Number(c.ceiling_value ?? c.value_cap ?? 0),
        cumulative_spend: Number(c.cumulative_spend ?? c.consumed_value ?? 0),
        plant: c.plant || 'ALL (PUN1, CHN1)',
        is_active: c.is_active ?? true,
        lines: (c.lines || []).map((l: any) => ({
          ...l,
          item_code: l.item_code || '',
          item_description: l.item_description || l.description || '',
          contracted_price: Number(l.contracted_price ?? l.rate ?? 0),
          uom: l.uom || 'NOS',
        })),
      }));

      setContracts(normalized);
    } catch {
      toast.error('Failed to load contracts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContracts();
  }, []);

  const handleUploadPDF = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) {
      toast.error('Please select a contract PDF file');
      return;
    }

    const formData = new FormData();
    formData.append('pdf', pdfFile);

    setUploading(true);
    try {
      const res = await apiClient.post('/contracts/upload-pdf', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const newRef = res.data?.extracted?.contract_id || res.data?.contract?.contract_id;
      toast.success(res.data?.message || 'Contract uploaded and processed successfully');
      setUploadModalOpen(false);
      setPdfFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await loadContracts();
      if (newRef) {
        setExpandedRef(newRef);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to parse contract PDF');
    } finally {
      setUploading(false);
    }
  };

  const filteredContracts = contracts.filter((c) => {
    const term = searchTerm.toLowerCase();
    return (
      c.contract_ref?.toLowerCase().includes(term) ||
      c.supplier_id?.toLowerCase().includes(term) ||
      c.supplier_name?.toLowerCase().includes(term) ||
      c.plant?.toLowerCase().includes(term) ||
      c.lines?.some(
        (l) =>
          l.item_code?.toLowerCase().includes(term) ||
          l.item_description?.toLowerCase().includes(term)
      )
    );
  });

  const totalCeiling = contracts.reduce((sum, c) => sum + (c.ceiling_value || 0), 0);
  const totalSpend = contracts.reduce((sum, c) => sum + (c.cumulative_spend || 0), 0);

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Page Header ──────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📄 Contract Register</h2>
          <p className="text-xs text-slate-500">
            Active Rate Contracts, Ceilings, Unit Rates & Real-Time Spend Tracking
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setUploadModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-3.5 py-2 text-xs font-medium shadow-xs transition-colors"
          >
            <Upload size={14} />
            Upload Contract PDF
          </button>

          <button
            onClick={loadContracts}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 shadow-2xs"
            title="Refresh contracts"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── KPI Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400 block mb-1">
            Total Contracts
          </span>
          <div className="text-2xl font-bold text-slate-800">{contracts.length}</div>
          <div className="text-[11px] text-slate-400 mt-1">Including PDF rate contracts</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400 block mb-1">
            Total Ceiling Value
          </span>
          <div className="text-2xl font-bold text-slate-800">
            ₹{totalCeiling.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Across all agreements</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400 block mb-1">
            Consumed Value
          </span>
          <div className="text-2xl font-bold text-emerald-700">
            ₹{totalSpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-emerald-600 mt-1">
            {totalCeiling ? ((totalSpend / totalCeiling) * 100).toFixed(1) : 0}% of total ceiling
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400 block mb-1">
            Remaining Capacity
          </span>
          <div className="text-2xl font-bold text-indigo-700">
            ₹{Math.max(0, totalCeiling - totalSpend).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-indigo-600 mt-1">Available for auto-PO</div>
        </div>
      </div>

      {/* ── Search Bar ───────────────────────────────────── */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by contract ref, supplier, item code..."
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-100 shadow-2xs"
        />
      </div>

      {/* ── Contracts Table ──────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 font-semibold">Contract Ref</th>
                <th className="px-4 py-3 font-semibold">Supplier</th>
                <th className="px-4 py-3 font-semibold">Plant</th>
                <th className="px-4 py-3 font-semibold">Validity</th>
                <th className="px-4 py-3 font-semibold">Ceiling Utilization</th>
                <th className="px-4 py-3 font-semibold text-right">Ceiling (₹)</th>
                <th className="px-4 py-3 font-semibold text-right">Consumed (₹)</th>
                <th className="px-4 py-3 font-semibold text-center">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredContracts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No contracts found matching your search.
                  </td>
                </tr>
              ) : (
                filteredContracts.map((c) => {
                  const percent = c.ceiling_value
                    ? Math.min(100, (c.cumulative_spend / c.ceiling_value) * 100)
                    : 0;
                  const isExpanded = expandedRef === c.contract_ref;

                  return (
                    <Fragment key={c.contract_ref}>
                      <tr
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                        onClick={() =>
                          setExpandedRef(isExpanded ? null : c.contract_ref)
                        }
                      >
                        <td className="px-4 py-3 font-mono font-bold text-primary-700 whitespace-nowrap">
                          {c.contract_ref}
                          {c.contract_ref.includes('031') || c.contract_ref.includes('033') ? (
                            <span className="ml-1.5 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.2 text-[9px] font-bold">
                              PDF Contract
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">
                            {c.supplier_name || c.supplier_id}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{c.supplier_id}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono">{c.plant}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-[11px] text-slate-500">
                          {c.valid_from ? new Date(c.valid_from).toLocaleDateString() : 'N/A'} -{' '}
                          {c.valid_to ? new Date(c.valid_to).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="px-4 py-3 w-44">
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                            <span>{percent.toFixed(1)}%</span>
                            <span>
                              Rem: ₹
                              {Math.max(0, c.ceiling_value - c.cumulative_spend).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getProgressColor(percent)} transition-all`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-slate-800 whitespace-nowrap">
                          ₹{c.ceiling_value?.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                          ₹{c.cumulative_spend?.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRef(isExpanded ? null : c.contract_ref);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:text-primary-800"
                          >
                            <span>{c.lines?.length || 0} lines</span>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Item Lines */}
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={8} className="px-6 py-3">
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                                Contracted Line Items ({c.contract_ref}):
                              </span>
                              <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-100">
                                  <tr>
                                    <th className="px-3 py-1.5 font-semibold">Item Code</th>
                                    <th className="px-3 py-1.5 font-semibold">Description</th>
                                    <th className="px-3 py-1.5 font-semibold">UOM</th>
                                    <th className="px-3 py-1.5 font-semibold text-right">
                                      Contracted Price (₹)
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {c.lines?.map((line, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50">
                                      <td className="px-3 py-1.5 font-mono font-medium text-slate-900">
                                        {line.item_code}
                                      </td>
                                      <td className="px-3 py-1.5 text-slate-700">
                                        {line.item_description || line.item_code}
                                      </td>
                                      <td className="px-3 py-1.5 text-slate-500">{line.uom || 'NOS'}</td>
                                      <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-700">
                                        ₹{line.contracted_price?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Upload PDF Modal ──────────────────────────────── */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-800">Upload Rate Contract PDF</h3>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUploadPDF} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Contract PDF Document
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                />
                <p className="text-[10px] text-slate-400 mt-1.5">
                  The PDF text and Schedule A rate tables will be extracted automatically.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !pdfFile}
                  className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Upload size={14} />
                  {uploading ? 'Parsing PDF...' : 'Upload & Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
