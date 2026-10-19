import React, { useState, useEffect } from 'react';
import { 
  getUsers, createUser, updateUser, deleteUser,
  getPlaces, createPlace, updatePlace, deletePlace,
  getFloors, createFloor, updateFloor, deleteFloor,
  getParties, createParty, updateParty, deleteParty,
  getVarieties, createVariety, updateVariety, deleteVariety,
  downloadVarietyMasterPdf, downloadFloorStockPdf, getFloorStock,
  placeVarietyOrder
} from '../api';
import CustomConfirmModal from './CustomConfirmModal';

const MasterCreation = ({ user, activeSection, showToast }) => {
  const [currentMasterTab, setCurrentMasterTab] = useState(activeSection || 'party');
  const [searchTerm, setSearchTerm] = useState('');

  // Custom confirm dialog state
  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    confirmColor: '',
    onConfirm: () => {}
  });

  // Data States
  const [users, setUsers] = useState([]);
  const [places, setPlaces] = useState([]);
  const [floors, setFloors] = useState([]);
  const [parties, setParties] = useState([]);
  const [varieties, setVarieties] = useState([]);
  const [floorStockReport, setFloorStockReport] = useState(null);

  // Modal States
  const [showUserModal, setShowUserModal] = useState(false);
  const [showPlaceModal, setShowPlaceModal] = useState(false);
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [showVarietyModal, setShowVarietyModal] = useState(false);

  // Bag Order Modal State (Owner Only)
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderModalVariety, setOrderModalVariety] = useState(null);
  const [orderForm, setOrderForm] = useState({
    order_date: new Date().toISOString().split('T')[0],
    order_bags: '',
    order_notes: ''
  });
  const [savingOrder, setSavingOrder] = useState(false);

  // Edit Tracking IDs
  const [editUserId, setEditUserId] = useState(null);
  const [editPlaceId, setEditPlaceId] = useState(null);
  const [editFloorId, setEditFloorId] = useState(null);
  const [editPartyId, setEditPartyId] = useState(null);
  const [editVarietyId, setEditVarietyId] = useState(null);

  // Form States
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'STAFF' });
  const [placeForm, setPlaceForm] = useState({ name: '' });
  const [floorForm, setFloorForm] = useState({ name: '', description: '' });
  const [partyForm, setPartyForm] = useState({ name: '', shortcut_name: '', phone_number: '', place: '' });
  const [varietyForm, setVarietyForm] = useState({ name: '', kgs_per_bag: '', photo: null });
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [phoneError, setPhoneError] = useState('');

  // Highlighted / Pinned Varieties (supports 'red', 'green', 'black')
  const [highlightedVarieties, setHighlightedVarieties] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mother_india_highlighted_varieties') || '{}');
      if (Array.isArray(saved)) {
        const map = {};
        saved.forEach(id => { map[id] = 'red'; });
        return map;
      }
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      return {};
    }
  });

  const toggleHighlightVariety = (id, color) => {
    setHighlightedVarieties(prev => {
      const updated = { ...prev };
      if (updated[id] === color) {
        delete updated[id];
      } else {
        updated[id] = color;
      }
      try {
        localStorage.setItem('mother_india_highlighted_varieties', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const cycleHighlightVariety = (id) => {
    const cur = highlightedVarieties[id];
    let nextColor = null;
    if (!cur) nextColor = 'red';
    else if (cur === 'red') nextColor = 'green';
    else if (cur === 'green') nextColor = 'black';
    else nextColor = null;

    setHighlightedVarieties(prev => {
      const updated = { ...prev };
      if (nextColor) {
        updated[id] = nextColor;
      } else {
        delete updated[id];
      }
      try {
        localStorage.setItem('mother_india_highlighted_varieties', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    if (activeSection) {
      setCurrentMasterTab(activeSection);
      if (activeSection === 'variety') {
        loadVarieties(true);
      }
    }
  }, [activeSection]);

  const loadAllData = async () => {
    loadUsers();
    loadPlaces();
    loadFloors();
    loadParties();
    loadVarieties(true);
    loadFloorStock();
  };

  const loadUsers = () => getUsers().then(res => setUsers(res.results || res.data || res)).catch(console.error);
  const loadPlaces = () => getPlaces().then(res => setPlaces(res.results || res.data || res)).catch(console.error);
  const loadFloors = () => getFloors().then(res => setFloors(res.results || res.data || res)).catch(console.error);
  const loadParties = () => getParties().then(res => setParties(res.results || res.data || res)).catch(console.error);
  const loadVarieties = (fresh = true) => getVarieties(fresh).then(res => setVarieties(res.results || res.data || res)).catch(console.error);
  const loadFloorStock = () => getFloorStock().then(res => setFloorStockReport(res)).catch(console.error);

  // --- Reset forms ---
  const closeUserModal = () => {
    setShowUserModal(false);
    setEditUserId(null);
    setUserForm({ username: '', password: '', role: 'STAFF' });
  };
  const closePlaceModal = () => {
    setShowPlaceModal(false);
    setEditPlaceId(null);
    setPlaceForm({ name: '' });
  };
  const closeFloorModal = () => {
    setShowFloorModal(false);
    setEditFloorId(null);
    setFloorForm({ name: '', description: '' });
  };
  const closePartyModal = () => {
    setShowPartyModal(false);
    setEditPartyId(null);
    setPartyForm({ name: '', shortcut_name: '', phone_number: '', place: '' });
    setPhoneError('');
  };
  const closeVarietyModal = () => {
    setShowVarietyModal(false);
    setEditVarietyId(null);
    setVarietyForm({ name: '', kgs_per_bag: '', photo: null });
  };

  // --- Handlers: User ---
  const handleUserSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editUserId) {
        const payload = { username: userForm.username, role: userForm.role };
        if (userForm.password) payload.password = userForm.password;
        await updateUser(editUserId, payload);
      } else {
        await createUser(userForm);
      }
      if (showToast) showToast(`User ${editUserId ? 'updated' : 'created'} successfully!`);
      closeUserModal();
      loadUsers();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving user', 'error');
      else alert(err.message || 'Error saving user');
    }
  };

  const handleEditUserClick = (u) => {
    setEditUserId(u.id);
    setUserForm({ username: u.username, password: '', role: u.role });
    setShowUserModal(true);
  };

  const handleDeleteUser = (id) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can delete user accounts!', 'error');
      return;
    }
    setConfirmState({
      isOpen: true,
      title: 'Delete User Account?',
      message: 'Are you sure you want to delete this user? This action cannot be undone.',
      confirmText: 'Delete User',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          await deleteUser(id);
          if (showToast) showToast('User deleted successfully!');
          loadUsers();
        } catch (err) {
          if (showToast) showToast(err.message || 'Cannot delete user', 'error');
        }
      }
    });
  };

  // --- Handlers: Place ---
  const handlePlaceSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editPlaceId) {
        await updatePlace(editPlaceId, placeForm);
      } else {
        await createPlace(placeForm);
      }
      if (showToast) showToast(`Place ${editPlaceId ? 'updated' : 'created'} successfully!`);
      closePlaceModal();
      loadPlaces();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving place', 'error');
    }
  };

  const handleEditPlaceClick = (p) => {
    setEditPlaceId(p.id);
    setPlaceForm({ name: p.name });
    setShowPlaceModal(true);
  };

  const handleDeletePlace = (id) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can delete places!', 'error');
      return;
    }
    setConfirmState({
      isOpen: true,
      title: 'Delete Place?',
      message: 'Are you sure you want to delete this place?',
      confirmText: 'Delete Place',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          await deletePlace(id);
          if (showToast) showToast('Place deleted successfully!');
          loadPlaces();
        } catch (err) {
          if (showToast) showToast(err.message || 'Cannot delete place linked to parties!', 'error');
        }
      }
    });
  };

  // --- Handlers: Floor ---
  const handleFloorSubmit = async (e) => {
    e.preventDefault();
    if (!floorForm.name.trim()) return;
    try {
      if (editFloorId) {
        await updateFloor(editFloorId, floorForm);
      } else {
        await createFloor(floorForm);
      }
      if (showToast) showToast(`Floor ${editFloorId ? 'updated' : 'created'} successfully!`);
      closeFloorModal();
      loadFloors();
      loadFloorStock();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving floor', 'error');
    }
  };

  const handleEditFloorClick = (fl) => {
    setEditFloorId(fl.id);
    setFloorForm({ name: fl.name, description: fl.description || '' });
    setShowFloorModal(true);
  };

  const handleDeleteFloor = (id) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can delete floors!', 'error');
      return;
    }
    setConfirmState({
      isOpen: true,
      title: 'Delete Floor Location?',
      message: 'Are you sure you want to delete this floor? Floors linked to transactions or active stock cannot be deleted.',
      confirmText: 'Delete Floor',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          await deleteFloor(id);
          if (showToast) showToast('Floor deleted successfully!');
          loadFloors();
          loadFloorStock();
        } catch (err) {
          if (showToast) showToast(err.message || 'Cannot delete floor with active transactions!', 'error');
        }
      }
    });
  };

  // --- Handlers: Party ---
  const handlePartySubmit = async (e) => {
    e.preventDefault();
    if (partyForm.phone_number) {
      const phoneRegex = /^[6-9]\d{9}$/;
      if (!phoneRegex.test(partyForm.phone_number)) {
        setPhoneError('Phone number must be exactly 10 digits starting with 6, 7, 8, or 9');
        return;
      }
    }
    setPhoneError('');

    const payload = {
      name: partyForm.name,
      shortcut_name: partyForm.shortcut_name || null,
      phone_number: partyForm.phone_number || null,
      place: partyForm.place ? parseInt(partyForm.place, 10) : null
    };

    try {
      if (editPartyId) {
        await updateParty(editPartyId, payload);
      } else {
        await createParty(payload);
      }
      if (showToast) showToast(`Party ${editPartyId ? 'updated' : 'created'} successfully!`);
      closePartyModal();
      loadParties();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving party', 'error');
    }
  };

  const handleEditPartyClick = (pt) => {
    setEditPartyId(pt.id);
    setPartyForm({
      name: pt.name,
      shortcut_name: pt.shortcut_name || '',
      phone_number: pt.phone_number || '',
      place: pt.place || ''
    });
    setShowPartyModal(true);
  };

  const handleDeleteParty = (id) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can delete parties!', 'error');
      return;
    }
    setConfirmState({
      isOpen: true,
      title: 'Delete Party?',
      message: 'Are you sure you want to delete this party?',
      confirmText: 'Delete Party',
      confirmColor: '#dc2626',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          await deleteParty(id);
          if (showToast) showToast('Party deleted successfully!');
          loadParties();
        } catch (err) {
          if (showToast) showToast(err.message || 'Cannot delete party linked to transactions!', 'error');
        }
      }
    });
  };

  // --- Handlers: Variety ---
  const handlePhotoChange = (file) => {
    if (!file) {
      setVarietyForm(prev => ({ ...prev, photo: null, photo_data: '', photo_size_kb: 0 }));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 300; // Perfect thumbnail dimension
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Compress to lightweight 15-25KB high-efficiency JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        const sizeKb = Math.round((dataUrl.length * 3 / 4) / 1024);
        setVarietyForm(prev => ({ ...prev, photo: file, photo_data: dataUrl, photo_size_kb: sizeKb }));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleVarietySubmit = async (e) => {
    e.preventDefault();
    try {
      const formData = new FormData();
      formData.append('name', varietyForm.name);
      formData.append('kgs_per_bag', varietyForm.kgs_per_bag);
      if (varietyForm.photo_data) {
        formData.append('photo_data', varietyForm.photo_data);
      }
      if (varietyForm.photo) {
        formData.append('photo', varietyForm.photo, `variety_${Date.now()}.jpg`);
      }

      if (editVarietyId) {
        await updateVariety(editVarietyId, formData);
      } else {
        await createVariety(formData);
      }
      if (showToast) showToast(`Variety ${editVarietyId ? 'updated' : 'created'} successfully!`);
      closeVarietyModal();
      loadVarieties();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving variety', 'error');
    }
  };

  const handleEditVarietyClick = (v) => {
    setEditVarietyId(v.id);
    setVarietyForm({
      name: v.name,
      kgs_per_bag: v.kgs_per_bag,
      photo: null,
      photo_data: v.photo_data || ''
    });
    setShowVarietyModal(true);
  };

  const handleDeleteVariety = (v) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can delete varieties!', 'error');
      return;
    }

    const hasStockOrRecords = !v.can_delete;
    const stockCount = Number(v.current_stock_bags || 0).toLocaleString();

    setConfirmState({
      isOpen: true,
      title: hasStockOrRecords ? 'Force Delete Variety & Clear Stock?' : 'Delete Variety?',
      message: hasStockOrRecords 
        ? `⚠️ Variety "${v.name}" currently has ${stockCount} Bags in active transactions. Deleting it will permanently remove the variety and ALL associated inward & outward stock records. Are you sure you want to proceed?`
        : `Are you sure you want to delete variety "${v.name}"?`,
      confirmText: hasStockOrRecords ? 'Force Delete & Clear Stock' : 'Delete Variety',
      confirmColor: '#dc2626',
      icon: hasStockOrRecords ? 'fa-triangle-exclamation' : 'fa-trash',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, isOpen: false }));
        try {
          await deleteVariety(v.id, hasStockOrRecords);
          if (showToast) showToast(hasStockOrRecords ? `Variety "${v.name}" and all associated stock records deleted!` : 'Variety deleted successfully!');
          loadVarieties();
        } catch (err) {
          if (showToast) showToast(err.message || 'Cannot delete variety linked to stock transactions!', 'error');
        }
      }
    });
  };

  const handleOpenOrderModal = (v) => {
    if (user?.role !== 'OWNER') {
      if (showToast) showToast('Only OWNER can place or manage bag orders!', 'error');
      return;
    }
    setOrderModalVariety(v);
    setOrderForm({
      order_date: v.order_date || new Date().toISOString().split('T')[0],
      order_bags: v.order_bags ? String(v.order_bags) : '',
      order_notes: v.order_notes || ''
    });
    setShowOrderModal(true);
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    if (!orderModalVariety) return;
    try {
      setSavingOrder(true);
      await placeVarietyOrder(orderModalVariety.id, {
        order_placed: true,
        order_date: orderForm.order_date,
        order_bags: orderForm.order_bags ? parseInt(orderForm.order_bags, 10) : null,
        order_notes: orderForm.order_notes || ''
      });
      if (showToast) showToast(`Bag order for "${orderModalVariety.name}" recorded successfully!`);
      setShowOrderModal(false);
      setOrderModalVariety(null);
      loadVarieties();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error saving bag order', 'error');
    } finally {
      setSavingOrder(false);
    }
  };

  const handleClearOrder = async (v) => {
    if (user?.role !== 'OWNER') return;
    try {
      await placeVarietyOrder(v.id, { order_placed: false });
      if (showToast) showToast(`Bag order for "${v.name}" marked received/cleared!`);
      loadVarieties();
    } catch (err) {
      if (showToast) showToast(err.message || 'Error clearing bag order', 'error');
    }
  };

  // Filtered lists
  const q = searchTerm.toLowerCase().trim();
  const filteredParties = parties.filter(p => 
    !q || p.name?.toLowerCase().includes(q) || p.shortcut_name?.toLowerCase().includes(q) || p.phone_number?.includes(q) || p.place_name?.toLowerCase().includes(q)
  );
  const filteredVarieties = varieties
    .filter(v => !q || v.name?.toLowerCase().includes(q) || String(v.kgs_per_bag).includes(q))
    .sort((a, b) => {
      const aColor = highlightedVarieties[a.id];
      const bColor = highlightedVarieties[b.id];
      const score = (c) => (c === 'red' ? 3 : c === 'green' ? 2 : c === 'black' ? 1 : 0);
      const diff = score(bColor) - score(aColor);
      if (diff !== 0) return diff;
      return (a.name || '').localeCompare(b.name || '');
    });
  const filteredPlaces = places.filter(p => 
    !q || p.name?.toLowerCase().includes(q)
  );
  const filteredFloors = floors.filter(fl => 
    !q || fl.name?.toLowerCase().includes(q) || fl.description?.toLowerCase().includes(q)
  );
  const filteredUsers = users.filter(u => 
    !q || u.username?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q)
  );

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto' }}>
      
      {/* Top Header & Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <i className="fas fa-sliders" style={{ color: '#2563eb' }}></i> Master Records Management
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>
            Configure and maintain core database masters for Parties, Varieties, Godown Floors, Branches, and System Users.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ position: 'relative' }}>
            <i className="fas fa-search" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.8rem' }}></i>
            <input 
              type="text" 
              className="input" 
              placeholder={`Search ${currentMasterTab}...`} 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              style={{ paddingLeft: '2rem', width: '220px', fontSize: '0.82rem' }}
            />
          </div>
          {searchTerm && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSearchTerm('')}>Clear</button>
          )}
        </div>
      </div>

      {/* SEGMENTED TAB BUTTONS BAR */}
      <div className="master-tabs-bar">
        <button 
          className={`master-tab-btn ${currentMasterTab === 'party' ? 'active' : ''}`} 
          onClick={() => { setCurrentMasterTab('party'); setSearchTerm(''); }}
        >
          <i className="fas fa-address-book" style={{ color: currentMasterTab === 'party' ? '#2563eb' : '#64748b' }}></i>
          <span>Party Master</span>
          <span className="tab-badge">{parties.length}</span>
        </button>

        <button 
          className={`master-tab-btn ${currentMasterTab === 'variety' ? 'active' : ''}`} 
          onClick={() => { setCurrentMasterTab('variety'); setSearchTerm(''); loadVarieties(true); }}
        >
          <i className="fas fa-wheat-awn" style={{ color: currentMasterTab === 'variety' ? '#10b981' : '#64748b' }}></i>
          <span>Variety Master</span>
          <span className="tab-badge">{varieties.length}</span>
        </button>

        <button 
          className={`master-tab-btn ${currentMasterTab === 'floor' ? 'active' : ''}`} 
          onClick={() => { setCurrentMasterTab('floor'); setSearchTerm(''); }}
        >
          <i className="fas fa-layer-group" style={{ color: currentMasterTab === 'floor' ? '#0284c7' : '#64748b' }}></i>
          <span>Floor Master</span>
          <span className="tab-badge">{floors.length}</span>
        </button>

        <button 
          className={`master-tab-btn ${currentMasterTab === 'place' ? 'active' : ''}`} 
          onClick={() => { setCurrentMasterTab('place'); setSearchTerm(''); }}
        >
          <i className="fas fa-industry" style={{ color: currentMasterTab === 'place' ? '#f59e0b' : '#64748b' }}></i>
          <span>Mill Transfer Locations</span>
          <span className="tab-badge">{places.length}</span>
        </button>

        <button 
          className={`master-tab-btn ${currentMasterTab === 'user' ? 'active' : ''}`} 
          onClick={() => { setCurrentMasterTab('user'); setSearchTerm(''); }}
        >
          <i className="fas fa-user-gear" style={{ color: currentMasterTab === 'user' ? '#8b5cf6' : '#64748b' }}></i>
          <span>User Accounts</span>
          <span className="tab-badge">{users.length}</span>
        </button>
      </div>

      {/* TAB 1: PARTY MASTER */}
      {currentMasterTab === 'party' && (
        <div className="card">
          <div className="card-hdr">
            <div className="card-title">
              <i className="fas fa-address-book" style={{ color: '#2563eb' }}></i> Parties &amp; Suppliers ({filteredParties.length})
            </div>
            <button className="btn btn-blue" onClick={() => setShowPartyModal(true)}>
              <i className="fas fa-plus"></i> Add New Party
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '5%', textAlign: 'center' }}>SL</th>
                  <th style={{ width: '30%' }}>Party / Supplier Name</th>
                  <th style={{ width: '15%' }}>Shortcut</th>
                  <th style={{ width: '20%' }}>Phone Number</th>
                  <th style={{ width: '18%' }}>Place / City</th>
                  <th style={{ width: '12%', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredParties.map((pt, idx) => (
                  <tr key={pt.id}>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>{pt.name}</td>
                    <td style={{ fontWeight: 600, color: '#475569' }}>{pt.shortcut_name || '-'}</td>
                    <td style={{ color: '#334155' }}>{pt.phone_number || '-'}</td>
                    <td style={{ color: '#334155' }}>{pt.place_name || '-'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEditPartyClick(pt)}>
                          <i className="fas fa-pen-to-square" style={{ color: '#2563eb' }}></i> Edit
                        </button>
                        {pt.can_delete && user?.role === 'OWNER' ? (
                          <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteParty(pt.id)}>
                            <i className="fas fa-trash" style={{ color: '#ef4444' }}></i>
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.2rem' }}>
                            <i className="fas fa-lock" style={{ marginRight: '2px' }}></i> Active
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredParties.length === 0 && (
                  <tr><td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No parties found matching criteria.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: VARIETY MASTER */}
      {currentMasterTab === 'variety' && (
        <div className="card">
          <div className="card-hdr">
            <div className="card-title">
              <i className="fas fa-wheat-awn" style={{ color: '#10b981' }}></i> Variety Master ({filteredVarieties.length})
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button 
                className="btn btn-ghost" 
                onClick={() => loadVarieties(true)}
                title="Refresh Live Stock"
                style={{ border: '1px solid #cbd5e1', color: '#0f172a' }}
              >
                <i className="fas fa-arrows-rotate"></i> Refresh Stock
              </button>
              <button 
                className="btn btn-ghost" 
                onClick={downloadVarietyMasterPdf}
                title="Download Variety Master Catalog PDF with Images & Data"
                style={{ border: '1px solid #cbd5e1', color: '#0f172a' }}
              >
                <i className="fas fa-file-pdf" style={{ color: '#dc2626' }}></i> Download PDF
              </button>
              <button className="btn btn-green" onClick={() => setShowVarietyModal(true)}>
                <i className="fas fa-plus"></i> Add New Variety
              </button>
            </div>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '5%', textAlign: 'center' }}>SL</th>
                  <th style={{ width: '6%', textAlign: 'center' }}>Photo</th>
                  <th style={{ width: '22%' }}>Variety Name</th>
                  <th style={{ width: '10%' }}>Std Wt (Kg)</th>
                  <th style={{ width: '14%' }}>Our Mill Stock</th>
                  <th style={{ width: '14%' }}>Other Mills' Stock</th>
                  <th style={{ width: '11%' }}>Total Stock</th>
                  <th style={{ width: '11%' }}>Bag Order Status</th>
                  <th style={{ width: '7%', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVarieties.map((v, idx) => {
                  const highlightColor = highlightedVarieties[v.id]; // 'red', 'green', 'black', or undefined
                  const isRed = highlightColor === 'red';
                  const isGreen = highlightColor === 'green';
                  const isBlack = highlightColor === 'black';
                  const rowClass = isRed ? 'variety-highlighted-red' : isGreen ? 'variety-highlighted-green' : isBlack ? 'variety-highlighted-black' : '';
                  const borderLeft = isRed ? '4px solid #ef4444' : isGreen ? '4px solid #16a34a' : isBlack ? '4px solid #0f172a' : '4px solid transparent';
                  const photoBorder = isRed ? '2px solid #ef4444' : isGreen ? '2px solid #16a34a' : isBlack ? '2px solid #0f172a' : '1.5px solid #cbd5e1';

                  return (
                    <tr 
                      key={v.id}
                      className={rowClass}
                      style={{ borderLeft }}
                    >
                      <td style={{ textAlign: 'center', fontWeight: 600, color: '#64748b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => cycleHighlightVariety(v.id)}
                            title={
                              isRed ? "Red Star (Click to switch to Green)" :
                              isGreen ? "Green Star (Click to switch to Black)" :
                              isBlack ? "Black Star (Click to unhighlight)" :
                              "Click star to Highlight & Pin (Red -> Green -> Black)"
                            }
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '2px',
                              color: isRed ? '#ef4444' : isGreen ? '#16a34a' : isBlack ? '#0f172a' : '#cbd5e1',
                              fontSize: '0.92rem'
                            }}
                          >
                            <i className={(isRed || isGreen || isBlack) ? "fas fa-star" : "far fa-star"}></i>
                          </button>
                          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px', marginRight: '3px' }}>
                            <span 
                              onClick={() => toggleHighlightVariety(v.id, 'red')}
                              title="Set Red Star"
                              style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', cursor: 'pointer', opacity: isRed ? 1 : 0.35, transform: isRed ? 'scale(1.2)' : 'none' }}
                            />
                            <span 
                              onClick={() => toggleHighlightVariety(v.id, 'green')}
                              title="Set Green Star"
                              style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', cursor: 'pointer', opacity: isGreen ? 1 : 0.35, transform: isGreen ? 'scale(1.2)' : 'none' }}
                            />
                            <span 
                              onClick={() => toggleHighlightVariety(v.id, 'black')}
                              title="Set Black Star"
                              style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0f172a', cursor: 'pointer', opacity: isBlack ? 1 : 0.35, transform: isBlack ? 'scale(1.2)' : 'none' }}
                            />
                          </div>
                          <span style={{ minWidth: '16px' }}>{idx + 1}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {(v.photo_url || v.photo_data || v.photo) ? (
                          <div 
                            onClick={() => setPreviewPhoto({ src: v.photo_url || v.photo_data || v.photo, name: v.name, kgs: v.kgs_per_bag })}
                            style={{ cursor: 'pointer', display: 'inline-block', position: 'relative' }}
                            title="Click to view full photo"
                          >
                            <img 
                              src={v.photo_url || v.photo_data || v.photo} 
                              alt={v.name} 
                              className="thumb" 
                              style={{ 
                                width: '38px', 
                                height: '38px', 
                                objectFit: 'cover', 
                                borderRadius: '6px', 
                                border: photoBorder,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                              }} 
                            />
                          </div>
                        ) : (
                          <div className="thumb" style={{ width: '38px', height: '38px', background: '#f1f5f9', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
                            <i className="fas fa-image" style={{ color: '#cbd5e1' }}></i>
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span>{v.name}</span>
                          {isRed && (
                            <span 
                              style={{ 
                                fontSize: '0.68rem', 
                                background: '#fee2e2', 
                                color: '#b91c1c', 
                                border: '1px solid #fca5a5', 
                                padding: '1px 6px', 
                                borderRadius: '999px', 
                                fontWeight: 800, 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px' 
                              }}
                            >
                              <i className="fas fa-star" style={{ fontSize: '0.6rem' }}></i> Red Star
                            </span>
                          )}
                          {isGreen && (
                            <span 
                              style={{ 
                                fontSize: '0.68rem', 
                                background: '#dcfce7', 
                                color: '#15803d', 
                                border: '1px solid #86efac', 
                                padding: '1px 6px', 
                                borderRadius: '999px', 
                                fontWeight: 800, 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px' 
                              }}
                            >
                              <i className="fas fa-star" style={{ fontSize: '0.6rem' }}></i> Green Star
                            </span>
                          )}
                          {isBlack && (
                            <span 
                              style={{ 
                                fontSize: '0.68rem', 
                                background: '#f1f5f9', 
                                color: '#0f172a', 
                                border: '1px solid #cbd5e1', 
                                padding: '1px 6px', 
                                borderRadius: '999px', 
                                fontWeight: 800, 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px' 
                              }}
                            >
                              <i className="fas fa-star" style={{ fontSize: '0.6rem' }}></i> Black Star
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600, color: '#2563eb' }}>{v.kgs_per_bag} kg</td>

                      {/* 1. Our Mill Stock */}
                      <td style={{ fontWeight: 700, color: (v.our_mill_stock_bags ?? v.current_stock_bags ?? 0) < 2000 ? '#ef4444' : '#059669' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{(v.our_mill_stock_bags ?? v.current_stock_bags ?? 0).toLocaleString()} Bags</span>
                          <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 500 }}>
                            {((v.our_mill_stock_bags ?? v.current_stock_bags ?? 0) * Number(v.kgs_per_bag || 0)).toLocaleString()} kg
                          </span>
                        </div>
                      </td>

                      {/* 2. Other Mills' Stock */}
                      <td>
                        {(v.other_places_stock_bags || 0) > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ color: '#0284c7', fontWeight: 700 }}>
                              {Number(v.other_places_stock_bags).toLocaleString()} Bags
                            </span>
                            {v.other_places_breakdown && v.other_places_breakdown.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                {v.other_places_breakdown.map((p, pIdx) => (
                                  <span 
                                    key={p.place_id || pIdx} 
                                    style={{ 
                                      fontSize: '0.64rem', 
                                      background: '#f0f9ff', 
                                      color: '#0369a1', 
                                      border: '1px solid #bae6fd', 
                                      padding: '1px 5px', 
                                      borderRadius: '4px',
                                      fontWeight: 600
                                    }}
                                    title={`${p.place_name}: ${p.bags.toLocaleString()} Bags`}
                                  >
                                    {p.place_name}: <strong>{p.bags.toLocaleString()}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>0 Bags</span>
                        )}
                      </td>

                      {/* 3. Total Stock */}
                      <td style={{ fontWeight: 700 }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ color: '#0f172a' }}>
                            {(v.current_stock_bags || 0).toLocaleString()} Bags
                          </span>
                          <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 500 }}>
                            {((v.current_stock_bags || 0) * Number(v.kgs_per_bag || 0)).toLocaleString()} kg
                          </span>
                        </div>
                      </td>

                      <td>
                        {v.order_placed ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <span style={{ 
                              fontSize: '0.72rem', 
                              background: '#eff6ff', 
                              color: '#1d4ed8', 
                              border: '1px solid #bfdbfe', 
                              padding: '2px 8px', 
                              borderRadius: '6px', 
                              fontWeight: 800, 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '5px',
                              width: 'fit-content'
                            }}>
                              <i className="fas fa-cart-shopping" style={{ color: '#2563eb' }}></i> 
                              Order Placed: {v.order_bags ? `${Number(v.order_bags).toLocaleString()} Bags` : 'Bags Ordered'}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600 }}>
                              Date: {v.order_date || '-'} {v.order_notes ? `• ${v.order_notes}` : ''}
                            </span>
                            {user?.role === 'OWNER' && (
                              <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center' }}>
                                <button 
                                  type="button" 
                                  onClick={() => handleOpenOrderModal(v)}
                                  style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.68rem', color: '#2563eb', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  Edit Order
                                </button>
                                <span style={{ color: '#cbd5e1' }}>•</span>
                                <button 
                                  type="button" 
                                  onClick={() => handleClearOrder(v)}
                                  style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.68rem', color: '#16a34a', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                                  title="Mark bags as received in godown"
                                >
                                  Mark Received
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {(v.our_mill_stock_bags ?? v.current_stock_bags ?? 0) < 2000 ? (
                              <span style={{ fontSize: '0.7rem', color: '#ea580c', fontWeight: 700, background: '#fff7ed', border: '1px solid #ffedd5', padding: '2px 6px', borderRadius: '4px' }}>
                                <i className="fas fa-triangle-exclamation" style={{ marginRight: '3px' }}></i> Low (Not Ordered)
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>-</span>
                            )}
                            {user?.role === 'OWNER' && (
                              <button
                                type="button"
                                onClick={() => handleOpenOrderModal(v)}
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #2563eb',
                                  borderRadius: '5px',
                                  padding: '2px 8px',
                                  fontSize: '0.69rem',
                                  fontWeight: 700,
                                  color: '#2563eb',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  boxShadow: '0 1px 2px rgba(37,99,235,0.08)'
                                }}
                                title="Place bag order for this variety"
                              >
                                <i className="fas fa-plus" style={{ fontSize: '0.6rem' }}></i> Place Order
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                          <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEditVarietyClick(v)}>
                            <i className="fas fa-pen-to-square" style={{ color: '#2563eb' }}></i> Edit
                          </button>
                          {user?.role === 'OWNER' ? (
                            <button 
                              className="btn btn-ghost btn-sm" 
                              title={v.can_delete ? "Delete Variety" : "Force Delete Variety & Stock"} 
                              onClick={() => handleDeleteVariety(v)}
                              style={{ color: '#ef4444' }}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          ) : (
                            v.can_delete ? null : (
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.2rem' }}>
                                <i className="fas fa-lock" style={{ marginRight: '2px' }}></i> Active
                              </span>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredVarieties.length === 0 && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No varieties found matching criteria.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: FLOOR MASTER */}
      {currentMasterTab === 'floor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="card">
            <div className="card-hdr">
              <div className="card-title">
                <i className="fas fa-layer-group" style={{ color: '#0284c7' }}></i> Central Godown Floor Master ({filteredFloors.length})
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn btn-ghost" 
                  onClick={() => downloadFloorStockPdf()}
                  title="Download Dedicated Floor-Wise Stock Inventory PDF"
                  style={{ border: '1px solid #cbd5e1', color: '#0f172a' }}
                >
                  <i className="fas fa-file-pdf" style={{ color: '#dc2626' }}></i> Download Floor PDF
                </button>
                <button className="btn btn-blue" onClick={() => setShowFloorModal(true)}>
                  <i className="fas fa-plus"></i> Add New Floor
                </button>
              </div>
            </div>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '6%', textAlign: 'center' }}>SL</th>
                    <th style={{ width: '34%' }}>Floor / Section Name</th>
                    <th style={{ width: '30%' }}>Description / Notes</th>
                    <th style={{ width: '18%' }}>Current Stock Stored</th>
                    <th style={{ width: '12%', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFloors.map((fl, idx) => {
                    const flStock = floorStockReport?.results?.find(r => r.floor_id === fl.id);
                    const totalBags = flStock ? flStock.total_bags : (fl.total_bags || 0);

                    return (
                      <tr key={fl.id}>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 700, color: '#0f172a' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <i className="fas fa-cubes-stacked" style={{ color: '#0284c7', fontSize: '0.85rem' }}></i>
                            <span>{fl.name}</span>
                          </div>
                        </td>
                        <td style={{ color: '#64748b', fontSize: '0.85rem' }}>{fl.description || '-'}</td>
                        <td style={{ fontWeight: 700, color: totalBags > 0 ? '#059669' : '#64748b' }}>
                          {totalBags.toLocaleString()} Bags
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                            <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEditFloorClick(fl)}>
                              <i className="fas fa-pen-to-square" style={{ color: '#2563eb' }}></i> Edit
                            </button>
                            {fl.can_delete && user?.role === 'OWNER' ? (
                              <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteFloor(fl.id)}>
                                <i className="fas fa-trash" style={{ color: '#ef4444' }}></i>
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.2rem' }}>
                                <i className="fas fa-lock" style={{ marginRight: '2px' }}></i> Active
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredFloors.length === 0 && (
                    <tr><td colSpan="5" style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No floors created yet. Click "Add New Floor" to set up your godown floors.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Floor Stock Matrix Breakdown */}
          {floorStockReport && floorStockReport.results && floorStockReport.results.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid #0284c7' }}>
              <div className="card-hdr">
                <div className="card-title">
                  <i className="fas fa-chart-pie" style={{ color: '#0284c7' }}></i> Live Stock Position Across Godown Floors
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#059669' }}>
                  Grand Total: {floorStockReport.grand_total_bags?.toLocaleString()} Bags ({floorStockReport.grand_total_kgs?.toLocaleString()} Kg)
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem', padding: '1rem' }}>
                {floorStockReport.results.map((flReport, rIdx) => (
                  <div key={flReport.floor_id || `r-${rIdx}`} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e1', paddingBottom: '0.5rem', marginBottom: '0.65rem' }}>
                      <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <i className="fas fa-building" style={{ color: '#0284c7' }}></i> {flReport.floor_name}
                      </span>
                      <span style={{ fontWeight: 800, color: flReport.total_bags > 0 ? '#15803d' : '#64748b', background: flReport.total_bags > 0 ? '#dcfce7' : '#f1f5f9', padding: '2px 8px', borderRadius: '999px', fontSize: '0.75rem' }}>
                        {flReport.total_bags.toLocaleString()} Bags
                      </span>
                    </div>
                    {flReport.varieties && flReport.varieties.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {flReport.varieties.map(v => (
                          <div key={v.variety_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', background: '#ffffff', padding: '4px 8px', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>{v.variety_name}</span>
                            <span style={{ fontWeight: 700, color: v.bags > 0 ? '#059669' : '#dc2626' }}>{v.bags.toLocaleString()} Bags</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem 0' }}>No stock currently on this floor</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MILL TRANSFER LOCATIONS MASTER */}
      {currentMasterTab === 'place' && (
        <div className="card">
          <div className="card-hdr">
            <div className="card-title">
              <i className="fas fa-industry" style={{ color: '#f59e0b' }}></i> Mill Transfer Locations Master ({filteredPlaces.length})
            </div>
            <button className="btn btn-blue" onClick={() => setShowPlaceModal(true)}>
              <i className="fas fa-plus"></i> Add New Mill Location
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '8%', textAlign: 'center' }}>SL</th>
                  <th style={{ width: '72%' }}>Mill Transfer Location Name (Outside Mill)</th>
                  <th style={{ width: '20%', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlaces.map((p, idx) => (
                  <tr key={p.id}>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEditPlaceClick(p)}>
                          <i className="fas fa-pen-to-square" style={{ color: '#2563eb' }}></i> Edit
                        </button>
                        {p.can_delete && user?.role === 'OWNER' ? (
                          <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeletePlace(p.id)}>
                            <i className="fas fa-trash" style={{ color: '#ef4444' }}></i>
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.2rem' }}>
                            <i className="fas fa-lock" style={{ marginRight: '2px' }}></i> Active
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredPlaces.length === 0 && (
                  <tr><td colSpan="3" style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No places found matching criteria.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: USER MANAGEMENT */}
      {currentMasterTab === 'user' && (
        <div className="card">
          <div className="card-hdr">
            <div className="card-title">
              <i className="fas fa-user-gear" style={{ color: '#8b5cf6' }}></i> User Accounts ({filteredUsers.length})
            </div>
            <button className="btn btn-blue" onClick={() => setShowUserModal(true)}>
              <i className="fas fa-plus"></i> Add New User
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '8%', textAlign: 'center' }}>SL</th>
                  <th style={{ width: '42%' }}>Username</th>
                  <th style={{ width: '30%' }}>Access Role</th>
                  <th style={{ width: '20%', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, idx) => (
                  <tr key={u.id}>
                    <td style={{ textAlign: 'center', fontWeight: 600, color: '#64748b' }}>{idx + 1}</td>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>{u.username}</td>
                    <td>
                      <span className={`role-pill ${u.role === 'OWNER' ? 'role-owner' : 'role-staff'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                        <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEditUserClick(u)}>
                          <i className="fas fa-pen-to-square" style={{ color: '#2563eb' }}></i> Edit
                        </button>
                        {u.can_delete && user?.role === 'OWNER' ? (
                          <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => handleDeleteUser(u.id)}>
                            <i className="fas fa-trash" style={{ color: '#ef4444' }}></i>
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0.2rem' }}>
                            <i className="fas fa-lock" style={{ marginRight: '2px' }}></i> Active
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan="4" style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>No users found matching criteria.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: USER */}
      {showUserModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-hdr">
              <div className="modal-title">
                <i className={editUserId ? "fas fa-user-pen" : "fas fa-user-plus"} style={{ color: '#8b5cf6' }}></i> 
                {editUserId ? "Edit User Details" : "Add New User Account"}
              </div>
              <button className="modal-close" onClick={closeUserModal}>&times;</button>
            </div>
            <form onSubmit={handleUserSubmit}>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Username</label>
                <input type="text" className="input" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} required placeholder="Enter username" />
              </div>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Password {editUserId && <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'none' }}>(Leave blank to keep unchanged)</span>}</label>
                <input type="password" className="input" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} required={!editUserId} placeholder="Enter password" />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Role Authority</label>
                <select className="input" value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
                  <option value="STAFF">Staff (Entry &amp; Approval Requests)</option>
                  <option value="OWNER">Owner (Full Direct Authority)</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeUserModal}>Cancel</button>
                <button type="submit" className="btn btn-blue">
                  <i className="fas fa-save"></i> {editUserId ? "Update User" : "Save User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PLACE */}
      {showPlaceModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-hdr">
              <div className="modal-title">
                <i className="fas fa-warehouse" style={{ color: '#f59e0b' }}></i> {editPlaceId ? "Edit Place Details" : "Add New Place / Branch"}
              </div>
              <button className="modal-close" onClick={closePlaceModal}>&times;</button>
            </div>
            <form onSubmit={handlePlaceSubmit}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Place Name</label>
                <input type="text" className="input" value={placeForm.name} onChange={e => setPlaceForm({ name: e.target.value })} required placeholder="e.g. Raichur Branch" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closePlaceModal}>Cancel</button>
                <button type="submit" className="btn btn-blue">
                  <i className="fas fa-save"></i> {editPlaceId ? "Update Place" : "Save Place"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FLOOR */}
      {showFloorModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-hdr">
              <div className="modal-title">
                <i className="fas fa-layer-group" style={{ color: '#0284c7' }}></i> {editFloorId ? "Edit Floor Details" : "Add New Godown Floor"}
              </div>
              <button className="modal-close" onClick={closeFloorModal}>&times;</button>
            </div>
            <form onSubmit={handleFloorSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label>Floor / Section Name</label>
                <input 
                  type="text" 
                  className="input" 
                  value={floorForm.name} 
                  onChange={e => setFloorForm({ ...floorForm, name: e.target.value })} 
                  required 
                  placeholder="e.g. Ground Floor, 1st Floor, Cellar, Godown-A" 
                />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Description / Notes (Optional)</label>
                <input 
                  type="text" 
                  className="input" 
                  value={floorForm.description} 
                  onChange={e => setFloorForm({ ...floorForm, description: e.target.value })} 
                  placeholder="e.g. Main storage for 50kg rice bags" 
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeFloorModal}>Cancel</button>
                <button type="submit" className="btn btn-blue">
                  <i className="fas fa-save"></i> {editFloorId ? "Update Floor" : "Save Floor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PARTY */}
      {showPartyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-hdr">
              <div className="modal-title">
                <i className="fas fa-address-book" style={{ color: '#2563eb' }}></i> {editPartyId ? "Edit Party Details" : "Add New Party / Supplier"}
              </div>
              <button className="modal-close" onClick={closePartyModal}>&times;</button>
            </div>
            <form onSubmit={handlePartySubmit}>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Party / Company Name</label>
                <input type="text" className="input" value={partyForm.name} onChange={e => setPartyForm({ ...partyForm, name: e.target.value })} required placeholder="e.g. Sri Laxmi Rice Traders" />
              </div>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Shortcut Name (Optional)</label>
                <input type="text" className="input" value={partyForm.shortcut_name} onChange={e => setPartyForm({ ...partyForm, shortcut_name: e.target.value })} placeholder="e.g. SLRT" />
              </div>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Phone Number (10 Digits)</label>
                <input type="text" className="input" maxLength={10} value={partyForm.phone_number} onChange={e => { setPartyForm({ ...partyForm, phone_number: e.target.value }); setPhoneError(''); }} placeholder="e.g. 9876543210" />
                {phoneError && <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.2rem' }}>{phoneError}</span>}
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Place Location</label>
                <select className="input" value={partyForm.place} onChange={e => setPartyForm({ ...partyForm, place: e.target.value })}>
                  <option value="">Select Place</option>
                  {places.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closePartyModal}>Cancel</button>
                <button type="submit" className="btn btn-blue">
                  <i className="fas fa-save"></i> {editPartyId ? "Update Party" : "Save Party"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VARIETY */}
      {showVarietyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-hdr">
              <div className="modal-title">
                <i className="fas fa-wheat-awn" style={{ color: '#10b981' }}></i> {editVarietyId ? "Edit Variety Details" : "Add New Bag Variety"}
              </div>
              <button className="modal-close" onClick={closeVarietyModal}>&times;</button>
            </div>
            <form onSubmit={handleVarietySubmit}>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Variety Name</label>
                <input type="text" className="input" value={varietyForm.name} onChange={e => setVarietyForm({ ...varietyForm, name: e.target.value })} required placeholder="e.g. Sona Masoori Raw 50kg" />
              </div>
              <div className="form-group" style={{ marginBottom: '0.95rem' }}>
                <label>Standard Kgs Per Bag</label>
                <input type="number" step="0.01" className="input" value={varietyForm.kgs_per_bag} onChange={e => setVarietyForm({ ...varietyForm, kgs_per_bag: e.target.value })} required placeholder="50.00" />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label>Variety Photo {editVarietyId ? <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'none' }}>(Leave empty to keep current)</span> : <span style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'none' }}>(Optional)</span>}</label>
                <input type="file" accept="image/*" className="input" onChange={e => handlePhotoChange(e.target.files[0])} />
                {varietyForm.photo_data && (
                  <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <img src={varietyForm.photo_data} alt="Preview" style={{ width: '45px', height: '45px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                    <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                      ✓ Optimized: {varietyForm.photo_size_kb || 15} KB (Ultra-fast Cloud Storage)
                    </span>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeVarietyModal}>Cancel</button>
                <button type="submit" className="btn btn-green">
                  <i className="fas fa-save"></i> {editVarietyId ? "Update Variety" : "Save Variety"}
                </button>
              </div>
            </form>
          </div>
        </div>
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

      {/* FULL-SIZE PHOTO PREVIEW LIGHTBOX */}
      {previewPhoto && (
        <div 
          className="modal-overlay" 
          onClick={() => setPreviewPhoto(null)} 
          style={{ zIndex: 99999, background: 'rgba(15, 23, 42, 0.82)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div 
            className="modal" 
            onClick={e => e.stopPropagation()} 
            style={{ maxWidth: '520px', width: '92%', padding: '1.25rem', borderRadius: '12px', background: '#ffffff', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <i className="fas fa-image" style={{ color: '#2563eb' }}></i> {previewPhoto.name}
                </h3>
                {previewPhoto.kgs && (
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                    Standard Weight: {previewPhoto.kgs} kg/bag
                  </span>
                )}
              </div>
              <button 
                className="modal-close" 
                onClick={() => setPreviewPhoto(null)}
                style={{ fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                &times;
              </button>
            </div>

            <div style={{ textAlign: 'center', background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <img 
                src={previewPhoto.src} 
                alt={previewPhoto.name} 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '400px', 
                  objectFit: 'contain', 
                  borderRadius: '8px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.1)'
                }} 
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.5rem' }}>
              <a 
                href={previewPhoto.src} 
                download={`${previewPhoto.name.replace(/\s+/g, '_')}_bag.jpg`} 
                className="btn btn-blue btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
              >
                <i className="fas fa-download"></i> Download Photo
              </a>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreviewPhoto(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PLACE BAG ORDER (OWNER ONLY) */}
      {showOrderModal && orderModalVariety && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '440px' }}>
            <div className="modal-hdr">
              <div className="modal-title" style={{ color: '#2563eb' }}>
                <i className="fas fa-cart-shopping"></i> Place Bag Order
              </div>
              <button className="modal-close" onClick={() => setShowOrderModal(false)}>&times;</button>
            </div>

            <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{orderModalVariety.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', display: 'flex', gap: '12px' }}>
                <span>Weight: <strong>{orderModalVariety.kgs_per_bag} kg</strong></span>
                <span>Current Stock: <strong style={{ color: (orderModalVariety.current_stock_bags || 0) < 2000 ? '#dc2626' : '#16a34a' }}>{(orderModalVariety.current_stock_bags || 0).toLocaleString()} Bags</strong></span>
              </div>
            </div>

            <form onSubmit={handleSaveOrder}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.25rem' }}>
                <div className="form-group">
                  <label style={{ fontWeight: 700, fontSize: '0.78rem', color: '#334155' }}>Order Date *</label>
                  <input 
                    type="date"
                    className="input"
                    value={orderForm.order_date}
                    onChange={e => setOrderForm(prev => ({ ...prev, order_date: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 700, fontSize: '0.78rem', color: '#334155' }}>Bags Ordered Quantity *</label>
                  <input 
                    type="number"
                    className="input"
                    value={orderForm.order_bags}
                    onChange={e => setOrderForm(prev => ({ ...prev, order_bags: e.target.value }))}
                    min="1"
                    required
                    placeholder="e.g. 5000"
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 700, fontSize: '0.78rem', color: '#334155' }}>Supplier / Vendor / Notes (Optional)</label>
                  <input 
                    type="text"
                    className="input"
                    value={orderForm.order_notes}
                    onChange={e => setOrderForm(prev => ({ ...prev, order_notes: e.target.value }))}
                    placeholder="e.g. Balaji Printers / Delivery next week"
                  />
                </div>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {orderModalVariety.order_placed ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.78rem' }}
                    onClick={() => {
                      handleClearOrder(orderModalVariety);
                      setShowOrderModal(false);
                    }}
                  >
                    <i className="fas fa-check" style={{ marginRight: '4px' }}></i> Mark Received
                  </button>
                ) : <div />}

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowOrderModal(false)} disabled={savingOrder}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-blue" disabled={savingOrder}>
                    <i className={savingOrder ? "fas fa-spinner fa-spin" : "fas fa-check"} style={{ marginRight: '4px' }}></i>
                    {savingOrder ? 'Saving...' : 'Save Bag Order'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterCreation;
