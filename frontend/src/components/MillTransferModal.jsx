import React, { useState, useEffect, useRef } from 'react';
import { getVarieties, getPlaces, getFloors, getFloorStock, createOutward, updateOutward, createApprovalRequest } from '../api';
import SearchableSelect from './SearchableSelect';
import { formatBags } from '../utils/formatters';

const MillTransferModal = ({ 
  isOpen, 
  onClose, 
  onSaved, 
  editItem = null, 
  user = null, 
  showToast = null, 
  defaultDate = '',
  varieties: initialVarieties = null
}) => {
  if (isOpen === false) return null;

  const [varieties, setVarieties] = useState(initialVarieties || []);
  const [places, setPlaces] = useState([]);
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [date, setDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [bags, setBags] = useState('');
  const [fromPlaceId, setFromPlaceId] = useState(''); // '' = Mother India Main Mill
  const [toPlaceId, setToPlaceId] = useState('');
  const [remarks, setRemarks] = useState('');

  // Floor allocation state
  const [floorId, setFloorId] = useState('');
  const [allocationMode, setAllocationMode] = useState('single'); // 'single' | 'split'
  const [allocMap, setAllocMap] = useState({}); // { [floorId]: string bags }
  const [floorStockData, setFloorStockData] = useState(null);
  const [loadingFloorStock, setLoadingFloorStock] = useState(false);

  useEffect(() => {
    if (!initialVarieties || initialVarieties.length === 0) {
      getVarieties().then(res => {
        const vList = res.results || res.data || res || [];
        setVarieties(Array.isArray(vList) ? vList : []);
      }).catch(console.error);
    }
    getPlaces().then(res => {
      const pList = res.results || res.data || res || [];
      setPlaces(Array.isArray(pList) ? pList : []);
    }).catch(console.error);
    getFloors().then(res => {
      const fList = res.results || res.data || res || [];
      setFloors(Array.isArray(fList) ? fList : []);
    }).catch(console.error);
  }, [initialVarieties]);

  useEffect(() => {
    if (varietyId && fromPlaceId === '') {
      setLoadingFloorStock(true);
      getFloorStock(varietyId)
        .then(res => setFloorStockData(res))
        .catch(console.error)
        .finally(() => setLoadingFloorStock(false));
    } else {
      setFloorStockData(null);
    }
  }, [varietyId, fromPlaceId]);

  useEffect(() => {
    if (editItem && editItem.id) {
      setDate(editItem.date || defaultDate || new Date().toISOString().split('T')[0]);
      setInvoiceNo(editItem.invoice_no || '');
      setVarietyId(editItem.variety ? String(editItem.variety) : '');
      setBags(editItem.bags ? String(editItem.bags) : '');
      setFromPlaceId(editItem.from_place ? String(editItem.from_place) : '');
      setToPlaceId(editItem.to_place ? String(editItem.to_place) : '');
      setRemarks(editItem.remarks || '');

      if (editItem.floor_allocations && Array.isArray(editItem.floor_allocations) && editItem.floor_allocations.length > 0) {
        const map = {};
        editItem.floor_allocations.forEach(item => {
          if (item.floor_id) {
            map[item.floor_id] = String(item.bags || '');
          }
        });
        setAllocMap(map);
        if (editItem.floor_allocations.length > 1) {
          setAllocationMode('split');
          setFloorId('');
        } else {
          setAllocationMode('single');
          setFloorId(String(editItem.floor_allocations[0].floor_id || ''));
        }
      } else if (editItem.floor) {
        setFloorId(String(editItem.floor));
        setAllocationMode('single');
        setAllocMap({});
      } else {
        setFloorId('');
        setAllocationMode('single');
        setAllocMap({});
      }
    } else {
      const datePart = (defaultDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      setInvoiceNo(`TRF-${datePart}-${randomSuffix}`);
      setDate(defaultDate || new Date().toISOString().split('T')[0]);
      setVarietyId('');
      setBags('');
      setFromPlaceId('');
      setToPlaceId('');
      setRemarks('');
      setFloorId('');
      setAllocationMode('single');
      setAllocMap({});
    }
  }, [editItem, defaultDate]);

  const selectedVariety = varieties.find(v => String(v.id) === String(varietyId));
  const availableBags = selectedVariety ? Number(selectedVariety.current_stock_bags || 0) : 0;
  const numBags = Number(bags) || 0;

  // Split calculations
  const allocSum = floors.reduce((sum, f) => sum + (Number(allocMap[f.id]) || 0), 0);
  const remainingToAlloc = numBags - allocSum;

  const handleFillMaxTransfer = (floorIdToFill, availableFloorBags) => {
    const otherSum = floors.reduce((sum, f) => {
      if (String(f.id) === String(floorIdToFill)) return sum;
      return sum + (Number(allocMap[f.id]) || 0);
    }, 0);
    const remainingNeeded = Math.max(0, numBags - otherSum);
    const fillAmount = Math.min(Math.max(0, availableFloorBags), remainingNeeded);
    setAllocMap(prev => ({ ...prev, [floorIdToFill]: String(fillAmount) }));
  };

  const isSubmittingRef = useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    if (!invoiceNo.trim()) {
      setError('Please enter a Bill / Transfer Number');
      return;
    }
    if (!varietyId) {
      setError('Please select a Variety');
      return;
    }
    if (!toPlaceId) {
      setError('Please select destination mill (To Mill)');
      return;
    }
    if (String(fromPlaceId) === String(toPlaceId) && fromPlaceId !== '') {
      setError('Origin (From Mill) and Destination (To Mill) cannot be the same!');
      return;
    }
    if (!numBags || numBags <= 0) {
      setError('Please enter valid number of bags to transfer');
      return;
    }

    // Floor validation when transferring from Mother India Mill
    let payloadFloor = null;
    let payloadAllocations = [];

    if (fromPlaceId === '') {
      if (allocationMode === 'split') {
        if (allocSum !== numBags) {
          setError(`Floor split allocation sum (${allocSum} bags) must exactly match total transfer bags (${numBags} bags)!`);
          return;
        }
        for (const f of floors) {
          const allocBags = Number(allocMap[f.id]) || 0;
          if (allocBags > 0) {
            const flStock = floorStockData?.floors?.find(x => x.floor_id === f.id);
            const avail = flStock ? flStock.bags : 0;
            if (allocBags > avail) {
              setError(`Floor '${f.name}' only has ${avail} bags available for '${selectedVariety?.name}', cannot transfer ${allocBags} bags!`);
              return;
            }
          }
        }
        const activeAllocs = floors
          .filter(f => (Number(allocMap[f.id]) || 0) > 0)
          .map(f => ({
            floor_id: f.id,
            floor_name: f.name,
            bags: Number(allocMap[f.id])
          }));
        payloadAllocations = activeAllocs;
        payloadFloor = activeAllocs.length === 1 ? activeAllocs[0].floor_id : (activeAllocs[0]?.floor_id || null);
      } else {
        if (floorId) {
          const flStock = floorStockData?.floors?.find(x => x.floor_id === parseInt(floorId, 10));
          const avail = flStock ? flStock.bags : 0;
          if (numBags > avail) {
            setError(`Selected floor only has ${avail} bags available. Please choose another floor or switch to 'Split Across Multiple Floors' to transfer ${numBags} bags.`);
            return;
          }
          const flObj = floors.find(f => String(f.id) === String(floorId));
          payloadFloor = parseInt(floorId, 10);
          payloadAllocations = [{
            floor_id: parseInt(floorId, 10),
            floor_name: flObj ? flObj.name : `Floor #${floorId}`,
            bags: numBags
          }];
        } else {
          payloadFloor = null;
          payloadAllocations = [];
        }
      }
    }

    try {
      setLoading(true);
      setError('');
      isSubmittingRef.current = true;

      const fromPlaceObj = places.find(p => String(p.id) === String(fromPlaceId));
      const toPlaceObj = places.find(p => String(p.id) === String(toPlaceId));

      const payload = {
        invoice_no: invoiceNo.trim(),
        date,
        variety: Number(varietyId),
        bags: numBags,
        is_transfer: true,
        from_place: fromPlaceId ? Number(fromPlaceId) : null,
        from_place_name: fromPlaceObj ? fromPlaceObj.name : 'Mother India',
        to_place: Number(toPlaceId),
        floor: payloadFloor,
        floor_allocations: payloadAllocations,
        remarks: remarks.trim(),
        rate: 0,
      };

      const savedUser = (() => { try { return JSON.parse(localStorage.getItem('mother_india_user') || '{}'); } catch(e){ return {}; } })();
      const isOwner = user?.role === 'OWNER' || savedUser?.role === 'OWNER';
      const isEditing = Boolean(editItem && editItem.id);

      if (isEditing) {
        if (isOwner) {
          await updateOutward(editItem.id, payload);
          if (showToast) showToast('Mill transfer updated successfully!');
        } else {
          await createApprovalRequest({
            action_type: 'EDIT',
            target_model: 'OUTWARD',
            target_id: editItem.id,
            proposed_data: payload
          });
          if (showToast) showToast('Transfer edit request submitted for Owner approval!');
        }
      } else {
        await createOutward(payload);
        if (showToast) showToast(`Successfully transferred ${numBags.toLocaleString()} bags to ${toPlaceObj?.name || 'outside mill'}!`);
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to record mill transfer');
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '640px' }}>
        <div className="modal-hdr">
          <div className="modal-title" style={{ color: '#2563eb' }}>
            <i className="fas fa-industry"></i> {editItem?.id ? 'Edit Mill Transfer' : 'New Mill Transfer Entry'}
          </div>
          <button className="modal-close" onClick={onClose} disabled={loading}>&times;</button>
        </div>

        {error && (
          <div className="alert-item alert-low" style={{ marginBottom: '1rem' }}>
            <i className="fas fa-exclamation-triangle"></i> {error}
          </div>
        )}

        {/* Transfer context notice */}
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.65rem 0.95rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <i className="fas fa-truck-moving" style={{ color: '#2563eb', fontSize: '1.1rem' }}></i>
          <div>
            <div style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 700 }}>
              Inter-Mill Transfer
            </div>
            <div style={{ fontSize: '0.72rem', color: '#3b82f6' }}>
              Transfer stock between Mother India Mill and outside mill locations without customer sales pricing.
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid" style={{ marginBottom: '1rem' }}>
            {/* Bill / Transfer No */}
            <div className="form-group">
              <label>Bill / Transfer No *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. TRF-1024"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {/* Date */}
            <div className="form-group">
              <label>Date *</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {/* Origin Mill (From) */}
            <div className="form-group">
              <label>From Mill (Origin) *</label>
              <SearchableSelect
                options={[
                  { id: '', name: 'Mother India (Our Main Mill)' },
                  ...places.map(p => ({ id: p.id, name: p.name }))
                ]}
                value={fromPlaceId}
                onChange={(val) => {
                  setFromPlaceId(val);
                  if (val !== '') {
                    setFloorId('');
                    setAllocationMode('single');
                    setAllocMap({});
                  }
                }}
                placeholder="Select Origin Mill..."
              />
            </div>

            {/* Destination Mill (To) */}
            <div className="form-group">
              <label>To Mill (Destination) *</label>
              <SearchableSelect
                options={places
                  .filter(p => String(p.id) !== String(fromPlaceId))
                  .map(p => ({ id: p.id, name: p.name }))}
                value={toPlaceId}
                onChange={setToPlaceId}
                placeholder="Select Destination Mill..."
                required={true}
              />
            </div>

            {/* Variety */}
            <div className="form-group">
              <label>Variety *</label>
              <SearchableSelect
                options={varieties.map(v => ({
                  id: v.id,
                  name: `${v.name} (${Number(v.kgs_per_bag || 0).toFixed(0)}k) [Stock: ${formatBags(v.current_stock_bags || 0)}]`
                }))}
                value={varietyId}
                onChange={setVarietyId}
                placeholder="Search & Select Variety..."
                required={true}
              />
              {selectedVariety && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                  Available stock: <strong style={{ color: availableBags > 0 ? '#15803d' : '#dc2626' }}>{formatBags(availableBags)} bags</strong>
                </div>
              )}
            </div>

            {/* Bags */}
            <div className="form-group">
              <label>Bags to Transfer *</label>
              <input
                type="number"
                min="1"
                className="input"
                placeholder="Enter bags count"
                value={bags}
                onChange={(e) => setBags(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          {/* Source Floor Selection (When transferring from Mother India Main Mill) */}
          {fromPlaceId === '' && (
            <div style={{ marginBottom: '1rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <i className="fas fa-layer-group"></i> Mother India Godown Floor (Source)
                </span>
                <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '6px', padding: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setAllocationMode('single')}
                    style={{
                      border: 'none',
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: allocationMode === 'single' ? '#2563eb' : 'transparent',
                      color: allocationMode === 'single' ? '#ffffff' : '#475569'
                    }}
                  >
                    Single Floor
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllocationMode('split')}
                    style={{
                      border: 'none',
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background: allocationMode === 'split' ? '#2563eb' : 'transparent',
                      color: allocationMode === 'split' ? '#ffffff' : '#475569'
                    }}
                  >
                    Split Floors
                  </button>
                </div>
              </div>

              {allocationMode === 'single' ? (
                <div>
                  <SearchableSelect 
                    options={[{ id: '', name: 'Unassigned / Any Floor' }, ...floors.map(f => {
                      const flStock = floorStockData?.floors?.find(x => x.floor_id === f.id);
                      const bCount = flStock ? flStock.bags : 0;
                      return { id: f.id, name: `${f.name} (${bCount.toLocaleString()} bags available)` };
                    })]}
                    value={floorId}
                    onChange={setFloorId}
                    placeholder="Select Source Floor..."
                  />

                  {selectedVariety && floorStockData && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                        Available Stock on Floors (Click to select):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {floorStockData.floors && floorStockData.floors.length > 0 ? (
                          floorStockData.floors.map(f => {
                            const isSelected = String(floorId) === String(f.floor_id);
                            return (
                              <div 
                                key={f.floor_id || 'unassigned'}
                                onClick={() => f.floor_id && setFloorId(String(f.floor_id))}
                                style={{
                                  cursor: f.floor_id ? 'pointer' : 'default',
                                  background: isSelected ? '#eff6ff' : '#ffffff',
                                  border: isSelected ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                  padding: '3px 8px',
                                  fontSize: '0.72rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px'
                                }}
                                title={f.floor_id ? `Click to choose ${f.floor_name}` : ""}
                              >
                                <span style={{ fontWeight: 600, color: '#334155' }}>{f.floor_name}:</span>
                                <strong style={{ color: f.bags > 0 ? '#15803d' : '#dc2626' }}>{f.bags.toLocaleString()} Bags</strong>
                                {isSelected && <i className="fas fa-check-circle" style={{ color: '#2563eb' }}></i>}
                              </div>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>No floor stock recorded yet.</div>
                        )}
                      </div>

                      {/* Warning if selected floor has less bags than requested */}
                      {(() => {
                        if (!floorId || numBags <= 0) return null;
                        const curFloorStock = floorStockData.floors?.find(x => String(x.floor_id) === String(floorId));
                        const avail = curFloorStock ? curFloorStock.bags : 0;
                        if (numBags > avail) {
                          return (
                            <div style={{ marginTop: '0.4rem', padding: '6px 8px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '0.73rem', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <span>
                                ⚠️ Selected floor only has <strong>{avail.toLocaleString()}</strong> bags (need <strong>{numBags.toLocaleString()}</strong>).
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAllocationMode('split');
                                  handleFillMaxTransfer(floorId, avail);
                                }}
                                style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
                              >
                                Switch to Split
                              </button>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                /* Split Across Multiple Floors */
                <div>
                  <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', background: '#ffffff', borderRadius: '6px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Floor Name</th>
                        <th style={{ padding: '6px 8px' }}>Available Stock</th>
                        <th style={{ padding: '6px 8px', width: '130px' }}>Transfer Bags</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', width: '80px' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {floors.map(f => {
                        const curFloorData = floorStockData?.floors?.find(x => x.floor_id === f.id);
                        const availBags = curFloorData ? curFloorData.bags : 0;
                        const val = allocMap[f.id] || '';
                        const numVal = Number(val) || 0;
                        const isOver = numVal > availBags;
                        return (
                          <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9', background: isOver ? '#fef2f2' : 'transparent' }}>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{f.name}</td>
                            <td style={{ padding: '6px 8px', color: availBags > 0 ? '#15803d' : '#94a3b8', fontWeight: availBags > 0 ? 600 : 400 }}>
                              {availBags.toLocaleString()} bags
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              <input 
                                type="number"
                                className="input"
                                style={{ padding: '4px 6px', fontSize: '0.75rem', height: '28px', borderColor: isOver ? '#dc2626' : undefined }}
                                value={val}
                                onChange={e => {
                                  const v = e.target.value;
                                  setAllocMap(prev => ({ ...prev, [f.id]: v }));
                                }}
                                min="0"
                                max={availBags}
                                placeholder="0"
                              />
                              {isOver && (
                                <div style={{ color: '#dc2626', fontSize: '0.68rem', fontWeight: 700, marginTop: '2px' }}>
                                  Exceeds ({availBags} max)!
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleFillMaxTransfer(f.id, availBags)}
                                disabled={availBags <= 0}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  cursor: availBags > 0 ? 'pointer' : 'not-allowed',
                                  color: '#0f172a',
                                  opacity: availBags > 0 ? 1 : 0.5
                                }}
                                title="Fill max available for this floor"
                              >
                                Fill Max
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Allocation summary */}
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.75rem' }}>
                    <div style={{ fontWeight: 700, color: '#334155' }}>
                      Allocated: <strong>{allocSum}</strong> / Required: <strong>{numBags}</strong> Bags
                    </div>
                    {numBags > 0 && (
                      <div>
                        {allocSum === numBags ? (
                          <span style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fas fa-check-circle"></i> Exactly Matched ({numBags} Bags)
                          </span>
                        ) : allocSum < numBags ? (
                          <span style={{ color: '#d97706', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fas fa-info-circle"></i> Need {remainingToAlloc} more bags
                          </span>
                        ) : (
                          <span style={{ color: '#dc2626', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <i className="fas fa-exclamation-circle"></i> Exceeds by {allocSum - numBags} bags!
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Remarks / Vehicle details */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label>Remarks / Vehicle & Transport Details</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Vehicle KA-36-A-1234, Driver Ramesh, Transport challan #45"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Modal Actions */}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-blue"
              disabled={loading}
              style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              <i className={loading ? "fas fa-spinner fa-spin" : "fas fa-paper-plane"} style={{ marginRight: '6px' }}></i>
              {loading ? 'Submitting...' : (editItem?.id ? 'Update Transfer' : 'Submit Mill Transfer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MillTransferModal;
