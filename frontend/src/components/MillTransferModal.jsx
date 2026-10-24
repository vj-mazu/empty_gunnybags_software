import React, { useState, useEffect, useRef } from 'react';
import { getVarieties, getPlaces, createOutward, updateOutward, createApprovalRequest } from '../api';

const MillTransferModal = ({ isOpen, onClose, onSaved, editItem = null, user = null, showToast = null, defaultDate = '' }) => {
  if (!isOpen) return null;

  const [varieties, setVarieties] = useState([]);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [date, setDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [bags, setBags] = useState('');
  const [fromPlaceId, setFromPlaceId] = useState(''); // '' means Mother India Mill
  const [toPlaceId, setToPlaceId] = useState('');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    Promise.all([getVarieties(), getPlaces()]).then(([varsRes, placesRes]) => {
      const vList = varsRes.results || varsRes.data || varsRes || [];
      const pList = placesRes.results || placesRes.data || placesRes || [];
      setVarieties(Array.isArray(vList) ? vList : []);
      setPlaces(Array.isArray(pList) ? pList : []);
    }).catch(err => {
      console.error('Failed to load transfer metadata', err);
    });
  }, []);

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
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '580px', width: '92%' }}>
        <div className="modal-header" style={{ borderBottom: '2px solid #2563eb', paddingBottom: '0.85rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e40af', margin: 0, fontSize: '1.2rem' }}>
            <i className="fas fa-industry"></i>
            {editItem?.id ? 'Edit Mill Transfer' : 'New Mill Transfer Entry'}
          </h2>
          <button type="button" className="close-btn" onClick={onClose} disabled={loading}>&times;</button>
        </div>

        {error && (
          <div className="alert-error" style={{ margin: '0.85rem 0', padding: '0.65rem 1rem', borderRadius: '6px' }}>
            <i className="fas fa-triangle-exclamation" style={{ marginRight: '6px' }}></i>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
          {/* Transfer Context Banner */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.15rem' }}>
            <div style={{ fontSize: '0.78rem', color: '#1e40af', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <i className="fas fa-info-circle"></i> Inter-Mill Stock Transfer
            </div>
            <div style={{ fontSize: '0.74rem', color: '#3b82f6', marginTop: '2px' }}>
              Transfers move physical gunny bags between mill locations. No customer sale or rates required.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            {/* Date */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-calendar-day" style={{ color: '#2563eb', marginRight: '4px' }}></i> Date *
              </label>
              <input
                type="date"
                className="form-control"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {/* Bill / Transfer Number */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-file-invoice" style={{ color: '#2563eb', marginRight: '4px' }}></i> Bill / Transfer No *
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. TRF-1024"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            {/* Origin Mill (From) */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-warehouse" style={{ color: '#059669', marginRight: '4px' }}></i> From Mill (Origin) *
              </label>
              <select
                className="form-control"
                value={fromPlaceId}
                onChange={(e) => setFromPlaceId(e.target.value)}
                disabled={loading}
              >
                <option value="">Mother India (Our Main Mill)</option>
                {places.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Destination Mill (To) */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-truck-moving" style={{ color: '#2563eb', marginRight: '4px' }}></i> To Mill (Destination) *
              </label>
              <select
                className="form-control"
                value={toPlaceId}
                onChange={(e) => setToPlaceId(e.target.value)}
                required
                disabled={loading}
              >
                <option value="">-- Select Destination Mill --</option>
                {places.filter(p => String(p.id) !== String(fromPlaceId)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            {/* Variety */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-wheat-awn" style={{ color: '#2563eb', marginRight: '4px' }}></i> Variety *
              </label>
              <select
                className="form-control"
                value={varietyId}
                onChange={(e) => setVarietyId(e.target.value)}
                required
                disabled={loading}
              >
                <option value="">-- Select Variety --</option>
                {varieties.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.kgs_per_bag}kg) [Stock: {v.current_stock_bags || 0}]
                  </option>
                ))}
              </select>
            </div>

            {/* Bags */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                <i className="fas fa-box" style={{ color: '#2563eb', marginRight: '4px' }}></i> Bags to Transfer *
              </label>
              <input
                type="number"
                min="1"
                className="form-control"
                placeholder="Enter bags count"
                value={bags}
                onChange={(e) => setBags(e.target.value)}
                required
                disabled={loading}
              />
              {selectedVariety && (
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px' }}>
                  Total stock: <strong style={{ color: availableBags > 0 ? '#059669' : '#dc2626' }}>{availableBags.toLocaleString()} bags</strong>
                </div>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label style={{ fontWeight: 700, fontSize: '0.85rem' }}>
              <i className="fas fa-comment-dots" style={{ color: '#64748b', marginRight: '4px' }}></i> Remarks / Vehicle Details
            </label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. Vehicle KA-36-A-1234, Driver Ramesh, Notes"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Modal Actions */}
          <div className="modal-actions" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-blue"
              disabled={loading}
              style={{ minWidth: '150px', background: '#2563eb', cursor: loading ? 'not-allowed' : 'pointer' }}
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
