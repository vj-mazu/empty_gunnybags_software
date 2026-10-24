import React, { useState, useEffect } from 'react';
import { getStocksToday, downloadPdf, downloadStocksPdf, deleteInward, deleteOutward, createApprovalRequest, invalidateCache } from '../api';
import InwardModal from './InwardModal';
import OutwardModal from './OutwardModal';
import MillTransferModal from './MillTransferModal';
import CustomConfirmModal from './CustomConfirmModal';
import { formatDate, formatINR, formatBags } from '../utils/formatters';

const renderProposedChange = (item, fieldName, originalVal, isPending, parties, varieties) => {
  if (!isPending || isPending.action_type !== 'EDIT' || !isPending.proposed_data) {
    return originalVal;
  }
  const proposed = isPending.proposed_data[fieldName];
  if (proposed === undefined || proposed === null) {
    return originalVal;
  }

  let isDifferent = false;
  if (fieldName === 'party' || fieldName === 'variety') {
    const currentId = item[fieldName] ? String(item[fieldName].id || item[fieldName]) : '';
    isDifferent = String(proposed) !== currentId;
  } else if (fieldName === 'rate' || fieldName === 'total_value' || fieldName === 'lf_amount' || fieldName === 'bags') {
    const currentNum = Number(item[fieldName]) || 0;
    const proposedNum = Number(proposed) || 0;
    isDifferent = Math.abs(currentNum - proposedNum) > 0.001;
  } else if (fieldName === 'lf_toggle') {
    isDifferent = Boolean(proposed) !== Boolean(item.lf_toggle);
  } else {
    isDifferent = String(proposed).trim() !== String(item[fieldName] || '').trim();
  }

  if (!isDifferent) {
    return originalVal;
  }

  let displayNew = proposed;
  if (fieldName === 'party') {
    const found = parties?.find(p => String(p.id) === String(proposed));
    displayNew = found ? found.name : proposed;
  } else if (fieldName === 'variety') {
    const found = varieties?.find(v => String(v.id) === String(proposed));
    displayNew = found ? `${found.name} (${Number(found.kgs_per_bag).toFixed(1)} kg)` : proposed;
  } else if (fieldName === 'rate' || fieldName === 'total_value' || fieldName === 'lf_amount') {
    const num = Number(proposed) || 0;
    displayNew = formatINR(num);
  } else if (fieldName === 'lf_toggle') {
    displayNew = proposed ? 'LF On' : 'LF Off';
  }

  return (
    <div style={{ lineHeight: '1.2' }}>
      <div style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '0.68rem' }}>{originalVal}</div>
      <div style={{ color: '#b45309', fontWeight: 800 }}>➜ {displayNew}</div>
    </div>
  );
};

