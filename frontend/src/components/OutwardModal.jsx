import React, { useState, useEffect } from 'react';
import { createOutward, updateOutward, createApprovalRequest, getParties, getVarieties, getPlaces, getFloors, getFloorStock } from '../api';
import { formatINR } from '../utils/formatters';
import SearchableSelect from './SearchableSelect';

const OutwardModal = ({ onClose, onSaved, parties: initialParties, varieties: initialVarieties, showToast, editItem, user }) => {
  const [parties, setParties] = useState(initialParties || []);
  const [varieties, setVarieties] = useState(initialVarieties || []);
  const [places, setPlaces] = useState([]);
  const [floors, setFloors] = useState([]);
  const [floorId, setFloorId] = useState('');
  const [allocationMode, setAllocationMode] = useState('single'); // 'single' | 'split'
  const [allocMap, setAllocMap] = useState({}); // { [floorId]: string bags }
  const [floorStockData, setFloorStockData] = useState(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [partyId, setPartyId] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [bags, setBags] = useState('');
  const [rate, setRate] = useState('');
  const [lfOn, setLfOn] = useState(false);
  const [lfAmount, setLfAmount] = useState('');
  const [isTransfer, setIsTransfer] = useState(false);
  
  // Stock origin type: 'mill' (Mother India) or 'branch' (From Branch/Place Stock)
  const [stockOriginType, setStockOriginType] = useState('mill');
  const [fromPlaceId, setFromPlaceId] = useState('');
  const [fromPlaceName, setFromPlaceName] = useState('Mother India');
  const [toPlaceId, setToPlaceId] = useState('');
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initialParties || initialParties.length === 0) {
      getParties().then(res => setParties(res.results || res.data || res)).catch(console.error);
    }
    if (!initialVarieties || initialVarieties.length === 0) {
      getVarieties().then(res => setVarieties(res.results || res.data || res)).catch(console.error);
    }
    getPlaces().then(res => setPlaces(res.results || res.data || res)).catch(console.error);
    getFloors().then(res => setFloors(res.results || res.data || res)).catch(console.error);
  }, [initialParties, initialVarieties]);

  useEffect(() => {
    if (varietyId) {
      getFloorStock(varietyId).then(res => setFloorStockData(res)).catch(console.error);
    } else {
      setFloorStockData(null);
    }
  }, [varietyId]);

  useEffect(() => {
    if (editItem) {
      setInvoiceNo(editItem.invoice_no || '');
      setDate(editItem.date || '');
      setPartyId(editItem.party ? String(editItem.party) : '');
      setVarietyId(editItem.variety ? String(editItem.variety) : '');
      setBags(editItem.bags || '');
      setRate(editItem.rate || '');
      setLfOn(editItem.lf_toggle || false);
      setLfAmount(editItem.lf_amount || '');
      setIsTransfer(editItem.is_transfer || false);
      
      if (editItem.from_place) {
        setStockOriginType('branch');
        setFromPlaceId(String(editItem.from_place));
        setFromPlaceName(editItem.from_place_name || '');
      } else {
        setStockOriginType('mill');
        setFromPlaceId('');
        setFromPlaceName(editItem.from_place_name || 'Mother India');
      }
      
      setToPlaceId(editItem.to_place ? String(editItem.to_place) : '');

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
    }
  }, [editItem]);

  const selectedVariety = varieties.find(v => String(v.id) === String(varietyId));
  const perBagWeight = selectedVariety ? Number(selectedVariety.kgs_per_bag) : 0;

  const numBags = Number(bags) || 0;
  const numRate = Number(rate) || 0;
  const numLfAmount = lfOn ? (Number(lfAmount) || 0) : 0;

  const totalRateVal = numBags * numRate;
  const totalWeightKgs = numBags * perBagWeight;
  const netTotalVal = totalRateVal + numLfAmount;
  const perBagCostVal = numBags > 0 ? (netTotalVal / numBags) : 0;

  // Split calculations
  const allocSum = floors.reduce((sum, f) => sum + (Number(allocMap[f.id]) || 0), 0);
  const remainingToAlloc = numBags - allocSum;

  const handleFillMaxOutward = (floorIdToFill, availableBags) => {
    const otherSum = floors.reduce((sum, f) => {
      if (String(f.id) === String(floorIdToFill)) return sum;
      return sum + (Number(allocMap[f.id]) || 0);
    }, 0);
    const remainingNeeded = Math.max(0, numBags - otherSum);
    const fillAmount = Math.min(Math.max(0, availableBags), remainingNeeded);
    setAllocMap(prev => ({ ...prev, [floorIdToFill]: String(fillAmount) }));
  };

  const isSubmittingRef = React.useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    if (!invoiceNo.trim() || !partyId || !varietyId || !bags || !rate) {
      setError('Please fill all required fields');
      return;
    }
    if (isTransfer && !toPlaceId) {
      setError('Please select a Mill Transfer Location for the transfer');
      return;
    }
    if (!isTransfer && stockOriginType === 'branch' && !fromPlaceId) {
      setError('Please select which outside mill location to sell from');
      return;
    }

    const isTakingFromMill = isTransfer || stockOriginType === 'mill';
    let payloadFloor = null;
    let payloadAllocations = [];

    if (isTakingFromMill) {
      if (allocationMode === 'split') {
        if (allocSum !== numBags) {
          setError(`Total allocated floor bags (${allocSum}) must exactly equal total outward bags (${numBags})!`);
          return;
        }
        for (const f of floors) {
          const allocBags = Number(allocMap[f.id]) || 0;
          if (allocBags > 0) {
            const flStock = floorStockData?.floors?.find(x => x.floor_id === f.id);
            const avail = flStock ? flStock.bags : 0;
            if (allocBags > avail) {
              setError(`Floor '${f.name}' only has ${avail} bags available for '${selectedVariety?.name}', cannot outward ${allocBags} bags!`);
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
            setError(`Selected floor only has ${avail} bags available. Please choose another floor or switch to 'Split Across Multiple Floors' to outward ${numBags} bags.`);
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
      isSubmittingRef.current = true;
      setLoading(true);
      setError('');
      
      let resolvedFromPlaceId = null;
      let resolvedFromPlaceName = 'Mother India';

      if (isTransfer) {
        resolvedFromPlaceName = fromPlaceName || 'Mother India';
      } else if (stockOriginType === 'branch') {
        resolvedFromPlaceId = fromPlaceId || null;
        const matched = places.find(p => String(p.id) === String(fromPlaceId));
        resolvedFromPlaceName = matched ? matched.name : (fromPlaceName || 'Branch');
      } else {
        resolvedFromPlaceId = null;
        resolvedFromPlaceName = 'Mother India';
      }

      const payload = {
        invoice_no: invoiceNo.trim(),
        date,
        party: partyId,
        variety: varietyId,
        floor: payloadFloor,
        floor_allocations: payloadAllocations,
        bags: numBags,
        rate: numRate,
        lf_toggle: lfOn,
        lf_amount: numLfAmount,
        is_transfer: isTransfer,
        from_place: resolvedFromPlaceId,
        from_place_name: resolvedFromPlaceName,
        to_place: isTransfer ? toPlaceId : null
      };

      const savedUser = (() => { try { return JSON.parse(localStorage.getItem('mother_india_user') || '{}'); } catch(e){ return {}; } })();
      const isOwner = user?.role === 'OWNER' || savedUser?.role === 'OWNER';

      if (editItem) {
        if (isOwner) {
          await updateOutward(editItem.id, payload);
          if (showToast) showToast('Outward entry updated successfully!');
        } else {
          await createApprovalRequest({
            action_type: 'EDIT',
            target_model: 'OUTWARD',
            target_id: editItem.id,
            proposed_data: payload
          });
          if (showToast) showToast('Edit request submitted for Owner approval!');
        }
      } else {
        await createOutward(payload);
        if (showToast) showToast(isTransfer ? 'Mill Transfer outward entry created!' : 'Outward sale recorded successfully!');
      }
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save outward entry');
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const renderFloorAllocationSection = () => (
    <div style={{ marginTop: '0.65rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.4rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#1e40af', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <i className="fas fa-layer-group"></i> Mother India Godown Floor Allocation
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
            Split Across Multiple Floors
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
                        ⚠️ Selected floor only has <strong>{avail.toLocaleString()}</strong> bags available (you need <strong>{numBags.toLocaleString()}</strong> bags).
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAllocationMode('split');
                          handleFillMaxOutward(floorId, avail);
                        }}
                        style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Switch to Split Allocation
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
                <th style={{ padding: '6px 8px', width: '130px' }}>Outward Bags</th>
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
                        onClick={() => handleFillMaxOutward(f.id, availBags)}
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
  );

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '640px' }}>
        <div className="modal-hdr">
          <div className="modal-title" style={{ color: '#2563eb' }}>
            <i className="fas fa-minus-circle"></i> {editItem ? 'Edit Outward Entry' : 'New Outward Entry'}
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        
        {error && (
          <div className="alert-item alert-low" style={{ marginBottom: '1rem' }}>
            <i className="fas fa-exclamation-triangle"></i> {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="form-grid" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label>Bill / Invoice No</label>
              <input 
                type="text" 
                className="input" 
                value={invoiceNo} 
                onChange={e => setInvoiceNo(e.target.value)} 
                required 
                placeholder="e.g. OUT-5012" 
              />
            </div>

            <div className="form-group">
              <label>Date</label>
              <input 
                type="date" 
                className="input" 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Customer / Party</label>
              <SearchableSelect 
                options={parties.map(p => ({ id: p.id, name: `${p.name} ${p.shortcut_name ? `(${p.shortcut_name})` : ''}` }))}
                value={partyId}
                onChange={setPartyId}
                placeholder="Search & Select Party..."
                required={true}
              />
            </div>
            
            <div className="form-group">
              <label>Variety</label>
              <SearchableSelect 
                options={varieties.map(v => ({ id: v.id, name: `${v.name} (${v.kgs_per_bag} kg)` }))}
                value={varietyId}
                onChange={setVarietyId}
                placeholder="Search & Select Variety..."
                required={true}
              />
            </div>
            
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Number of Bags</label>
                {selectedVariety && (
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: (selectedVariety.current_stock_bags || 0) > 0 ? '#059669' : '#dc2626' }}>
                    Stock: {Number(selectedVariety.current_stock_bags || 0).toLocaleString()} bags
                  </span>
                )}
              </div>
              <input 
                type="number" 
                className="input" 
                value={bags} 
                onChange={e => setBags(e.target.value)} 
                min="1" 
                required 
                placeholder="0" 
              />
              {selectedVariety && numBags > Number(selectedVariety.current_stock_bags || 0) && (
                <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 700, marginTop: '2px' }}>
                  ⚠️ Exceeds available stock ({Number(selectedVariety.current_stock_bags || 0).toLocaleString()} bags available)!
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Bag Weight</label>
              <input 
                type="text" 
                className="input" 
                value={perBagWeight > 0 ? `${perBagWeight} kg` : '-'} 
                readOnly 
                style={{ background: '#f8fafc', fontWeight: 600, color: '#334155' }} 
              />
            </div>

            <div className="form-group">
              <label>Total Weight</label>
              <input 
                type="text" 
                className="input" 
                value={totalWeightKgs > 0 ? `${totalWeightKgs.toLocaleString()} kg` : '0 kg'} 
                readOnly 
                style={{ background: '#f8fafc', fontWeight: 700, color: '#2563eb' }} 
              />
            </div>
            
            <div className="form-group">
              <label>Rate per Bag (₹)</label>
              <input 
                type="number" 
                className="input" 
                step="0.01" 
                value={rate} 
                onChange={e => setRate(e.target.value)} 
                min="0" 
                required 
                placeholder="0.00" 
              />
            </div>
          </div>

          {/* Transfer & Location & LF Handling Options */}
          <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.85rem' }}>
              <div className="toggle-row">
                <label className="toggle">
                  <input type="checkbox" checked={isTransfer} onChange={e => setIsTransfer(e.target.checked)} />
                  <span className="toggle-slider"></span>
                </label>
                <span style={{ fontWeight: 700, color: isTransfer ? '#2563eb' : '#334155' }}>
                  <i className="fas fa-truck-moving" style={{ marginRight: '4px' }}></i> Mill Transfer (To Outside Mill)
                </span>
              </div>

              <div className="toggle-row">
                <label className="toggle">
                  <input type="checkbox" checked={lfOn} onChange={e => setLfOn(e.target.checked)} />
                  <span className="toggle-slider"></span>
                </label>
                <span style={{ fontWeight: 600, color: '#334155' }}>Enable LF Charge</span>
              </div>
            </div>

            {/* If Mill Transfer: From & To Places */}
            {isTransfer ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.85rem', background: '#eff6ff', padding: '0.85rem', borderRadius: '8px', border: '1px solid #bfdbfe', marginBottom: lfOn ? '0.85rem' : 0 }}>
                <div className="form-group">
                  <label style={{ color: '#1e40af', fontWeight: 700 }}>From Mill</label>
                  <input 
                    type="text" 
                    className="input" 
                    value={fromPlaceName} 
                    onChange={e => setFromPlaceName(e.target.value)} 
                    placeholder="Mother India" 
                  />
                </div>
                <div className="form-group">
                  <label style={{ color: '#1e40af', fontWeight: 700 }}>
                    <i className="fas fa-industry" style={{ marginRight: '4px' }}></i> Mill Transfer Location (Outside Mill)
                  </label>
                  <SearchableSelect 
                    options={places}
                    value={toPlaceId}
                    onChange={setToPlaceId}
                    placeholder="Search & Select Mill Transfer Location..."
                    required={isTransfer}
                  />
                  <div style={{ fontSize: '0.72rem', color: '#1e40af', marginTop: '3px', fontWeight: 600 }}>
                    <i className="fas fa-info-circle"></i> Stock transferred here will show under "Other Mills' Stock".
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  {renderFloorAllocationSection()}
                </div>
              </div>
            ) : (
              /* If Direct Sale / Location Sale: Radio Button for Stock Source */
              <div style={{ background: '#f1f5f9', padding: '0.75rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: lfOn ? '0.85rem' : 0 }}>
                <label style={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'block' }}>
                  <i className="fas fa-location-dot" style={{ color: '#2563eb', marginRight: '4px' }}></i> Outward Stock Origin / Sold From
                </label>
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: stockOriginType === 'branch' ? '0.65rem' : 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600, color: stockOriginType === 'mill' ? '#2563eb' : '#475569' }}>
                    <input 
                      type="radio" 
                      name="stockOrigin" 
                      checked={stockOriginType === 'mill'} 
                      onChange={() => {
                        setStockOriginType('mill');
                        setFromPlaceId('');
                        setFromPlaceName('Mother India');
                      }} 
                    />
                    <span>Mother India (Main Mill)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.86rem', fontWeight: 600, color: stockOriginType === 'branch' ? '#2563eb' : '#475569' }}>
                    <input 
                      type="radio" 
                      name="stockOrigin" 
                      checked={stockOriginType === 'branch'} 
                      onChange={() => {
                        setStockOriginType('branch');
                      }} 
                    />
                    <span>Sold From Outside Mill Stock</span>
                  </label>
                </div>

                {stockOriginType === 'mill' && (
                  renderFloorAllocationSection()
                )}

                {stockOriginType === 'branch' && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <SearchableSelect 
                      options={places}
                      value={fromPlaceId}
                      onChange={(pId, pName) => {
                        setFromPlaceId(pId);
                        setFromPlaceName(pName);
                      }}
                      placeholder="Search & Select Outside Mill Location..."
                      required={stockOriginType === 'branch'}
                    />
                  </div>
                )}
              </div>
            )}

            {lfOn && (
              <div style={{ marginTop: '0.85rem' }}>
                <div className="form-group">
                  <label style={{ color: '#2563eb' }}>Total LF Amount (₹)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="input" 
                    value={lfAmount} 
                    onChange={e => setLfAmount(e.target.value)} 
                    placeholder="0.00" 
                    required={lfOn} 
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.85rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.65rem 0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', minWidth: 0 }}>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>COST PER BAG</span>
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>{formatINR(perBagCostVal)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.65rem 0.85rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', minWidth: 0 }}>
              <span style={{ fontSize: '0.72rem', color: '#1e40af', fontWeight: 700 }}>GRAND TOTAL</span>
              <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1d4ed8' }}>{formatINR(netTotalVal)}</span>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
            <button 
              type="submit" 
              className="btn btn-blue" 
              disabled={loading}
              style={{ cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.75 : 1 }}
            >
              <i className={loading ? "fas fa-spinner fa-spin" : "fas fa-paper-plane"} style={{ marginRight: '6px' }}></i> 
              {loading ? 'Submitting...' : (editItem ? 'Update Outward Entry' : 'Submit Outward Entry')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OutwardModal;
