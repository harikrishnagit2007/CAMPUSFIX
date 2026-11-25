import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../firebase';
import { apiClient } from './client';

const ITEMS_COLLECTION = 'lost_found';
const CLAIMS_COLLECTION = 'claims';

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('campusfix_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const stripUndefined = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const clean = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) clean[k] = v;
  });
  return clean;
};

const normalizeItem = (data, docId) => {
  if (!data) return null;
  const id = String(docId || data.id || data.itemCode || data.item_code || '');
  const itemName = data.itemName || data.item_name || data.title || 'Campus Item';
  const itemCode = data.itemCode || data.item_code || (id.startsWith('LF-') ? id : `ITM-${id}`);
  const contactEmail = (data.contactEmail || data.contact_email || data.reporterEmail || '').trim().toLowerCase();
  const reporterEmail = (data.reporterEmail || data.reporter_email || contactEmail).trim().toLowerCase();
  const createdAt = data.createdAt || data.created_at || new Date().toISOString();

  return {
    ...data,
    id,
    itemCode,
    item_code: itemCode,
    itemName,
    item_name: itemName,
    title: itemName,
    type: data.type ? data.type.toUpperCase() : 'LOST',
    category: data.category || 'General',
    building: data.building || '',
    location: data.location || data.building || 'Campus Facilities',
    dateOccurred: data.dateOccurred || data.date_occurred || data.date || createdAt.split('T')[0],
    date_occurred: data.dateOccurred || data.date_occurred || data.date || createdAt.split('T')[0],
    date: data.date || data.dateOccurred || data.date_occurred || createdAt.split('T')[0],
    approxTime: data.approxTime || data.approx_time || '',
    approx_time: data.approxTime || data.approx_time || '',
    description: data.description || '',
    identifyingMarks: data.identifyingMarks || data.identifying_marks || '',
    identifying_marks: data.identifyingMarks || data.identifying_marks || '',
    holdingLocation: data.holdingLocation || data.holding_location || '',
    holding_location: data.holdingLocation || data.holding_location || '',
    image: data.image || null,
    status: data.status || 'OPEN',
    reporterId: String(data.reporterId || data.reporter_id || ''),
    reporter_id: String(data.reporterId || data.reporter_id || ''),
    reporterName: data.reporterName || data.reporter_name || '',
    reporter_name: data.reporterName || data.reporter_name || '',
    reporterEmail,
    contactEmail: contactEmail || reporterEmail,
    contact_email: contactEmail || reporterEmail,
    contactPhone: data.contactPhone || data.contact_phone || '',
    contact_phone: data.contactPhone || data.contact_phone || '',
    created_at: createdAt,
    createdAt,
  };
};

const normalizeClaim = (data, docId) => {
  if (!data) return null;
  const id = String(docId || data.id || data.claimCode || data.claim_code || '');
  const claimCode = data.claimCode || data.claim_code || (id.startsWith('CLM-') ? id : `CLM-${id}`);
  const claimantEmail = (data.claimantEmail || data.claimant_email || '').trim().toLowerCase();
  const submittedAt = data.submittedAt || data.submitted_at || new Date().toISOString();

  return {
    ...data,
    id,
    claimCode,
    claim_code: claimCode,
    itemId: String(data.itemId || data.item_id || ''),
    item_id: String(data.itemId || data.item_id || ''),
    itemTitle: data.itemTitle || data.item_title || '',
    item_title: data.itemTitle || data.item_title || '',
    claimantId: String(data.claimantId || data.claimant_id || ''),
    claimant_id: String(data.claimantId || data.claimant_id || ''),
    claimantName: data.claimantName || data.claimant_name || '',
    claimant_name: data.claimantName || data.claimant_name || '',
    claimantEmail,
    claimant_email: claimantEmail,
    claimantPhone: data.claimantPhone || data.claimant_phone || '',
    claimant_phone: data.claimantPhone || data.claimant_phone || '',
    ownershipProof: data.ownershipProof || data.ownership_proof || '',
    ownership_proof: data.ownershipProof || data.ownership_proof || '',
    status: data.status || 'PENDING',
    adminNotes: data.adminNotes || data.admin_notes || '',
    admin_notes: data.adminNotes || data.admin_notes || '',
    submittedAt,
    submitted_at: submittedAt,
  };
};