const Stocks = ({ user, showToast }) => {
  const [varieties, setVarieties] = useState([]);
  const [parties, setParties] = useState([]);
  const [inwards, setInwards] = useState([]);
  const [outwards, setOutwards] = useState([]);
  
  const [viewMode, setViewMode] = useState('inward');

  const [showInwardModal, setShowInwardModal] = useState(false);
  const [showOutwardModal, setShowOutwardModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  const [businessDate, setBusinessDate] = useState('');
  const [openingStock, setOpeningStock] = useState(0);
  const [closingStock, setClosingStock] = useState(0);
  const [filterDate, setFilterDate] = useState('');

  const [showAllDates, setShowAllDates] = useState(false);
  const [selectedVarietyId, setSelectedVarietyId] = useState('');

  const [editingInward, setEditingInward] = useState(null);
  const [editingOutward, setEditingOutward] = useState(null);
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [pendingMap, setPendingMap] = useState({});

  // Custom confirmation modal state
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    confirmColor: '',
    onConfirm: () => {}
  });

  const handleDeleteClick = (type, id) => {
    setConfirmState({
      isOpen: true,
      title: `Delete ${type.toUpperCase()} Entry?`,
      message: `Are you sure you want to delete this ${type} entry? This request will remove the transaction.`,
      confirmText: 'Delete',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          const savedUser = (() => { try { return JSON.parse(localStorage.getItem('mother_india_user') || '{}'); } catch(e){ return {}; } })();
          const isOwner = user?.role === 'OWNER' || savedUser?.role === 'OWNER';

          if (isOwner) {
            if (type === 'inward') {
              await deleteInward(id);
            } else {
              await deleteOutward(id);
            }
            if (showToast) showToast('Entry deleted successfully!');
            fetchData();
          } else {
            await createApprovalRequest({
              action_type: 'DELETE',
              target_model: type === 'inward' ? 'INWARD' : 'OUTWARD',
              target_id: id
            });
            if (showToast) showToast('Deletion request submitted for Owner approval!');
          }
        } catch (err) {
          if (showToast) showToast(err.message || 'Failed to delete entry', 'error');
          else alert(err.message || 'Failed to delete entry');
        }
      }
    });
  };

  useEffect(() => {
    fetchData();
  }, [filterDate, showAllDates, selectedVarietyId]);

  const requestSeqRef = React.useRef(0);

  const fetchData = async () => {
    const currentSeq = ++requestSeqRef.current;
    try {
      const getBusinessTodayStr = () => {
        const now = new Date();
        const hours = now.getHours();
        const formatLocal = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const r = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${r}`;
        };
        if (hours < 6) {
          const yesterday = new Date(now);
          yesterday.setDate(now.getDate() - 1);
          return formatLocal(yesterday);
        }
        return formatLocal(now);
      };
      const todayStr = getBusinessTodayStr();
      const activeDate = filterDate || todayStr;
      setBusinessDate(activeDate);

      const params = {
        all: showAllDates,
        variety_id: selectedVarietyId || undefined,
        date: showAllDates ? undefined : activeDate
      };

      const data = await getStocksToday(params);
      
      if (currentSeq === requestSeqRef.current) {
        setVarieties(data.varieties || []);
        setParties(data.parties || []);
        setInwards(data.inwards || []);
        setOutwards(data.outwards || []);
        setOpeningStock(data.opening || 0);
        setClosingStock(data.closing || 0);
        setPendingMap(data.pending || {});
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaved = () => {
    invalidateCache('stocks-today');
    fetchData();
  };

  const handleDownloadPdf = (type, id) => {
    try {
      downloadPdf(type, id);
    } catch (err) {
      if (showToast) {
        showToast('Error downloading PDF: ' + err.message, 'error');
      } else {
        alert('Error downloading PDF: ' + err.message);
      }
    }
  };

  const isSplit = viewMode === 'split';
  const showInward = isSplit || viewMode === 'inward';
  const showOutward = isSplit || viewMode === 'outward' || viewMode === 'transfers';

  const salesOutwards = (outwards || []).filter(o => !o.is_transfer);
  const transferOutwards = (outwards || []).filter(o => o.is_transfer);
  const displayedOutwards = viewMode === 'transfers' 
    ? transferOutwards 
    : (viewMode === 'outward' ? salesOutwards : (outwards || []));

  return (
    <div style={{ width: '100%', maxWidth: '100%' }}>
      
      {/* HEADER SECTION */}
      <div className="card-hdr" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 className="card-title" style={{ fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <i className="fas fa-boxes-stacked" style={{ color: '#2563eb' }}></i> Daily Stock Registers
          </h2>
          <span style={{ fontSize: '0.84rem', color: '#1e40af', background: '#eff6ff', padding: '0.25rem 0.65rem', borderRadius: '6px', fontWeight: 700, border: '1px solid #bfdbfe' }}>
            <i className="fas fa-calendar-day" style={{ marginRight: '5px' }}></i>
            {showAllDates ? 'All History / All Dates' : `Date: ${businessDate ? formatDate(businessDate) : '-'}`}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Segmented Controls */}
          <div className="master-tabs-bar" style={{ margin: 0, padding: '4px' }}>
            <button 
              className={`master-tab-btn ${viewMode === 'inward' ? 'active' : ''}`}
              onClick={() => setViewMode('inward')}
              style={{ padding: '0.45rem 0.9rem' }}
            >
              <i className="fas fa-boxes-packing" style={{ color: viewMode === 'inward' ? '#059669' : '#64748b' }}></i>
              <span>Inward ({inwards.length})</span>
            </button>
            
            <button 
              className={`master-tab-btn ${viewMode === 'outward' ? 'active' : ''}`}
              onClick={() => setViewMode('outward')}
              style={{ padding: '0.45rem 0.9rem' }}
            >
              <i className="fas fa-truck-ramp-box" style={{ color: viewMode === 'outward' ? '#dc2626' : '#64748b' }}></i>
              <span>Outward Sales ({salesOutwards.length})</span>
            </button>

            <button 
              className={`master-tab-btn ${viewMode === 'transfers' ? 'active' : ''}`}
              onClick={() => setViewMode('transfers')}
              style={{ padding: '0.45rem 0.9rem' }}
            >
              <i className="fas fa-industry" style={{ color: viewMode === 'transfers' ? '#2563eb' : '#64748b' }}></i>
              <span>Mill Transfers ({transferOutwards.length})</span>
            </button>

            <button 
              className={`master-tab-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              style={{ padding: '0.45rem 0.85rem' }}
              title="Side by Side Split View"
            >
              <i className="fas fa-columns" style={{ color: viewMode === 'split' ? '#2563eb' : '#64748b' }}></i>
              <span>Split View</span>
            </button>
          </div>

          {/* Quick Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f8fafc', padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <label style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showAllDates} 
                onChange={(e) => setShowAllDates(e.target.checked)} 
              />
              All Dates
            </label>
          </div>

          {!showAllDates && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginRight: '0.25rem' }}>
              <label style={{ fontSize: '0.76rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Date:</label>
              <input 
                type="date" 
                className="input" 
                value={filterDate || businessDate} 
                onChange={(e) => setFilterDate(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem', width: '135px' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <select 
              className="input" 
              value={selectedVarietyId} 
              onChange={(e) => setSelectedVarietyId(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem', maxWidth: '170px' }}
            >
              <option value="">All Varieties</option>
              {varieties.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          <button className="btn btn-green" onClick={() => setShowInwardModal(true)}>
            <i className="fas fa-plus-circle"></i> + Inward
          </button>
          <button className="btn btn-blue" onClick={() => setShowOutwardModal(true)}>
            <i className="fas fa-minus-circle"></i> - Outward
          </button>
          <button 
            className="btn" 
            onClick={() => { setEditingTransfer(null); setShowTransferModal(true); }}
            style={{ background: '#2563eb', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            title="Transfer bags to an outside mill"
          >
            <i className="fas fa-industry"></i> ⇄ Mill Transfer
          </button>
          <button className="btn btn-green" onClick={() => downloadStocksPdf({ date: filterDate || businessDate })} style={{ background: '#059669' }}>
            <i className="fas fa-file-pdf"></i> PDF
          </button>
        </div>
      </div>

      {/* TODAY'S OPENING STOCK */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1.25rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px' }}>
          <i className="fas fa-boxes" style={{ color: '#2563eb', fontSize: '1.35rem' }}></i>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#1e40af', fontWeight: 700, textTransform: 'uppercase' }}>Day Opening Stock Position</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a' }}>{formatBags(openingStock)} Bags</div>
          </div>
        </div>
      </div>

      {/* REGISTERS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: isSplit ? '1fr 1fr' : '1fr', gap: '1.25rem', marginBottom: '1.25rem', width: '100%' }}>
        
        {/* INWARD REGISTER */}
        {showInward && (
          <div className="card" style={{ margin: 0, borderTop: '4px solid #10b981', padding: isSplit ? '0.85rem' : '1.15rem' }}>
            <div className="card-hdr" style={{ paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
              <div className="card-title" style={{ color: '#059669', fontSize: isSplit ? '0.88rem' : '0.95rem' }}>
                <i className="fas fa-boxes-packing"></i> Inward Register ({inwards.length})
              </div>
            </div>
            <div className="tbl-wrap">
              <table style={{ fontSize: isSplit ? '0.72rem' : '0.8rem', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center', width: isSplit ? '24px' : '35px', padding: isSplit ? '4px 2px' : '6px 8px' }}>SL</th>
                    <th style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Invoice</th>
                    <th style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>{isSplit ? 'Party' : 'Party / Supplier'}</th>
                    <th style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Variety</th>
                    <th style={{ textAlign: 'center', padding: isSplit ? '4px 3px' : '6px 8px' }}>Bags</th>
                    <th style={{ textAlign: 'right', padding: isSplit ? '4px 3px' : '6px 8px' }}>Rate</th>
                    <th style={{ textAlign: 'center', padding: isSplit ? '4px 2px' : '6px 8px' }}>LF</th>
                    <th style={{ textAlign: 'right', padding: isSplit ? '4px 4px' : '6px 8px' }}>Value</th>
                    <th style={{ textAlign: 'right', padding: isSplit ? '4px 3px' : '6px 8px' }}>P/B</th>
                    <th style={{ textAlign: 'center', width: isSplit ? '75px' : '100px', padding: isSplit ? '4px 2px' : '6px 8px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(inwards) && inwards.map((item, index) => {
                    const isPending = pendingMap[`INWARD_${item.id}`];
                    const rowBg = isPending 
                      ? (isPending.action_type === 'DELETE' ? '#fee2e2' : '#fef08a') 
                      : undefined;
                    const badgeBg = isPending?.action_type === 'DELETE' ? '#dc2626' : '#d97706';

                    return (
                      <tr key={item.id} style={{ backgroundColor: rowBg }}>
                        <td style={{ fontWeight: 600, textAlign: 'center', color: '#64748b', padding: isSplit ? '4px 2px' : '6px 8px' }}>{index + 1}</td>
                        <td style={{ fontWeight: 700, color: '#2563eb', padding: isSplit ? '4px 4px' : '6px 8px' }}>
                          <span 
                            onClick={() => handleDownloadPdf('inward', item.id)}
                            style={{ cursor: 'pointer', textDecoration: 'underline' }}
                            title="Click to view full-screen printable invoice"
                          >
                            {item.invoice_no}
                          </span>
                          {isPending && (
                            <span style={{ fontSize: '0.6rem', background: badgeBg, color: '#fff', padding: '1px 3px', borderRadius: '3px', fontWeight: 800, marginLeft: '4px' }}>
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="wrap-text" style={{ padding: isSplit ? '4px 4px' : '6px 8px', maxWidth: isSplit ? '85px' : '150px' }}>{renderProposedChange(item, 'party', item.party_name, isPending, parties, varieties)}</td>
                        <td className="wrap-text" style={{ padding: isSplit ? '4px 4px' : '6px 8px', maxWidth: isSplit ? '95px' : '160px' }}>{renderProposedChange(item, 'variety', item.kgs_per_bag ? `${item.variety_name} (${Number(item.kgs_per_bag).toFixed(0)}k)` : item.variety_name, isPending, parties, varieties)}</td>
                        <td style={{ fontWeight: 800, textAlign: 'center', color: '#059669', padding: isSplit ? '4px 3px' : '6px 8px' }}>{renderProposedChange(item, 'bags', `+${formatBags(item.bags)}`, isPending, parties, varieties)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, padding: isSplit ? '4px 3px' : '6px 8px' }}>{renderProposedChange(item, 'rate', formatINR(item.rate), isPending, parties, varieties)}</td>
                        <td style={{ textAlign: 'center', color: '#64748b', padding: isSplit ? '4px 2px' : '6px 8px' }}>
                          {renderProposedChange(item, 'lf_amount', item.lf_toggle ? formatINR(item.lf_amount) : '-', isPending, parties, varieties)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', padding: isSplit ? '4px 4px' : '6px 8px' }}>{renderProposedChange(item, 'total_value', formatINR(item.total_value), isPending, parties, varieties)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'right', color: '#2563eb', padding: isSplit ? '4px 3px' : '6px 8px' }}>
                          {formatINR(item.per_bag_cost && Number(item.per_bag_cost) > 0 ? item.per_bag_cost : (Number(item.total_value) / Number(item.bags || 1)))}
                        </td>
                        <td style={{ textAlign: 'center', padding: isSplit ? '4px 2px' : '6px 8px' }}>
                          <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center', alignItems: 'center' }}>
                            <button className="btn btn-ghost btn-sm" title="PDF" onClick={() => handleDownloadPdf('inward', item.id)} style={{ padding: '2px 4px' }}>
                              <i className="fas fa-file-pdf" style={{ color: '#ef4444' }}></i>
                            </button>
                            <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => { setEditingInward(item); setShowInwardModal(true); }} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                              <i className="fas fa-edit" style={{ color: isPending ? '#cbd5e1' : '#2563eb' }}></i>
                            </button>
                            <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteClick('inward', item.id)} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                              <i className="fas fa-trash" style={{ color: isPending ? '#cbd5e1' : '#dc2626' }}></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(!inwards || inwards.length === 0) && (
                    <tr><td colSpan="10" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>No inward records for selected date.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* OUTWARD REGISTER */}
        {showOutward && (
          <div className="card" style={{ margin: 0, borderTop: `4px solid ${viewMode === 'transfers' ? '#2563eb' : '#ef4444'}`, padding: isSplit ? '0.85rem' : '1.15rem' }}>
            <div className="card-hdr" style={{ paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
              <div className="card-title" style={{ color: viewMode === 'transfers' ? '#2563eb' : '#dc2626', fontSize: isSplit ? '0.88rem' : '0.95rem' }}>
                <i className={viewMode === 'transfers' ? "fas fa-industry" : "fas fa-truck-ramp-box"}></i> {viewMode === 'transfers' ? 'Mill Transfers Register' : (viewMode === 'outward' ? 'Outward Sales Register' : 'Outward Register')} ({displayedOutwards.length})
              </div>
            </div>
            <div className="tbl-wrap">
              <table style={{ fontSize: isSplit ? '0.72rem' : '0.8rem', width: '100%' }}>
                <thead>
                  {viewMode === 'transfers' ? (
                    <tr>
                      <th className="outward-th" style={{ textAlign: 'center', width: isSplit ? '24px' : '35px', padding: isSplit ? '4px 2px' : '6px 8px' }}>SL</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Transfer No</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Date</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>From Mill</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>To Mill</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Variety</th>
                      <th className="outward-th" style={{ textAlign: 'center', padding: isSplit ? '4px 3px' : '6px 8px' }}>Bags</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Remarks</th>
                      <th className="outward-th" style={{ textAlign: 'center', width: isSplit ? '75px' : '100px', padding: isSplit ? '4px 2px' : '6px 8px' }}>Actions</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="outward-th" style={{ textAlign: 'center', width: isSplit ? '24px' : '35px', padding: isSplit ? '4px 2px' : '6px 8px' }}>SL</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Invoice</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>{isSplit ? 'Party' : 'Customer / Party'}</th>
                      <th className="outward-th" style={{ padding: isSplit ? '4px 4px' : '6px 8px' }}>Variety</th>
                      <th className="outward-th" style={{ textAlign: 'center', padding: isSplit ? '4px 3px' : '6px 8px' }}>Bags</th>
                      <th className="outward-th" style={{ textAlign: 'right', padding: isSplit ? '4px 3px' : '6px 8px' }}>Rate</th>
                      <th className="outward-th" style={{ textAlign: 'center', padding: isSplit ? '4px 2px' : '6px 8px' }}>LF</th>
                      <th className="outward-th" style={{ textAlign: 'right', padding: isSplit ? '4px 4px' : '6px 8px' }}>Value</th>
                      <th className="outward-th" style={{ textAlign: 'right', padding: isSplit ? '4px 3px' : '6px 8px' }}>P/B</th>
                      <th className="outward-th" style={{ textAlign: 'center', width: isSplit ? '75px' : '100px', padding: isSplit ? '4px 2px' : '6px 8px' }}>Actions</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {Array.isArray(displayedOutwards) && displayedOutwards.map((item, index) => {
                    const isPending = pendingMap[`OUTWARD_${item.id}`];
                    const rowBg = isPending 
                      ? (isPending.action_type === 'DELETE' ? '#fee2e2' : '#fef08a') 
                      : undefined;
                    const badgeBg = isPending?.action_type === 'DELETE' ? '#dc2626' : '#d97706';

                    if (viewMode === 'transfers') {
                      return (
                        <tr key={item.id} style={{ backgroundColor: rowBg }}>
                          <td style={{ fontWeight: 600, textAlign: 'center', color: '#64748b', padding: isSplit ? '4px 2px' : '6px 8px' }}>{index + 1}</td>
                          <td style={{ fontWeight: 700, color: '#2563eb', padding: isSplit ? '4px 4px' : '6px 8px' }}>
                            <span 
                              onClick={() => handleDownloadPdf('outward', item.id)}
                              style={{ cursor: 'pointer', textDecoration: 'underline' }}
                              title="Click to view full-screen printable invoice"
                            >
                              {item.invoice_no}
                            </span>
                            {isPending && (
                              <span style={{ fontSize: '0.6rem', background: badgeBg, color: '#fff', padding: '1px 3px', borderRadius: '3px', fontWeight: 800, marginLeft: '4px' }}>
                                PENDING
                              </span>
                            )}
                          </td>
                          <td style={{ padding: isSplit ? '4px 4px' : '6px 8px', color: '#475569' }}>
                            {formatDate(item.date)}
                          </td>
                          <td style={{ padding: isSplit ? '4px 4px' : '6px 8px', fontWeight: 600, color: '#047857' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span>
                                <i className="fas fa-warehouse" style={{ marginRight: '4px' }}></i>
                                {item.from_place_name || 'Mother India'}
                              </span>
                              {(item.floor_name || (item.floor_allocations && item.floor_allocations.length > 0)) && (
                                <span style={{ fontSize: '0.66rem', color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1px 5px', borderRadius: '4px', width: 'fit-content', fontWeight: 700 }}>
                                  <i className="fas fa-layer-group" style={{ marginRight: '3px' }}></i>
                                  {item.floor_name || (item.floor_allocations.length > 1 ? `${item.floor_allocations.length} Floors` : (item.floor_allocations[0]?.floor_name || 'Floor'))}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: isSplit ? '4px 4px' : '6px 8px', fontWeight: 700, color: '#1d4ed8' }}>
                            <i className="fas fa-truck-moving" style={{ marginRight: '4px' }}></i>
                            {item.to_place_name || 'Outside Mill'}
                          </td>
                          <td className="wrap-text" style={{ padding: isSplit ? '4px 4px' : '6px 8px', maxWidth: isSplit ? '95px' : '160px' }}>
                            {item.kgs_per_bag ? `${item.variety_name} (${Number(item.kgs_per_bag).toFixed(0)}k)` : item.variety_name}
                          </td>
                          <td style={{ fontWeight: 800, textAlign: 'center', color: '#2563eb', padding: isSplit ? '4px 3px' : '6px 8px' }}>
                            {formatBags(item.bags)}
                          </td>
                          <td style={{ padding: isSplit ? '4px 4px' : '6px 8px', color: '#64748b', fontSize: '0.75rem' }}>
                            {item.remarks || '-'}
                          </td>
                          <td style={{ textAlign: 'center', padding: isSplit ? '4px 2px' : '6px 8px' }}>
                            <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center', alignItems: 'center' }}>
                              <button className="btn btn-ghost btn-sm" title="PDF" onClick={() => handleDownloadPdf('outward', item.id)} style={{ padding: '2px 4px' }}>
                                <i className="fas fa-file-pdf" style={{ color: '#ef4444' }}></i>
                              </button>
                              <button className="btn btn-ghost btn-sm" title="Edit Transfer" onClick={() => { setEditingTransfer(item); setShowTransferModal(true); }} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                                <i className="fas fa-edit" style={{ color: isPending ? '#cbd5e1' : '#2563eb' }}></i>
                              </button>
                              <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteClick('outward', item.id)} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                                <i className="fas fa-trash" style={{ color: isPending ? '#cbd5e1' : '#dc2626' }}></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={item.id} style={{ backgroundColor: rowBg }}>
                        <td style={{ fontWeight: 600, textAlign: 'center', color: '#64748b', padding: isSplit ? '4px 2px' : '6px 8px' }}>{index + 1}</td>
                        <td style={{ fontWeight: 700, color: '#2563eb', padding: isSplit ? '4px 4px' : '6px 8px' }}>
                          <span 
                            onClick={() => handleDownloadPdf('outward', item.id)}
                            style={{ cursor: 'pointer', textDecoration: 'underline' }}
                            title="Click to view full-screen printable invoice"
                          >
                            {item.invoice_no}
                          </span>
                          {isPending && (
                            <span style={{ fontSize: '0.6rem', background: badgeBg, color: '#fff', padding: '1px 3px', borderRadius: '3px', fontWeight: 800, marginLeft: '4px' }}>
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="wrap-text" style={{ padding: isSplit ? '4px 4px' : '6px 8px', maxWidth: isSplit ? '95px' : '160px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span>{renderProposedChange(item, 'party', item.party_name, isPending, parties, varieties)}</span>
                            {item.is_transfer && (
                              <span style={{ fontSize: '0.66rem', color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 5px', borderRadius: '4px', width: 'fit-content', fontWeight: 700 }}>
                                <i className="fas fa-industry"></i> To: {item.to_place_name || 'Outside Mill'}
                              </span>
                            )}
                            {item.from_place_name && item.from_place_name !== 'Mother India' && !item.is_transfer && (
                              <span style={{ fontSize: '0.66rem', color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '4px', width: 'fit-content', fontWeight: 700 }}>
                                <i className="fas fa-building"></i> Sold from {item.from_place_name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="wrap-text" style={{ padding: isSplit ? '4px 4px' : '6px 8px', maxWidth: isSplit ? '95px' : '160px' }}>{renderProposedChange(item, 'variety', item.kgs_per_bag ? `${item.variety_name} (${Number(item.kgs_per_bag).toFixed(0)}k)` : item.variety_name, isPending, parties, varieties)}</td>
                        <td style={{ fontWeight: 800, textAlign: 'center', color: '#dc2626', padding: isSplit ? '4px 3px' : '6px 8px' }}>{renderProposedChange(item, 'bags', `-${formatBags(item.bags)}`, isPending, parties, varieties)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, padding: isSplit ? '4px 3px' : '6px 8px' }}>{renderProposedChange(item, 'rate', formatINR(item.rate), isPending, parties, varieties)}</td>
                        <td style={{ textAlign: 'center', color: '#64748b', padding: isSplit ? '4px 2px' : '6px 8px' }}>
                          {renderProposedChange(item, 'lf_amount', item.lf_toggle ? formatINR(item.lf_amount) : '-', isPending, parties, varieties)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: '#0f172a', padding: isSplit ? '4px 4px' : '6px 8px' }}>{renderProposedChange(item, 'total_value', formatINR(item.total_value), isPending, parties, varieties)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'right', color: '#2563eb', padding: isSplit ? '4px 3px' : '6px 8px' }}>
                          {formatINR(item.per_bag_cost && Number(item.per_bag_cost) > 0 ? item.per_bag_cost : (Number(item.total_value) / Number(item.bags || 1)))}
                        </td>
                        <td style={{ textAlign: 'center', padding: isSplit ? '4px 2px' : '6px 8px' }}>
                          <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center', alignItems: 'center' }}>
                            <button className="btn btn-ghost btn-sm" title="PDF" onClick={() => handleDownloadPdf('outward', item.id)} style={{ padding: '2px 4px' }}>
                              <i className="fas fa-file-pdf" style={{ color: '#ef4444' }}></i>
                            </button>
                            <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => { setEditingOutward(item); setShowOutwardModal(true); }} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                              <i className="fas fa-edit" style={{ color: isPending ? '#cbd5e1' : '#2563eb' }}></i>
                            </button>
                            <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteClick('outward', item.id)} style={{ padding: '2px 4px' }} disabled={!!isPending}>
                              <i className="fas fa-trash" style={{ color: isPending ? '#cbd5e1' : '#dc2626' }}></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(!displayedOutwards || displayedOutwards.length === 0) && (
                    <tr><td colSpan={viewMode === 'transfers' ? '9' : '10'} style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>{viewMode === 'transfers' ? 'No mill transfer records for selected date.' : 'No outward records for selected date.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* TODAY'S CLOSING STOCK */}
      <div style={{ marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1.25rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
          <i className="fas fa-cubes" style={{ color: '#d97706', fontSize: '1.35rem' }}></i>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#92400e', fontWeight: 700, textTransform: 'uppercase' }}>Day Closing Stock Position</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b45309' }}>{formatBags(closingStock)} Bags</div>
          </div>
        </div>
      </div>

      {showInwardModal && (
        <InwardModal 
          onClose={() => { setShowInwardModal(false); setEditingInward(null); }} 
          onSaved={handleSaved}
          varieties={varieties}
          showToast={showToast}
          editItem={editingInward}
          user={user}
        />
      )}

      {showOutwardModal && (
        <OutwardModal 
          onClose={() => { setShowOutwardModal(false); setEditingOutward(null); }} 
          onSaved={handleSaved}
          varieties={varieties}
          showToast={showToast}
          editItem={editingOutward}
          user={user}
        />
      )}

      {showTransferModal && (
        <MillTransferModal 
          isOpen={showTransferModal}
          onClose={() => { setShowTransferModal(false); setEditingTransfer(null); }} 
          onSaved={handleSaved}
          editItem={editingTransfer}
          user={user}
          showToast={showToast}
          defaultDate={filterDate || businessDate}
          varieties={varieties}
        />
      )}

      <CustomConfirmModal 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        confirmColor={confirmState.confirmColor}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default Stocks;
