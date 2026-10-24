import React, { useState, useEffect, useRef } from 'react';
import { getVarieties, getPlaces, createOutward, updateOutward, createApprovalRequest } from '../api';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [date, setDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [bags, setBags] = useState('');
  const [fromPlaceId, setFromPlaceId] = useState(''); // '' = Mother India Main Mill
  const [toPlaceId, setToPlaceId] = useState('');
  const [remarks, setRemarks] = useState('');

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
  }, [initialVarieties]);

  useEffect(() => {
    if (editItem && editItem.id) {
      setDate(editItem.date || defaultDate || new Date().toISOString().split('T')[0]);
      setInvoiceNo(editItem.invoice_no || '');
      setVarietyId(editItem.variety ? String(editItem.variety) : '');
      setBags(editItem.bags ? String(editItem.bags) : '');
      setFromPlaceId(editItem.from_place ? String(editItem.from_place) : '');
      setToPlaceId(editItem.to_place ? String(editItem.to_place) : '');
      setRemarks(editItem.remarks || '');
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
    }
  }, [editItem, defaultDate]);

  const selectedVariety = varieties.find(v => String(v.id) === String(varietyId));
  const availableBags = selectedVariety ? Number(selectedVariety.current_stock_bags || 0) : 0;
  const numBags = Number(bags) || 0;

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
              Transfer stock between Mother India Mill and outside mill locations without sales pricing or customer billing.
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
                onChange={setFromPlaceId}
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
