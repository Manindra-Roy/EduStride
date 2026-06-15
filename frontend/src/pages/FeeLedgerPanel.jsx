import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  CreditCard, 
  Search, 
  Check, 
  X, 
  AlertTriangle, 
  CheckCircle, 
  Sliders, 
  Activity, 
  FileText,
  DollarSign
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Legend, 
  Tooltip 
} from 'recharts';

const FeeLedgerPanel = () => {
  const { user } = useAuth();
  
  const [ledgers, setLedgers] = useState([]);
  const [stats, setStats] = useState({
    totalExpectedRevenue: 0,
    actualCollectedRevenue: 0,
    outstandingBalance: 0,
    breakdown: { paid_months: 0, unpaid_months: 0, partial_months: 0 }
  });
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedLedger, setSelectedLedger] = useState(null);
  
  // Modals
  const [showPayModal, setShowPayModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [payingMonth, setPayingMonth] = useState('');
  
  // Forms
  const [manualForm, setManualForm] = useState({
    status: 'Paid',
    amount_paid: '1500',
    transaction_method: 'Cash Payment',
    receipt_id: ''
  });

  const [submitting, setSubmitting] = useState(false);

  const monthsName = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      if (user.role === 'Student') {
        // Fetch personal ledger
        const res = await axios.get(`/api/fees/ledger/${user.studentProfile._id}`);
        if (res.data.success) {
          setSelectedLedger(res.data.data);
        }
      } else {
        // Admin/Teacher fetches all ledgers and global stats
        const studentsRes = await axios.get('/api/students?limit=1000');
        const statsRes = user.role === 'SuperAdmin' ? await axios.get('/api/fees/stats') : null;
        
        const studentList = studentsRes.data.data || [];
        // Map ledgers from student profiles and attach student profile details onto student_id
        const mappedLedgers = studentList.map(s => {
          if (s.ledger) {
            return {
              ...s.ledger,
              student_id: {
                _id: s._id,
                name: s.name,
                roll_number: s.roll_number,
                class_level: s.class_level,
                monthly_fee: s.monthly_fee
              }
            };
          }
          return null;
        }).filter(Boolean);
        setLedgers(mappedLedgers);

        if (statsRes?.data?.success) {
          setStats(statsRes.data.data);
        } else {
          // Compute simple client-side fallback stats if not SuperAdmin
          let collected = 0;
          let paid = 0;
          let unpaid = 0;
          let partial = 0;

          mappedLedgers.forEach(l => {
            l.months.forEach(m => {
              collected += m.amount_paid || 0;
              if (m.status === 'Paid') paid++;
              else if (m.status === 'Unpaid') unpaid++;
              else if (m.status === 'Partial/Pending') partial++;
            });
          });

          const totalExpected = studentList.reduce((sum, s) => sum + ((s.monthly_fee || 1500) * 12), 0);
          setStats({
            totalExpectedRevenue: totalExpected,
            actualCollectedRevenue: collected,
            outstandingBalance: Math.max(0, totalExpected - collected),
            breakdown: { paid_months: paid, unpaid_months: unpaid, partial_months: partial }
          });
        }
      }
    } catch (err) {
      console.error('Failed to load ledger information:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  // Frontend search
  const filteredLedgers = useMemo(() => {
    return ledgers.filter(ledger => {
      const studentName = ledger.student_id?.name || '';
      const roll = ledger.student_id?.roll_number || '';
      return studentName.toLowerCase().includes(searchQuery.toLowerCase()) || roll.includes(searchQuery);
    });
  }, [ledgers, searchQuery]);

  // Trigger Mock Webhook Payment Confirmation (Student Gateway Checkout simulation)
  const handleCheckoutPayment = async () => {
    setSubmitting(true);
    try {
      const payload = {
        student_id: user.studentProfile._id,
        month_name: payingMonth,
        amount: user.studentProfile?.monthly_fee || 1500,
        payment_method: 'Stripe Gateway Hook',
        receipt_id: `TXN-STripe-${Date.now().toString().substring(5)}`
      };

      // Firing to public webhook endpoint to simulate external hooks
      const res = await axios.post('/api/fees/webhook', payload);
      if (res.data.success) {
        setShowPayModal(false);
        fetchData();
      }
    } catch (err) {
      alert('Mock payment processing failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Manual override
  const handleManualOverride = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        student_id: selectedLedger.student_id._id,
        month_name: payingMonth,
        status: manualForm.status,
        amount_paid: manualForm.amount_paid,
        transaction_method: manualForm.transaction_method,
        receipt_id: manualForm.receipt_id
      };

      const res = await axios.put('/api/fees/manual', payload);
      if (res.data.success) {
        setShowManualModal(false);
        fetchData();
        // Refresh selected details
        if (user.role === 'Student') {
          setSelectedLedger(res.data.data);
        } else {
          // Re-populate selected ledger
          const updatedLedger = res.data.data;
          setSelectedLedger(updatedLedger);
        }
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Manual recording failed.');
    } finally {
      setSubmitting(false);
    }
  };

  // Pie chart configurations
  const revenueChartData = [
    { name: 'Collected', value: stats.actualCollectedRevenue, color: '#10b981' },
    { name: 'Outstanding', value: stats.outstandingBalance, color: '#f43f5e' }
  ];

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">Tuition Fees Ledger Suite</h1>
        <p className="text-slate-400 text-sm mt-1">Audit transactions, record manual overrides, and review balances</p>
      </div>

      {/* --- ADMIN VIEW LAYOUT --- */}
      {user.role !== 'Student' && (
        <div className="space-y-6">
          {/* SuperAdmin analytics panel */}
          {user.role === 'SuperAdmin' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Financial stats widgets */}
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Expected Revenue</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-white font-outfit">₹{stats.totalExpectedRevenue.toLocaleString()}</p>
                    <span className="text-[10px] text-slate-500 block mt-1">Yearly target calculation</span>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Actual Collected Revenue</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-emerald-400 font-outfit">₹{stats.actualCollectedRevenue.toLocaleString()}</p>
                    <span className="text-[10px] text-emerald-500 font-semibold block mt-1">
                      {stats.totalExpectedRevenue > 0 
                        ? `${Math.round((stats.actualCollectedRevenue / stats.totalExpectedRevenue) * 100)}% of Goal` 
                        : '0% of Goal'}
                    </span>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Outstanding Balance</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-rose-400 font-outfit">₹{stats.outstandingBalance.toLocaleString()}</p>
                    <span className="text-[10px] text-rose-500 font-semibold block mt-1">Nag systems target list</span>
                  </div>
                </div>
              </div>

              {/* Visual chart */}
              <div className="glass-panel p-4 rounded-2xl border border-dark-800 h-48 lg:h-auto flex items-center justify-center">
                {stats.totalExpectedRevenue > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={65}
                        dataKey="value"
                      >
                        {revenueChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <span className="text-slate-500 text-xs">Waiting for financial records...</span>
                )}
              </div>
            </div>
          )}

          {/* Roster Ledger Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Column (Search & Table) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="glass-panel p-4 rounded-xl border border-dark-800 flex items-center">
                <span className="text-slate-500 pr-3">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  placeholder="Filter student ledgers by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-500"
                />
              </div>

              <div className="glass-panel rounded-2xl border border-dark-800 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  {loading ? (
                    <div className="text-center py-20">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500 mx-auto"></div>
                    </div>
                  ) : filteredLedgers.length === 0 ? (
                    <div className="text-center py-20 text-slate-500 text-sm">
                      No ledgers matching queries.
                    </div>
                  ) : (
                    <table className="custom-table text-xs">
                      <thead>
                        <tr>
                          <th>Roll</th>
                          <th>Student</th>
                          <th>Class</th>
                          <th>Jan - Dec Rolling standing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLedgers.map((ledger) => (
                          <tr 
                            key={ledger._id}
                            onClick={() => setSelectedLedger(ledger)}
                            className={`cursor-pointer transition duration-150 ${selectedLedger?._id === ledger._id ? 'bg-primary-600/5' : ''}`}
                          >
                            <td className="font-mono font-bold text-slate-400">{ledger.student_id?.roll_number}</td>
                            <td>
                              <div className="font-semibold text-white">{ledger.student_id?.name}</div>
                            </td>
                            <td>
                              <span className="px-2 py-0.5 rounded bg-dark-900 border border-dark-850 text-slate-400 font-semibold">{ledger.student_id?.class_level}</span>
                            </td>
                            <td>
                              <div className="flex gap-1.5 flex-wrap">
                                {ledger.months.map((m) => (
                                  <span 
                                    key={m.month_name} 
                                    title={`${m.month_name}: ${m.status}`}
                                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold ${
                                      m.status === 'Paid' 
                                        ? 'bg-emerald-500 text-white' 
                                        : m.status === 'Partial/Pending'
                                          ? 'bg-amber-500 text-dark-950'
                                          : 'bg-rose-500 text-white'
                                    }`}
                                  >
                                    {m.month_name[0]}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column (Single Ledger Detail & Actions) */}
            <div className="space-y-6">
              {selectedLedger ? (
                <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-6 relative overflow-hidden">
                  <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary-600/5 blur-[50px]" />
                  <div>
                    <h3 className="text-base font-bold text-white font-outfit">{selectedLedger.student_id?.name}</h3>
                    <p className="text-slate-400 text-xs mt-1">Roll No: {selectedLedger.student_id?.roll_number} • Class {selectedLedger.student_id?.class_level}</p>
                  </div>

                  {/* Monthly List with updates */}
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {selectedLedger.months.map((m) => (
                      <div key={m.month_name} className="flex justify-between items-center p-3 rounded-xl bg-dark-900/50 border border-dark-900/80">
                        <div>
                          <span className="text-xs text-white font-medium">{m.month_name}</span>
                          {m.status === 'Paid' && (
                            <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">Receipt: {m.receipt_id}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.status === 'Paid' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : m.status === 'Partial/Pending'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {m.status}
                          </span>
                          <button
                            onClick={() => {
                              setPayingMonth(m.month_name);
                              setManualForm({
                                status: m.status,
                                amount_paid: m.amount_paid || selectedLedger.student_id?.monthly_fee || '1500',
                                transaction_method: m.transaction_method || 'Cash Payment',
                                receipt_id: m.receipt_id || `REC-${Date.now().toString().substring(6)}`
                              });
                              setShowManualModal(true);
                            }}
                            className="p-1 rounded bg-dark-900 hover:bg-dark-850 border border-dark-800 text-slate-400 hover:text-white transition"
                          >
                            <Sliders size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="glass-panel p-8 rounded-2xl border border-dark-800 text-center py-24 text-slate-500 text-sm">
                  <Activity className="mx-auto text-dark-800 mb-3" size={36} />
                  <span>Select a student to inspect their 12-month accounting matrix</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- STUDENT PORTAL LAYOUT --- */}
      {user.role === 'Student' && selectedLedger && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column (12 Month Grid Cards) */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-white text-base font-bold font-outfit mb-2">Rolling Tuition Calendar Ledger</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {selectedLedger.months.map((m) => (
                <div key={m.month_name} className="glass-panel p-5 rounded-2xl border border-dark-800 flex justify-between items-center relative overflow-hidden">
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-white">{m.month_name}</h4>
                    <div>
                      <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Payment Status</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block mt-1 ${
                        m.status === 'Paid' 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                          : m.status === 'Partial/Pending'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {m.status}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-right flex flex-col items-end gap-3">
                    <span className="text-base font-bold text-white font-outfit">₹{(m.amount_paid || selectedLedger.student_id?.monthly_fee || 1500).toLocaleString()}</span>
                    {m.status !== 'Paid' ? (
                      <button
                        onClick={() => {
                          setPayingMonth(m.month_name);
                          setShowPayModal(true);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs transition duration-150 flex items-center gap-1 shadow-md hover:shadow-primary-500/10"
                      >
                        <CreditCard size={12} />
                        <span>Pay Fee</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <CheckCircle size={12} />
                        <span>Cleared</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column (Personal Invoice logs) */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-6">
            <h3 className="text-white text-base font-bold font-outfit mb-3 flex items-center gap-2">
              <FileText className="text-primary-500" size={18} />
              <span>Receipt Logs</span>
            </h3>
            
            <div className="space-y-3 max-h-[30rem] overflow-y-auto pr-1">
              {selectedLedger.months.filter(m => m.status === 'Paid').length > 0 ? (
                selectedLedger.months.filter(m => m.status === 'Paid').map((m) => (
                  <div key={m.month_name} className="p-4 rounded-xl bg-dark-900/50 border border-dark-850 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-dark-800">
                      <span className="text-xs font-bold text-white">{m.month_name} Invoice</span>
                      <span className="text-[10px] text-slate-500 font-mono">{m.receipt_id}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="text-slate-500 block">Amount Paid</span>
                        <span className="font-bold text-white font-mono">₹{m.amount_paid.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Method</span>
                        <span className="text-slate-350">{m.transaction_method}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block">Settlement Date</span>
                        <span className="text-slate-350">{new Date(m.payment_date).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs">
                  No payment receipts recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- CASH PAYMENT NOTICE MODAL (For Student portal fee payments) --- */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <AlertTriangle className="text-amber-500" size={18} />
                <span>Payment Information</span>
              </h3>
              <button onClick={() => setShowPayModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="flex justify-between items-center p-4 rounded-xl bg-dark-900 border border-dark-850">
                <div>
                  <span className="text-slate-400 text-xs block">Fee Item</span>
                  <span className="font-bold text-white text-sm">{payingMonth} Tuition Fee</span>
                </div>
                <span className="text-base font-bold text-white font-outfit font-mono">₹{(selectedLedger.student_id?.monthly_fee || 1500).toLocaleString()}</span>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                <p className="text-xs text-amber-400 font-bold flex items-center gap-1.5 font-outfit">
                  <span>Online Payments Offline</span>
                </p>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  We are not accepting online payments at this time. Please make cash payments directly at the school administration office to settle this fee.
                </p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="w-full py-2.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs transition duration-150 flex items-center justify-center"
                >
                  Understood
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MANUAL PAYMENT EDIT DIALOG (For SuperAdmin / Teacher overrides) --- */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit">Adjust Month Standing - {payingMonth}</h3>
              <button onClick={() => setShowManualModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleManualOverride} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Accounting Flag</label>
                <select
                  value={manualForm.status}
                  onChange={(e) => setManualForm({ ...manualForm, status: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                >
                  <option value="Paid">Paid (Completed)</option>
                  <option value="Unpaid">Unpaid (Defaulter)</option>
                  <option value="Partial/Pending">Partial/Pending Payment</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Transaction Amount (₹)</label>
                <input
                  type="number"
                  required
                  value={manualForm.amount_paid}
                  onChange={(e) => setManualForm({ ...manualForm, amount_paid: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Receipt ID</label>
                <input
                  type="text"
                  value={manualForm.receipt_id}
                  onChange={(e) => setManualForm({ ...manualForm, receipt_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Method Description</label>
                <input
                  type="text"
                  value={manualForm.transaction_method}
                  onChange={(e) => setManualForm({ ...manualForm, transaction_method: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button" 
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition"
                >
                  {submitting ? 'Updating...' : 'Apply Overrides'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeeLedgerPanel;
