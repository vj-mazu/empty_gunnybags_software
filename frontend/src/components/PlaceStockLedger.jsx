import React, { useState, useEffect } from 'react';
import { getPlaces, getPlaceLedger } from '../api';
import { formatDate, formatBags } from '../utils/formatters';
import SearchableSelect from './SearchableSelect';

const PlaceStockLedger = () => {
  const [places, setPlaces] = useState([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState('');
  const [showZeroBalance, setShowZeroBalance] = useState(false);
  const [ledgerData, setLedgerData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlaces().then(res => setPlaces(res.results || res.data || res)).catch(console.error);
  }, []);

  const requestSeqRef = React.useRef(0);

  const fetchLedger = (placeId) => {
    const currentSeq = ++requestSeqRef.current;
    setLoading(true);
    getPlaceLedger(placeId)
      .then(res => {
        if (currentSeq === requestSeqRef.current) {
          setLedgerData(res.results || res.data || []);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (currentSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    fetchLedger(selectedPlaceId);
  }, [selectedPlaceId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Filter Bar */}
      <div className="card" style={{ padding: '1rem 1.25rem', background: '#ffffff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fas fa-industry" style={{ color: '#2563eb' }}></i> Mill Transfer Stock Ledger
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>
              Track stock transfers received from Mother India vs outside mill sales and live remaining inventory per mill location.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ width: '220px' }}>
              <SearchableSelect 
                options={[{ id: '', name: 'All Mill Transfer Locations' }, ...places]}
                value={selectedPlaceId}
                onChange={setSelectedPlaceId}
                placeholder="All Mill Transfer Locations"
              />
            </div>

            {!selectedPlaceId && (
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.4rem', 
                fontSize: '0.78rem', 
                fontWeight: 600, 
                color: '#475569', 
                cursor: 'pointer',
                background: '#f8fafc',
                padding: '0.4rem 0.65rem',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                userSelect: 'none'
              }}>
                <input 
                  type="checkbox" 
                  checked={showZeroBalance} 
                  onChange={(e) => setShowZeroBalance(e.target.checked)} 
                />
                Show 0 Balance Locations
              </label>
            )}

            <button className="btn btn-ghost" onClick={() => fetchLedger(selectedPlaceId)}>
              <i className="fas fa-sync-alt"></i> Refresh
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          <i className="fas fa-spinner fa-spin fa-2x" style={{ color: '#2563eb', marginBottom: '0.75rem' }}></i>
          <div>Loading place inventory balance...</div>
        </div>
      ) : (() => {
        const displayedData = ledgerData.filter(place => {
          if (selectedPlaceId) return true; // Specifically chosen location: always show
          if (showZeroBalance) return true; // User explicitly requested 0 balance locations
          return Number(place.remaining_bags) > 0; // Default: show only active locations with stock
        });

        if (displayedData.length === 0) {
          return (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              <i className="fas fa-boxes-packing fa-2x" style={{ color: '#cbd5e1', marginBottom: '0.75rem' }}></i>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#334155', marginBottom: '0.35rem' }}>
                No mill transfer locations currently holding remaining stock.
              </div>
              <p style={{ fontSize: '0.84rem', color: '#64748b', maxWidth: '480px', margin: '0 auto 1rem' }}>
                All previously transferred stock has been fully dispatched/sold out.
              </p>
              {!selectedPlaceId && !showZeroBalance && (
                <button 
                  className="btn btn-ghost" 
                  onClick={() => setShowZeroBalance(true)}
                  style={{ border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                >
                  <i className="fas fa-history"></i> Show All Locations (Including 0 Balance History)
                </button>
              )}
            </div>
          );
        }

        return displayedData.map(place => (
          <div key={place.place_id} className="card" style={{ borderLeft: '5px solid #2563eb', padding: '1.25rem' }}>
            {/* Place Title and Metric Summary */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <i className="fas fa-building" style={{ color: '#2563eb' }}></i> {place.place_name}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ background: '#eff6ff', padding: '0.5rem 0.85rem', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                  <div style={{ fontSize: '0.7rem', color: '#1e40af', fontWeight: 700 }}>TRANSFERRED IN</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1d4ed8' }}>+{formatBags(place.transferred_in_bags)}</div>
                </div>
                <div style={{ background: '#fef2f2', padding: '0.5rem 0.85rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                  <div style={{ fontSize: '0.7rem', color: '#991b1b', fontWeight: 700 }}>LOCATION SALES</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#dc2626' }}>-{formatBags(place.sales_bags)}</div>
                </div>
                <div style={{ background: place.remaining_bags >= 0 ? '#ecfdf5' : '#fff1f2', padding: '0.5rem 0.85rem', borderRadius: '8px', border: `1px solid ${place.remaining_bags >= 0 ? '#a7f3d0' : '#fecdd3'}` }}>
                  <div style={{ fontSize: '0.7rem', color: place.remaining_bags >= 0 ? '#065f46' : '#9f1239', fontWeight: 700 }}>BRANCH BALANCE</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: place.remaining_bags >= 0 ? '#059669' : '#e11d48' }}>{formatBags(place.remaining_bags)}</div>
                </div>
              </div>
            </div>

            {/* Split Grids: Transferred In vs Sales */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
              {/* Transferred In Section */}
              <div>
                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#1e40af', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <i className="fas fa-truck-moving"></i> Transferred From Mother India ({place.recent_transfers?.length || 0})
                </h4>
                {place.recent_transfers?.length === 0 ? (
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px' }}>
                    No incoming transfers recorded.
                  </div>
                ) : (
                  <div className="table-wrapper" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Invoice</th>
                          <th>Variety</th>
                          <th style={{ textAlign: 'right' }}>Bags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {place.recent_transfers.map(item => (
                          <tr key={item.id}>
                            <td>{formatDate(item.date)}</td>
                            <td style={{ fontWeight: 600 }}>{item.invoice_no}</td>
                            <td>{item.variety_name}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>+{formatBags(item.bags)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Sales from Location Section */}
              <div>
                <h4 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <i className="fas fa-cart-shopping"></i> Branch Sales / Dispatched ({place.recent_sales?.length || 0})
                </h4>
                {place.recent_sales?.length === 0 ? (
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px' }}>
                    No branch sales recorded yet.
                  </div>
                ) : (
                  <div className="table-wrapper" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Party / Customer</th>
                          <th>Variety</th>
                          <th style={{ textAlign: 'right' }}>Bags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {place.recent_sales.map(item => (
                          <tr key={item.id}>
                            <td>{formatDate(item.date)}</td>
                            <td style={{ fontWeight: 600 }}>{item.party_name}</td>
                            <td>{item.variety_name}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{formatBags(item.bags)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ));
      })()}
    </div>
  );
};

export default PlaceStockLedger;