const filterItems = (items, params = {}) => {
  let list = [...items];
  if (params.type && params.type !== 'ALL') {
    list = list.filter((i) => i.type === params.type.toUpperCase());
  }
  if (params.category && params.category !== 'ALL' && params.category !== 'All Categories') {
    list = list.filter((i) => i.category === params.category);
  }
  if (params.building && params.building !== 'ALL' && params.building !== 'All Locations') {
    list = list.filter((i) => i.building === params.building || (i.location || '').includes(params.building));
  }
  if (params.status && params.status !== 'ALL') {
    list = list.filter((i) => i.status === params.status);
  }
  if (params.email) {
    const cleanEmail = params.email.trim().toLowerCase();
    list = list.filter((i) => (i.reporterEmail || i.contactEmail || '').toLowerCase() === cleanEmail);
  }
  const search = (params.query || params.search || '').trim().toLowerCase();
  if (search) {
    list = list.filter(
      (i) =>
        (i.itemName || '').toLowerCase().includes(search) ||
        (i.description || '').toLowerCase().includes(search) ||
        (i.location || '').toLowerCase().includes(search) ||
        (i.itemCode || '').toLowerCase().includes(search)
    );
  }
  return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
};

const mergeByKey = (primaryList, secondaryList, keyFn, dateFn) => {
  const map = new Map();
  (secondaryList || []).forEach((item) => {
    if (item) map.set(keyFn(item), item);
  });
  (primaryList || []).forEach((item) => {
    if (item) {
      const k = keyFn(item);
      const existing = map.get(k);
      if (!existing || new Date(dateFn(item) || 0) >= new Date(dateFn(existing) || 0)) {
        map.set(k, item);
      }
    }
  });
  return Array.from(map.values()).sort(
    (a, b) => new Date(dateFn(b) || 0).getTime() - new Date(dateFn(a) || 0).getTime()
  );
};

