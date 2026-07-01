import React, { useEffect, useState, useMemo, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  CreditCard, 
  Search, 
  X, 
  AlertTriangle, 
  CheckCircle, 
  Sliders, 
  Activity, 
  FileText,
  DollarSign,
  Calendar,
  TrendingUp,
  Lock,
  HelpCircle,
  Check
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
  const [chartTab, setChartTab] = useState('revenue'); // 'revenue' or 'breakdown'

  const detailPanelRef = useRef(null);

  useEffect(() => {
    if (selectedLedger && window.innerWidth < 1024 && detailPanelRef.current) {
      detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedLedger]);
  
  // Modals
  const [showPayModal, setShowPayModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [payingMonth, setPayingMonth] = useState('');
  const [paymentType, setPaymentType] = useState('online'); // 'online' or 'cash'
  
  // Forms
  const [manualForm, setManualForm] = useState({
    status: 'Paid',
    amount_paid: '1500',
    transaction_method: 'Cash Payment',
    receipt_id: ''
  });

  const [submitting, setSubmitting] = useState(false);

  // Compute stats for single selected student ledger
  const selectedLedgerStats = useMemo(() => {
    if (!selectedLedger) return null;
    let paid = 0;
    let unpaid = 0;
    let pending = 0;
    selectedLedger.months.forEach(m => {
      if (m.status === 'Paid') paid++;
      else if (m.status === 'Unpaid') unpaid++;
      else if (m.status === 'Partial/Pending') pending++;
    });
    const monthlyFee = selectedLedger.student_id?.monthly_fee || 1500;
    return { paid, unpaid, pending, monthlyFee };
  }, [selectedLedger]);

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

  const breakdownChartData = [
    { name: 'Paid Months', value: stats.breakdown?.paid_months || 0, color: '#10b981' },
    { name: 'Partial/Pending', value: stats.breakdown?.partial_months || 0, color: '#f59e0b' },
    { name: 'Unpaid/Defaulter', value: stats.breakdown?.unpaid_months || 0, color: '#ef4444' }
  ];

  return (
    <div className="space-y-6">
      {/* Page Title - Redesigned to be a gorgeous premium header card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 via-dark-900/30 to-indigo-900/20 border border-dark-800/80 p-6 sm:p-8 shadow-xl">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <DollarSign size={160} className="text-primary-500" />
        </div>
        <div className="relative z-10 space-y-2">
          <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-primary-500/10 text-primary-400 border border-primary-500/20">
            Accounting Panel
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-outfit mt-1">Tuition Fees Ledger Suite</h1>
          <p className="text-slate-400 text-xs sm:text-sm max-w-2xl">
            Audit school transactions, provision adjustments, manage billing compliance, and review student accounting statements.
          </p>
        </div>
      </div>

      {/* --- ADMIN VIEW LAYOUT --- */}
      {user.role !== 'Student' && (
        <div className="space-y-6">
          {/* SuperAdmin analytics panel */}
          {user.role === 'SuperAdmin' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Financial stats widgets */}
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between hover:border-dark-700 transition">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Expected Revenue</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-white font-outfit font-mono">₹{stats.totalExpectedRevenue.toLocaleString()}</p>
                    <span className="text-[10px] text-slate-500 block mt-1">Yearly target calculation</span>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between hover:border-dark-700 transition">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Actual Collected Revenue</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-emerald-400 font-outfit font-mono">₹{stats.actualCollectedRevenue.toLocaleString()}</p>
                    <span className="text-[10px] text-emerald-500 font-semibold block mt-1 font-mono">
                      {stats.totalExpectedRevenue > 0 
                        ? `${Math.round((stats.actualCollectedRevenue / stats.totalExpectedRevenue) * 100)}% of Goal` 
                        : '0% of Goal'}
                    </span>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between hover:border-dark-700 transition">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Outstanding Balance</span>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-rose-400 font-outfit font-mono">₹{stats.outstandingBalance.toLocaleString()}</p>
                    <span className="text-[10px] text-rose-500 font-semibold block mt-1">Defaulter notification list</span>
                  </div>
                </div>
              </div>

              {/* Visual chart */}
              <div className="glass-panel p-5 rounded-2xl border border-dark-800 flex flex-col justify-between h-56 lg:h-auto min-h-[14rem]">
                <div className="flex justify-between items-center mb-2 shrink-0 select-none">
                  <span className="text-[11px] font-bold text-slate-450 uppercase tracking-wider">Metrics Breakdown</span>
                  <div className="flex gap-1 bg-dark-950 p-0.5 rounded border border-dark-850">
                    <button
                      type="button"
                      onClick={() => setChartTab('revenue')}
                      className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase transition ${
                        chartTab === 'revenue' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-350'
                      }`}
                    >
                      Revenue
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartTab('breakdown')}
                      className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase transition ${
                        chartTab === 'breakdown' ? 'bg-primary-600 text-white' : 'text-slate-500 hover:text-slate-355'
                      }`}
                    >
                      Status
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[7rem] flex items-center justify-center relative">
                  {stats.totalExpectedRevenue > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartTab === 'revenue' ? revenueChartData : breakdownChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={38}
                          outerRadius={52}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {(chartTab === 'revenue' ? revenueChartData : breakdownChartData).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0b0c16', borderColor: '#2e3155', borderRadius: '12px' }}
                          itemStyle={{ fontSize: '10px', color: '#fff', fontWeight: 'bold' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <span className="text-slate-500 text-xs">Waiting for financial records...</span>
                  )}
                </div>

                <div className="flex justify-center gap-x-3 gap-y-1 mt-2 text-[9px] text-slate-400 font-bold tracking-wide uppercase select-none shrink-0 flex-wrap">
                  {(chartTab === 'revenue' ? revenueChartData : breakdownChartData).map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span>{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Roster Ledger Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Column (Search & Table) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 pointer-events-none">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  placeholder="Search student ledgers by name or roll number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900/50 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-xs text-white placeholder-slate-500 outline-none transition duration-150 shadow-inner"
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
                    <table className="w-full text-left border-collapse text-xs select-none">
                      <thead>
                        <tr className="border-b border-dark-800 bg-dark-950/60 text-slate-450 uppercase tracking-wider font-bold font-mono">
                          <th className="py-3.5 px-4 rounded-tl-xl">Roll</th>
                          <th className="py-3.5 px-4">Student</th>
                          <th className="py-3.5 px-4">Class</th>
                          <th className="py-3.5 px-4 text-right rounded-tr-xl">12-Month Matrix</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-800/50">
                        {filteredLedgers.map((ledger) => (
                          <tr 
                            key={ledger._id}
                            onClick={() => setSelectedLedger(ledger)}
                            className={`group cursor-pointer transition-all duration-150 hover:bg-dark-900/40 ${selectedLedger?._id === ledger._id ? 'bg-primary-600/5 border-l-2 border-l-primary-500' : ''}`}
                          >
                            <td className="py-4 px-4 font-mono font-bold text-slate-400 group-hover:text-white transition">
                              {ledger.student_id?.roll_number}
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-primary-600/35 to-indigo-500/20 border border-primary-500/10 flex items-center justify-center font-bold text-white text-[10px] font-outfit uppercase">
                                  {ledger.student_id?.name[0]}
                                </div>
                                <div>
                                  <div className="font-semibold text-white group-hover:text-primary-400 transition">{ledger.student_id?.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <span className="px-2.5 py-0.5 rounded-lg bg-dark-900/80 border border-dark-800 text-[10px] text-slate-450 font-bold tracking-wider font-mono">
                                Class {ledger.student_id?.class_level}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right">
                              <div className="flex gap-1.5 justify-end flex-wrap">
                                {ledger.months.map((m) => (
                                  <span 
                                    key={m.month_name} 
                                    title={`${m.month_name}: ${m.status}`}
                                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold transition duration-150 hover:scale-110 ${
                                      m.status === 'Paid' 
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                        : m.status === 'Partial/Pending'
                                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
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
            <div className="space-y-6" ref={detailPanelRef}>
              {selectedLedger ? (
                <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-6 relative overflow-hidden">
                  <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary-600/5 blur-[50px]" />
                  <div className="flex justify-between items-start border-b border-dark-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-sm font-outfit shadow-md">
                        {selectedLedger.student_id?.name[0].toUpperCase()}
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-white font-outfit">{selectedLedger.student_id?.name}</h3>
                        <p className="text-slate-455 text-[10px] mt-0.5 font-mono">Roll: {selectedLedger.student_id?.roll_number} • Class {selectedLedger.student_id?.class_level}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedLedger(null)}
                      className="p-2 rounded-lg bg-dark-900 border border-dark-850 hover:bg-dark-800 text-slate-500 hover:text-white transition lg:hidden"
                      title="Close panel"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Student Stats Summary Strip */}
                  {selectedLedgerStats && (
                    <div className="grid grid-cols-3 gap-2.5 p-3 rounded-xl bg-dark-900/50 border border-dark-800 text-center select-none font-outfit shrink-0">
                      <div className="border-r border-dark-800/80">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Paid</span>
                        <span className="text-sm font-extrabold text-emerald-400 mt-0.5 block">{selectedLedgerStats.paid} / 12</span>
                      </div>
                      <div className="border-r border-dark-800/80">
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Pending</span>
                        <span className="text-sm font-extrabold text-amber-400 mt-0.5 block">{selectedLedgerStats.pending} / 12</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Unpaid</span>
                        <span className="text-sm font-extrabold text-rose-400 mt-0.5 block">{selectedLedgerStats.unpaid} / 12</span>
                      </div>
                    </div>
                  )}

                  {/* Monthly List with status indicator borders */}
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {selectedLedger.months.map((m) => {
                      const indicatorBorder = m.status === 'Paid'
                        ? 'border-l-2 border-l-emerald-500/60'
                        : m.status === 'Partial/Pending'
                          ? 'border-l-2 border-l-amber-500/60'
                          : 'border-l-2 border-l-rose-500/60';
                      return (
                        <div key={m.month_name} className={`flex justify-between items-center p-3 rounded-xl bg-dark-900/50 border border-dark-900/80 transition hover:border-dark-750 ${indicatorBorder}`}>
                          <div>
                            <span className="text-xs text-white font-semibold">{m.month_name}</span>
                            {m.status === 'Paid' && (
                              <span className="text-[9px] text-slate-500 block mt-0.5 font-mono">Receipt: {m.receipt_id}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase ${
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
                              title="Manual Adjust"
                            >
                              <Sliders size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
              {selectedLedger.months.map((m) => {
                const statusBorder = m.status === 'Paid'
                  ? 'border-l-4 border-l-emerald-500 shadow-emerald-950/5'
                  : m.status === 'Partial/Pending'
                    ? 'border-l-4 border-l-amber-500 shadow-amber-950/5'
                    : 'border-l-4 border-l-rose-500 shadow-rose-950/5';
                return (
                  <div key={m.month_name} className={`glass-panel p-5 rounded-2xl border border-dark-800 flex justify-between items-center relative overflow-hidden transition-all duration-300 hover:border-dark-700 hover:scale-[1.01] hover:shadow-xl ${statusBorder}`}>
                    <div className="space-y-2">
                      <h4 className="text-sm font-extrabold text-white font-outfit">{m.month_name}</h4>
                      <div>
                        <span className="text-[9px] text-slate-450 block uppercase tracking-wider font-bold">Payment Status</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase inline-block mt-1 ${
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
                    
                    <div className="text-right flex flex-col items-end gap-3 select-none">
                      <span className="text-base font-extrabold text-white font-outfit font-mono">₹{(m.amount_paid || selectedLedger.student_id?.monthly_fee || 1500).toLocaleString()}</span>
                      {m.status !== 'Paid' ? (
                        <button
                          onClick={() => {
                            setPayingMonth(m.month_name);
                            setShowPayModal(true);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 active:bg-primary-700 text-white font-bold text-[10px] uppercase tracking-wide transition duration-150 flex items-center gap-1.5 shadow-md hover:shadow-primary-500/10"
                        >
                          <CreditCard size={12} />
                          <span>Pay Fee</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-bold uppercase tracking-wider">
                          <CheckCircle size={12} className="text-emerald-400" />
                          <span>Cleared</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
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

      {/* --- MOCK ONLINE PAYMENT OR CASH INSTRUCTIONS MODAL (For Student portal fee payments) --- */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-5 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <CreditCard className="text-primary-500" size={18} />
                <span>Settle Tuition Fee - {payingMonth}</span>
              </h3>
              <button onClick={() => { setShowPayModal(false); setPaymentType('online'); }} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-center p-3.5 rounded-xl bg-dark-900 border border-dark-850">
                <div>
                  <span className="text-slate-400 text-[10px] block uppercase font-bold tracking-wider">Fee Description</span>
                  <span className="font-bold text-white text-xs mt-0.5 block">{payingMonth} Tuition Fee</span>
                </div>
                <span className="text-base font-bold text-white font-outfit font-mono">₹{(selectedLedger.student_id?.monthly_fee || 1500).toLocaleString()}</span>
              </div>

              {/* Tab Selector */}
              <div className="flex gap-2 bg-dark-950 p-1 rounded-lg border border-dark-850">
                <button
                  type="button"
                  onClick={() => setPaymentType('online')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    paymentType === 'online'
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-500 hover:text-slate-350'
                  }`}
                >
                  <Activity size={12} />
                  <span>Stripe Checkout</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('cash')}
                  className={`flex-1 py-1.5 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    paymentType === 'cash'
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-500 hover:text-slate-350'
                  }`}
                >
                  <AlertTriangle size={12} />
                  <span>Cash Payment</span>
                </button>
              </div>

              {/* Online simulator view */}
              {paymentType === 'online' ? (
                <div className="space-y-4">
                  {/* Simulated Premium Glass Credit Card */}
                  <div className="relative h-44 rounded-2xl bg-gradient-to-br from-indigo-600/90 to-purple-800/90 border border-indigo-500/30 p-5 text-white flex flex-col justify-between shadow-xl shadow-indigo-950/20 overflow-hidden font-mono select-none">
                    <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                      <CreditCard size={150} />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 px-2 py-0.5 rounded">Stripe Simulator</span>
                      <div className="w-8 h-6 rounded bg-amber-500/80 border border-amber-400/40 relative overflow-hidden flex items-center justify-center">
                        <div className="w-full h-0.5 bg-dark-900/10 absolute top-1.5" />
                        <div className="w-full h-0.5 bg-dark-900/10 absolute top-3" />
                      </div>
                    </div>
                    <div className="text-base font-bold tracking-widest text-center text-slate-100">
                      4242 •••• •••• {Date.now().toString().substring(9)}
                    </div>
                    <div className="flex justify-between items-end text-[10px]">
                      <div>
                        <span className="text-slate-400 block text-[8px] uppercase tracking-wider font-semibold">Cardholder</span>
                        <span className="font-semibold text-slate-200">{user.studentProfile?.name || 'STUDENT USER'}</span>
                      </div>
                      <div className="flex gap-4 font-mono">
                        <div>
                          <span className="text-slate-400 block text-[8px] uppercase tracking-wider font-semibold">Expiry</span>
                          <span className="font-semibold text-slate-200">12/28</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[8px] uppercase tracking-wider font-semibold">CVV</span>
                          <span className="font-semibold text-slate-200">•••</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-primary-950/40 border border-primary-800/30 space-y-1.5">
                    <p className="text-[11px] text-slate-350 leading-relaxed">
                      Settle this ledger month instantly by firing a transaction to the public webhook API.
                    </p>
                  </div>

                  <button 
                    type="button"
                    onClick={handleCheckoutPayment}
                    disabled={submitting}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition duration-150 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 disabled:opacity-40"
                  >
                    {submitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Simulating webhook hook...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle size={14} />
                        <span>Authorize Stripe Webhook Checkout</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Cash offline instructions view */
                <div className="space-y-4 animate-fadeIn">
                  <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
                    <p className="text-xs text-amber-400 font-bold flex items-center gap-1.5 font-outfit">
                      <span>Office Hours Operating Desk</span>
                    </p>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Please settle the tuition fees directly at the cash register counters. Receipts are generated dynamically by accounting admin staff upon settlement.
                    </p>
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-1 font-mono">
                    <p>• Desk Hours: Mon - Fri (09:00 AM - 04:00 PM)</p>
                    <p>• Accepted Methods: Cash, Cheques, Bank Transfers</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => { setShowPayModal(false); setPaymentType('online'); }}
                    className="w-full py-2.5 rounded-lg bg-dark-900 border border-dark-850 hover:bg-dark-800 text-slate-400 hover:text-white transition font-semibold text-xs text-center"
                  >
                    Understood & Dismiss
                  </button>
                </div>
              )}
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