export const lostAndFoundApi = {
  /**
   * Real-time Firestore subscription for Lost & Found items
   */
  subscribeItems: (onUpdate, onError) => {
    return onSnapshot(
      collection(db, ITEMS_COLLECTION),
      async (snapshot) => {
        const fsItems = snapshot.docs.map((d) => normalizeItem(d.data(), d.id));
        let apiItems = [];
        try {
          const response = await apiClient('/lost-found/items', { method: 'GET', silentError: true });
          if (Array.isArray(response)) {
            apiItems = response.map((i) => normalizeItem(i, i.itemCode || i.id));
          }
        } catch {
          // ignore
        }
        const merged = mergeByKey(
          fsItems,
          apiItems,
          (i) => String(i.itemCode || i.id),
          (i) => i.updatedAt || i.createdAt
        );
        if (onUpdate) onUpdate(merged);
      },
      (error) => {
        console.warn('[lostAndFoundApi] subscribeItems notice:', error);
        if (onError) onError(error);
      }
    );
  },

  /**
   * Real-time Firestore subscription for Claims
   */
  subscribeClaims: (onUpdate, onError) => {
    return onSnapshot(
      collection(db, CLAIMS_COLLECTION),
      async (snapshot) => {
        const fsClaims = snapshot.docs.map((d) => normalizeClaim(d.data(), d.id));
        let apiClaims = [];
        try {
          const response = await apiClient('/lost-found/claims', { method: 'GET', silentError: true });
          if (Array.isArray(response)) {
            apiClaims = response.map((c) => normalizeClaim(c, c.claimCode || c.id));
          }
        } catch {
          // ignore
        }
        const merged = mergeByKey(
          fsClaims,
          apiClaims,
          (c) => String(c.claimCode || c.id),
          (c) => c.verifiedAt || c.submittedAt
        );
        if (onUpdate) onUpdate(merged);
      },
      (error) => {
        console.warn('[lostAndFoundApi] subscribeClaims notice:', error);
        if (onError) onError(error);
      }
    );
  },

  /**
   * GET Lost & Found items (Firestore primary)
   */
  getItems: async (params = {}) => {
    let fsItems = [];
    try {
      const snapshot = await getDocs(collection(db, ITEMS_COLLECTION));
      fsItems = snapshot.docs.map((d) => normalizeItem(d.data(), d.id));
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.LIST, ITEMS_COLLECTION);
      } catch {
        // Fallback to API
      }
    }

    let apiItems = [];
    try {
      const response = await apiClient('/lost-found/items', { method: 'GET', silentError: true });
      if (Array.isArray(response)) {
        apiItems = response.map((i) => normalizeItem(i, i.itemCode || i.id));
      }
    } catch {
      // ignore
    }

    const merged = mergeByKey(
      fsItems,
      apiItems,
      (i) => String(i.itemCode || i.id),
      (i) => i.updatedAt || i.createdAt
    );
    return filterItems(merged, params);
  },

  /**
   * GET single Lost & Found item
   */
  getItemById: async (id) => {
    const docId = String(id);
    try {
      const snap = await getDoc(doc(db, ITEMS_COLLECTION, docId));
      if (snap.exists()) return normalizeItem(snap.data(), snap.id);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.GET, `${ITEMS_COLLECTION}/${docId}`);
      } catch {
        // fallback
      }
    }
    try {
      const response = await apiClient(`/lost-found/items/${docId}`, { method: 'GET', silentError: true });
      return normalizeItem(response, docId);
    } catch {
      return null;
    }
  },

  /**
   * POST create Lost & Found item in Firestore
   */
  createItem: async (payload) => {
    const stored = getStoredUser();
    const now = new Date().toISOString();
    const itemType = payload.type ? payload.type.toUpperCase() : 'LOST';
    const itemCode =
      payload.itemCode ||
      payload.item_code ||
      `LF-${itemType}-${Date.now().toString().slice(-6)}`;
    const contactEmail = (
      payload.contactEmail ||
      payload.contact_email ||
      payload.reporterEmail ||
      stored?.email ||
      ''
    )
      .trim()
      .toLowerCase();
    const reporterEmail = (
      stored?.email ||
      payload.reporterEmail ||
      contactEmail
    )
      .trim()
      .toLowerCase();

    const docData = stripUndefined({
      id: itemCode,
      itemCode,
      item_code: itemCode,
      type: itemType,
      itemName: payload.itemName || payload.item_name || payload.title || 'Campus Item',
      item_name: payload.itemName || payload.item_name || payload.title || 'Campus Item',
      title: payload.itemName || payload.item_name || payload.title || 'Campus Item',
      category: payload.category || 'General',
      building: payload.building || (payload.location ? payload.location.split('-')[0].trim() : 'Campus Block'),
      location: payload.location || payload.building || 'Campus',
      date: payload.date || payload.dateOccurred || payload.date_occurred || now.split('T')[0],
      dateOccurred: payload.dateOccurred || payload.date_occurred || payload.date || now.split('T')[0],
      approxTime: payload.approxTime || payload.approx_time || '',
      description: payload.description || '',
      identifyingMarks: payload.identifyingMarks || payload.identifying_marks || '',
      holdingLocation: payload.holdingLocation || payload.holding_location || '',
      image: payload.image || null,
      status: payload.status || 'OPEN',
      reporterId: String(payload.reporterId || payload.reporter_id || stored?.uid || stored?.id || ''),
      reporterName: payload.reporterName || payload.reporter_name || stored?.name || 'Campus Member',
      reporterRole: payload.reporterRole || payload.reporter_role || stored?.role || 'STUDENT',
      reporterEmail,
      contactEmail: contactEmail || reporterEmail,
      contact_email: contactEmail || reporterEmail,
      contactPhone: payload.contactPhone || payload.contact_phone || stored?.phone || '',
      createdAt: now,
      created_at: now,
      updatedAt: now,
    });

    const docPath = `${ITEMS_COLLECTION}/${itemCode}`;
    try {
      await setDoc(doc(db, ITEMS_COLLECTION, itemCode), docData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }

    try {
      await apiClient('/lost-found/items', {
        method: 'POST',
        body: docData,
        silentError: true,
      });
    } catch {
      // Secondary API mirror optional
    }

    return normalizeItem(docData, itemCode);
  },

  /**
   * PUT/PATCH update Lost & Found item in Firestore
   */
  updateItem: async (id, payload) => {
    const docId = String(id);
    const stored = getStoredUser();
    const now = new Date().toISOString();
    const docRef = doc(db, ITEMS_COLLECTION, docId);
    const docPath = `${ITEMS_COLLECTION}/${docId}`;

    let existing = {};
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existing = snap.data();
      } else {
        const apiItem = await apiClient(`/lost-found/items/${docId}`, { method: 'GET', silentError: true });
        if (apiItem && typeof apiItem === 'object' && !apiItem.error) existing = apiItem;
      }
    } catch {
      // continue
    }

    const updates = stripUndefined({
      ...payload,
      updatedAt: now,
      updatedByEmail: (stored?.email || '').trim().toLowerCase(),
    });
    if (updates.type) updates.type = updates.type.toUpperCase();
    if (updates.contactEmail) updates.contactEmail = updates.contactEmail.trim().toLowerCase();

    try {
      await setDoc(docRef, { ...existing, ...updates }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }

    try {
      await apiClient(`/lost-found/items/${docId}`, {
        method: 'PUT',
        body: updates,
        silentError: true,
      });
    } catch {
      // Secondary API mirror optional
    }

    return normalizeItem({ ...existing, ...updates }, docId);
  },

  /**
   * DELETE Lost & Found item from Firestore
   */
  deleteItem: async (id) => {
    const docId = String(id);
    const docPath = `${ITEMS_COLLECTION}/${docId}`;
    try {
      await deleteDoc(doc(db, ITEMS_COLLECTION, docId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, docPath);
    }

    try {
      await apiClient(`/lost-found/items/${docId}`, {
        method: 'DELETE',
        silentError: true,
      });
    } catch {
      // Secondary API mirror optional
    }

    return { success: true };
  },

  /**
   * POST submit ownership claim in Firestore
   */
  submitClaim: async (payload) => {
    const stored = getStoredUser();
    const now = new Date().toISOString();
    const claimCode = payload.claimCode || `CLM-${Date.now().toString().slice(-6)}`;
    const claimantEmail = (payload.claimantEmail || payload.claimant_email || stored?.email || '')
      .trim()
      .toLowerCase();

    const docData = stripUndefined({
      id: claimCode,
      claimCode,
      claim_code: claimCode,
      itemId: String(payload.itemId || payload.item_id || ''),
      itemTitle: payload.itemTitle || payload.item_title || 'Campus Item',
      claimantId: String(payload.claimantId || payload.claimant_id || stored?.uid || stored?.id || ''),
      claimantName: payload.claimantName || payload.claimant_name || stored?.name || 'Claimant',
      claimantEmail,
      claimant_email: claimantEmail,
      claimantPhone: payload.claimantPhone || payload.claimant_phone || stored?.phone || '',
      ownershipProof: payload.ownershipProof || payload.ownership_proof || '',
      status: payload.status || 'PENDING',
      adminNotes: payload.adminNotes || payload.admin_notes || '',
      submittedAt: now,
      submitted_at: now,
    });

    const docPath = `${CLAIMS_COLLECTION}/${claimCode}`;
    try {
      await setDoc(doc(db, CLAIMS_COLLECTION, claimCode), docData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }

    try {
      await apiClient('/lost-found/claims', {
        method: 'POST',
        body: docData,
        silentError: true,
      });
    } catch {
      // Secondary API mirror optional
    }

    return normalizeClaim(docData, claimCode);
  },

  /**
   * GET ownership claims from Firestore
   */
  getClaims: async (params = {}) => {
    let fsClaims = [];
    try {
      const snapshot = await getDocs(collection(db, CLAIMS_COLLECTION));
      fsClaims = snapshot.docs.map((d) => normalizeClaim(d.data(), d.id));
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.LIST, CLAIMS_COLLECTION);
      } catch {
        // fallback
      }
    }

    let apiClaims = [];
    try {
      const response = await apiClient('/lost-found/claims', { method: 'GET', silentError: true });
      if (Array.isArray(response)) {
        apiClaims = response.map((c) => normalizeClaim(c, c.claimCode || c.id));
      }
    } catch {
      // ignore
    }

    let list = mergeByKey(
      fsClaims,
      apiClaims,
      (c) => String(c.claimCode || c.id),
      (c) => c.verifiedAt || c.submittedAt
    );

    if (params.status && params.status !== 'ALL') {
      list = list.filter((c) => c.status === params.status);
    }
    if (params.claimantId) {
      list = list.filter((c) => String(c.claimantId) === String(params.claimantId));
    }
    if (params.claimantEmail) {
      const targetEmail = params.claimantEmail.trim().toLowerCase();
      list = list.filter((c) => c.claimantEmail === targetEmail);
    }

    return list;
  },

  /**
   * PATCH update claim status + update linked item status
   */
  updateClaimStatus: async (claimId, newStatus, adminNotes = '') => {
    const docId = String(claimId);
    const stored = getStoredUser();
    const now = new Date().toISOString();
    const docRef = doc(db, CLAIMS_COLLECTION, docId);
    const docPath = `${CLAIMS_COLLECTION}/${docId}`;

    let existing = {};
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        existing = snap.data();
      } else {
        const allClaims = await apiClient('/lost-found/claims', { method: 'GET', silentError: true });
        if (Array.isArray(allClaims)) {
          const matched = allClaims.find((c) => String(c.id) === docId || String(c.claimCode) === docId);
          if (matched) existing = matched;
        }
      }
    } catch {
      // continue
    }

    const updates = {
      status: newStatus,
      adminNotes: adminNotes || existing.adminNotes || '',
      verifiedAt: now,
      verifiedByEmail: (stored?.email || '').trim().toLowerCase(),
    };

    try {
      await setDoc(docRef, { ...existing, ...updates }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }

    // Sync linked Lost & Found item status
    const targetItemId = existing.itemId || existing.item_id;
    if (targetItemId) {
      const nextItemStatus =
        newStatus === 'HANDED_OVER'
          ? 'RETURNED'
          : newStatus === 'APPROVED'
          ? 'CLAIMED'
          : newStatus === 'REJECTED'
          ? 'OPEN'
          : null;
      if (nextItemStatus) {
        try {
          await lostAndFoundApi.updateItem(String(targetItemId), { status: nextItemStatus });
        } catch {
          // ignore if item was removed
        }
      }
    }

    try {
      await apiClient(`/lost-found/claims/${docId}/status`, {
        method: 'PATCH',
        body: { status: newStatus, adminNotes },
        silentError: true,
      });
    } catch {
      // Secondary API mirror optional
    }

    return { success: true, claim: normalizeClaim({ ...existing, ...updates }, docId) };
  },

  /**
   * GET accurate stats from Firestore
   */
  getStats: async () => {
    try {
      const [items, claims] = await Promise.all([
        lostAndFoundApi.getItems(),
        lostAndFoundApi.getClaims(),
      ]);
      const totalLost = items.filter((i) => i.type === 'LOST').length;
      const totalFound = items.filter((i) => i.type === 'FOUND').length;
      const pendingClaims = claims.filter((c) => c.status === 'PENDING').length;
      const returnedFromItems = items.filter((i) => i.status === 'RETURNED').length;
      const returnedFromClaims = claims.filter((c) => c.status === 'APPROVED' || c.status === 'HANDED_OVER').length;
      const returnedCount = Math.max(returnedFromItems, returnedFromClaims);
      return { totalLost, totalFound, pendingClaims, returnedCount };
    } catch (error) {
      console.error('[lostAndFoundApi] getStats error:', error);
      return { totalLost: 0, totalFound: 0, pendingClaims: 0, returnedCount: 0 };
    }
  },

  /**
   * Live database match finder for AI Recovery Assistant (queries Firestore + API)
   */
  searchDatabaseMatches: async (queryInput = {}, prefetchedItems = null) => {
    try {
      const items = Array.isArray(prefetchedItems)
        ? prefetchedItems
        : await lostAndFoundApi.getItems();

      const stopWords = new Set(['the', 'and', 'for', 'with', 'was', 'near', 'from', 'that', 'this', 'item', 'lost', 'found', 'my', 'our']);
      const tokenize = (str) =>
        String(str || '')
          .toLowerCase()
          .split(/[\s,.;:!?()[\]{}"'/\\-]+/)
          .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
          .filter((w) => w.length >= 2 && !stopWords.has(w));

      const whatRaw = (queryInput.lostWhat || queryInput.itemName || queryInput.title || '').trim().toLowerCase();
      const whatWords = tokenize(whatRaw);
      const marksRaw = (queryInput.lostMarks || queryInput.identifyingMarks || '').trim().toLowerCase();
      const markWords = tokenize(marksRaw);
      const areaRaw = (queryInput.lostArea || '').trim().toLowerCase();
      const areaWords = tokenize(areaRaw);
      const category = (queryInput.lostCategory || queryInput.category || '').trim();
      const building = (queryInput.lostWhere || queryInput.building || '').trim();
      const lostWhen = (queryInput.lostWhen || queryInput.date || '').trim();

      const candidates = items.filter((i) => i && i.status !== 'CLOSED');

      const scored = candidates
        .map((candidate) => {
          let score = 0;
          const reasons = [];

          const candTitle = String(candidate.itemName || candidate.title || candidate.item_name || '').toLowerCase();
          const candDesc = String(candidate.description || '').toLowerCase();
          const candMarks = String(candidate.identifyingMarks || candidate.identifying_marks || '').toLowerCase();
          const candLoc = String(candidate.location || candidate.building || '').toLowerCase();
          const candCat = String(candidate.category || '').toLowerCase();
          const candCode = String(candidate.itemCode || candidate.item_code || '').toLowerCase();
          const combinedText = `${candTitle} ${candDesc} ${candMarks} ${candLoc} ${candCode}`;

          // 1. Phrase & Title/Keyword matching
          let hasTextMatch = false;
          if (whatRaw.length >= 3 && (candTitle.includes(whatRaw) || candDesc.includes(whatRaw) || candMarks.includes(whatRaw))) {
            score += 48;
            hasTextMatch = true;
            reasons.push(`Direct match for "${queryInput.lostWhat || queryInput.itemName}"`);
          } else if (whatWords.length > 0) {
            const titleHits = whatWords.filter((w) => candTitle.includes(w));
            const bodyHits = whatWords.filter((w) => !titleHits.includes(w) && combinedText.includes(w));
            if (titleHits.length > 0) {
              score += Math.min(45, titleHits.length * 25);
              hasTextMatch = true;
              reasons.push(`Title matched: ${titleHits.join(', ')}`);
            }
            if (bodyHits.length > 0) {
              score += Math.min(30, bodyHits.length * 16);
              hasTextMatch = true;
              reasons.push(`Details matched: ${bodyHits.join(', ')}`);
            }
          }

          // 2. Distinguishing marks / features
          if (marksRaw.length >= 3 && (candMarks.includes(marksRaw) || candDesc.includes(marksRaw))) {
            score += 32;
            hasTextMatch = true;
            reasons.push(`Distinguishing feature matched`);
          } else if (markWords.length > 0) {
            const markHits = markWords.filter((w) => combinedText.includes(w));
            if (markHits.length > 0) {
              score += Math.min(30, markHits.length * 15);
              hasTextMatch = true;
              reasons.push(`Marks matched: ${markHits.join(', ')}`);
            }
          }

          // 3. Category matching
          let hasCategoryMatch = false;
          if (category && category !== 'All Categories' && candCat === category.toLowerCase()) {
            score += 22;
            hasCategoryMatch = true;
            reasons.push(`Category: ${candidate.category}`);
          }

          // 4. Building & Specific Area matching
          let hasLocationMatch = false;
          if (building && building !== 'All Locations' && candLoc.includes(building.toLowerCase())) {
            score += 20;
            hasLocationMatch = true;
            reasons.push(`Location: ${candidate.building || building}`);
          }
          if (areaWords.length > 0) {
            const areaHits = areaWords.filter((w) => candLoc.includes(w) || candDesc.includes(w));
            if (areaHits.length > 0) {
              score += Math.min(18, areaHits.length * 10);
              hasLocationMatch = true;
              reasons.push(`Area matched: ${areaHits.join(', ')}`);
            }
          }

          // 5. Date proximity bonus
          if (lostWhen && (candidate.date || candidate.dateOccurred)) {
            const lostMs = new Date(lostWhen).getTime();
            const candMs = new Date(candidate.date || candidate.dateOccurred).getTime();
            if (!Number.isNaN(lostMs) && !Number.isNaN(candMs)) {
              const diffDays = Math.abs(candMs - lostMs) / (1000 * 60 * 60 * 24);
              if (diffDays <= 4) {
                score += 10;
                reasons.push(`Reported around ${candidate.date || candidate.dateOccurred}`);
              }
            }
          }

          // 6. Prioritize active FOUND items over other stored types
          if (candidate.type === 'FOUND' && candidate.status !== 'RETURNED') {
            score += 8;
          }

          const hasAnyQueryText = whatWords.length > 0 || markWords.length > 0 || areaWords.length > 0;
          const isRelevant = hasAnyQueryText
            ? hasTextMatch || (hasCategoryMatch && hasLocationMatch)
            : (hasCategoryMatch || hasLocationMatch);

          if (!isRelevant || score < 20) return null;

          return {
            item: candidate,
            candidate,
            matchScore: Math.min(score, 99),
            confidence: Math.min(score, 99),
            reason: reasons.join('; '),
            reasons,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          // Prefer FOUND items when scores are close
          const aFound = a.candidate.type === 'FOUND' && a.candidate.status !== 'RETURNED' ? 1 : 0;
          const bFound = b.candidate.type === 'FOUND' && b.candidate.status !== 'RETURNED' ? 1 : 0;
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return bFound - aFound;
        });

      return {
        totalScanned: items.length,
        matches: scored,
      };
    } catch (error) {
      console.error('[lostAndFoundApi] searchDatabaseMatches error:', error);
      return { totalScanned: 0, matches: [] };
    }
  },

  /**
   * Smart match finder across Firestore items
   */
  findMatches: async (targetItem) => {
    if (!targetItem) return [];
    const { matches } = await lostAndFoundApi.searchDatabaseMatches({
      lostWhat: targetItem.itemName || targetItem.title || '',
      lostCategory: targetItem.category || '',
      lostWhere: targetItem.building || targetItem.location || '',
      lostMarks: targetItem.identifyingMarks || targetItem.description || '',
      lostWhen: targetItem.date || targetItem.dateOccurred || '',
    });
    const targetType = (targetItem.type || 'LOST').toUpperCase();
    const oppositeType = targetType === 'LOST' ? 'FOUND' : 'LOST';
    return matches.filter(
      (m) => String(m.candidate.id) !== String(targetItem.id) && m.candidate.type === oppositeType && m.candidate.status !== 'RETURNED'
    );
  },
};
