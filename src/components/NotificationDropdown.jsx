import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bell, Clock, Mail, CheckCheck, Wrench, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notificationsApi } from '../api/notifications';
import { complaintsApi } from '../api/complaints';
import { lostAndFoundApi } from '../api/lostAndFound';

const STATUS_BADGE_STYLES = {
  Submitted: { bg: '#eff6ff', color: '#1d4ed8' },
  'Under Review': { bg: '#fef3c7', color: '#b45309' },
  Assigned: { bg: '#e0e7ff', color: '#4338ca' },
  'In Progress': { bg: '#ede9fe', color: '#6d28d9' },
  Resolved: { bg: '#dcfce7', color: '#15803d' },
  Rejected: { bg: '#fee2e2', color: '#b91c1c' },
  'Match Found': { bg: '#fef3c7', color: '#b45309' },
  'Claim Approved': { bg: '#dcfce7', color: '#15803d' },
  'Claim APPROVED': { bg: '#dcfce7', color: '#15803d' },
  'Claim HANDED_OVER': { bg: '#dcfce7', color: '#15803d' },
  Returned: { bg: '#dcfce7', color: '#15803d' },
  'Claim REJECTED': { bg: '#fee2e2', color: '#b91c1c' },
};

const getStageBadgeStyle = (stage) => {
  if (STATUS_BADGE_STYLES[stage]) return STATUS_BADGE_STYLES[stage];
  if ((stage || '').toLowerCase().includes('found') || (stage || '').toLowerCase().includes('lost')) {
    return { bg: '#f1f5f9', color: '#334155' };
  }
  return { bg: '#e0e7ff', color: '#4338ca' };
};

export const NotificationDropdown = ({ showToast, onChangeModule }) => {
  const { user, isAdmin, isStaff } = useAuth();
  const userEmail = (user?.email || '').trim().toLowerCase();
  const userRole = (user?.role || 'STUDENT').toUpperCase();
  const readStorageKey = `campusfix_read_emails_${userEmail || 'guest'}`;

  const [complaints, setComplaints] = useState([]);
  const [lfItems, setLfItems] = useState([]);
  const [lfClaims, setLfClaims] = useState([]);
  const [serverEmails, setServerEmails] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('ALL'); // 'ALL' | 'COMPLAINT' | 'LOST_FOUND'
  const [readIds, setReadIds] = useState(() => {
    try {
      const raw = localStorage.getItem(readStorageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const initializedRef = useRef(false);
  const previousComplaintStatusRef = useRef(new Map());
  const complaintsLoadedRef = useRef(false);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // Sync read IDs and reset listener baselines when logged-in email changes
  useEffect(() => {
    knownIdsRef.current = new Set();
    initializedRef.current = false;
    previousComplaintStatusRef.current = new Map();
    complaintsLoadedRef.current = false;
    try {
      const raw = localStorage.getItem(readStorageKey);
      setReadIds(raw ? JSON.parse(raw) : []);
    } catch {
      setReadIds([]);
    }
  }, [readStorageKey]);

  // Subscribe to real-time Firestore updates + sync server email logs
  useEffect(() => {
    if (!user) return;
    let active = true;
    const userId = user?.uid || user?.id || '';

    const handleComplaintsSnapshot = (list) => {
      if (!active) return;
      const safeList = Array.isArray(list) ? list : [];

      const nextStatusMap = new Map();
      safeList.forEach((c) => {
        const key = String(c.formatted_id || c.complaint_id || c.id || '');
        if (!key) return;
        const currentStatus = c.status || 'Submitted';
        nextStatusMap.set(key, currentStatus);

        if (complaintsLoadedRef.current) {
          const prevStatus = previousComplaintStatusRef.current.get(key);
          if (prevStatus && prevStatus !== currentStatus) {
            const title = c.complaint_title || c.title || 'Maintenance Issue';
            const toastType =
              currentStatus === 'Resolved'
                ? 'success'
                : currentStatus === 'Rejected'
                ? 'warning'
                : 'info';
            if (showToastRef.current) {
              showToastRef.current(
                `Complaint #${key} ("${title}") status changed to ${currentStatus}`,
                toastType
              );
            }
          }
        }
      });

      previousComplaintStatusRef.current = nextStatusMap;
      complaintsLoadedRef.current = true;
      setComplaints(safeList);
    };

    const fetchServerData = async () => {
      try {
        const [emails, latestComplaints] = await Promise.all([
          notificationsApi.getEmailLogs(),
          complaintsApi.getComplaints(userId, userRole, userEmail),
        ]);
        if (!active) return;
        if (Array.isArray(emails)) setServerEmails(emails);
        else if (emails && Array.isArray(emails.emails)) setServerEmails(emails.emails);
        else if (emails && Array.isArray(emails.results)) setServerEmails(emails.results);

        if (Array.isArray(latestComplaints)) {
          handleComplaintsSnapshot(latestComplaints);
        }
      } catch {
        // ignore background sync failures
      }
    };

    fetchServerData();
    const interval = setInterval(fetchServerData, 12000);

    const unsubComplaints = complaintsApi.subscribeComplaints(
      userId,
      userRole,
      userEmail,
      handleComplaintsSnapshot
    );

    const unsubItems = lostAndFoundApi.subscribeItems((list) => {
      if (active) setLfItems(Array.isArray(list) ? list : []);
    });

    const unsubClaims = lostAndFoundApi.subscribeClaims((list) => {
      if (active) setLfClaims(Array.isArray(list) ? list : []);
    });

    return () => {
      active = false;
      clearInterval(interval);
      if (typeof unsubComplaints === 'function') unsubComplaints();
      if (typeof unsubItems === 'function') unsubItems();
      if (typeof unsubClaims === 'function') unsubClaims();
    };
  }, [user, userRole, userEmail]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build unified live email notifications from complaints, Lost & Found, and backend email logs
  const emailNotifications = useMemo(() => {
    const map = new Map();
    const isAdminOrStaff = isAdmin || isStaff;

    const addEntry = (entry) => {
      if (!entry || !entry.id) return;
      const key = entry.dedupeKey || entry.id;
      if (!map.has(key)) {
        map.set(key, entry);
      }
    };

    // 1. Complaint Lifecycle Email Alerts (Submitted -> Under Review -> Assigned -> In Progress -> Resolved)
    complaints.forEach((c) => {
      const compEmail = (c.student_email || c.studentEmail || c.student_details?.email || '').trim().toLowerCase();
      if (!isAdminOrStaff && userEmail && compEmail !== userEmail) return;

      const ticketCode = c.formatted_id || c.complaint_id || String(c.id);
      const title = c.complaint_title || c.title || 'Maintenance Issue';
      const recipientEmail = compEmail || userEmail || 'student@campusfix.edu';
      const recipientName = c.student_name || c.studentName || 'Student';

      // Initial Submitted email
      addEntry({
        id: `cmp-${ticketCode}-Submitted`,
        dedupeKey: `COMPLAINT:${ticketCode}:Submitted`,
        category_type: 'COMPLAINT',
        complaint_id: ticketCode,
        status_stage: 'Submitted',
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        subject: `Ticket Raised: ${title}`,
        message: `Complaint #${ticketCode} (${c.category || 'General'}) submitted and queued for Admin review.`,
        sent_at: c.created_at || c.createdAt || new Date().toISOString(),
      });

      const history = Array.isArray(c.status_history) ? c.status_history : [];
      const seenStages = new Set(['Submitted']);

      history.forEach((h, idx) => {
        const stage = h?.new_status;
        if (!stage) return;
        seenStages.add(stage);

        let message = h.notes || `Status updated to ${stage}.`;
        if (stage === 'Under Review') {
          message = `Admin placed complaint #${ticketCode} Under Review.`;
        } else if (stage === 'Assigned') {
          message = `Staff assigned to #${ticketCode}${c.assigned_staff_details?.name ? ` (${c.assigned_staff_details.name})` : ''}.`;
        } else if (stage === 'In Progress') {
          message = `Work is now In Progress on your complaint #${ticketCode}.`;
        } else if (stage === 'Resolved') {
          message = `Issue #${ticketCode} has been Resolved!`;
        } else if (stage === 'Rejected') {
          message = `Complaint #${ticketCode} was closed (${stage}).`;
        }

        addEntry({
          id: `cmp-${ticketCode}-${stage}-${idx}`,
          dedupeKey: `COMPLAINT:${ticketCode}:${stage}`,
          category_type: 'COMPLAINT',
          complaint_id: ticketCode,
          status_stage: stage,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          subject: `${ticketCode} • ${stage}: ${title}`,
          message,
          sent_at: h.timestamp || c.updated_at || c.created_at || new Date().toISOString(),
        });
      });

      // Fallback if status changed without a status_history entry
      if (c.status && !seenStages.has(c.status)) {
        addEntry({
          id: `cmp-${ticketCode}-${c.status}`,
          dedupeKey: `COMPLAINT:${ticketCode}:${c.status}`,
          category_type: 'COMPLAINT',
          complaint_id: ticketCode,
          status_stage: c.status,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          subject: `${ticketCode} • ${c.status}: ${title}`,
          message: `Your complaint #${ticketCode} status is now ${c.status}.`,
          sent_at: c.updated_at || c.resolved_at || c.created_at || new Date().toISOString(),
        });
      }
    });

    // 2. Lost & Found Email Alerts (Reports, Smart Matches, Claims, Returned)
    lfItems.forEach((item) => {
      const ownerEmail = (item.reporterEmail || item.contactEmail || '').trim().toLowerCase();
      const itemCode = item.itemCode || item.item_code || String(item.id);
      const itemTitle = item.itemName || item.title || 'Campus Item';
      const isMine = Boolean(userEmail && ownerEmail === userEmail);

      if (isMine || isAdminOrStaff) {
        addEntry({
          id: `lf-${itemCode}-${item.type}`,
          dedupeKey: `LF:${itemCode}:REPORTED`,
          category_type: 'LOST_FOUND',
          item_id: itemCode,
          status_stage: item.type === 'FOUND' ? 'Found Reported' : 'Lost Reported',
          recipient_name: item.reporterName || 'Campus Member',
          recipient_email: ownerEmail || userEmail,
          subject: `${item.type === 'FOUND' ? 'Found' : 'Lost'} Item Listed: ${itemTitle}`,
          message: `Report #${itemCode} at ${item.location || 'Campus'} is active on the Lost & Found board.`,
          sent_at: item.createdAt || item.created_at || new Date().toISOString(),
        });

        if (item.status === 'RETURNED') {
          addEntry({
            id: `lf-${itemCode}-RETURNED`,
            dedupeKey: `LF:${itemCode}:RETURNED`,
            category_type: 'LOST_FOUND',
            item_id: itemCode,
            status_stage: 'Returned',
            recipient_name: item.reporterName || 'Campus Member',
            recipient_email: ownerEmail || userEmail,
            subject: `Item Reunited: ${itemTitle}`,
            message: `Lost & Found report #${itemCode} has been marked as Returned.`,
            sent_at: item.updatedAt || item.createdAt || new Date().toISOString(),
          });
        }
      }

      // Smart match alert: if current user reported a LOST item, notify when another user logs a matching active FOUND item
      if (isMine && item.type === 'LOST' && item.status !== 'RETURNED') {
        const myWords = `${itemTitle} ${item.description || ''}`
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 3);

        lfItems.forEach((cand) => {
          if (!cand || cand.type !== 'FOUND' || cand.status === 'RETURNED') return;
          const candEmail = (cand.reporterEmail || cand.contactEmail || '').trim().toLowerCase();
          if (candEmail === userEmail) return;
          const sameCategory = (cand.category || '').toLowerCase() === (item.category || '').toLowerCase();
          const candText = `${cand.itemName || cand.title || ''} ${cand.description || ''}`.toLowerCase();
          const wordHit = myWords.some((w) => candText.includes(w));
          if (sameCategory && wordHit) {
            const candCode = cand.itemCode || String(cand.id);
            addEntry({
              id: `lf-match-${itemCode}-${candCode}`,
              dedupeKey: `LF_MATCH:${itemCode}:${candCode}`,
              category_type: 'LOST_FOUND',
              item_id: candCode,
              status_stage: 'Match Found',
              recipient_name: user?.name || 'Student',
              recipient_email: userEmail,
              subject: `Possible Match Found: ${cand.itemName || cand.title}`,
              message: `A Found item matching your lost "${itemTitle}" was reported at ${cand.location || 'Campus'}.`,
              sent_at: cand.createdAt || cand.created_at || new Date().toISOString(),
            });
          }
        });
      }
    });

    // 3. Lost & Found Ownership Claims Alerts
    lfClaims.forEach((claim) => {
      const claimEmail = (claim.claimantEmail || claim.claimant_email || '').trim().toLowerCase();
      const relatedItem = lfItems.find(
        (it) => String(it.id) === String(claim.itemId) || String(it.itemCode) === String(claim.itemId)
      );
      const itemOwnerEmail = (relatedItem?.reporterEmail || relatedItem?.contactEmail || '').trim().toLowerCase();
      const isClaimant = Boolean(userEmail && claimEmail === userEmail);
      const isItemOwner = Boolean(userEmail && itemOwnerEmail === userEmail);

      if (!isClaimant && !isItemOwner && !isAdminOrStaff) return;

      const claimCode = claim.claimCode || claim.claim_code || String(claim.id);
      const itemTitle = claim.itemTitle || relatedItem?.itemName || 'Campus Item';

      if (isClaimant || isAdminOrStaff) {
        addEntry({
          id: `clm-${claimCode}-${claim.status || 'PENDING'}`,
          dedupeKey: `CLAIM:${claimCode}:${claim.status || 'PENDING'}`,
          category_type: 'LOST_FOUND',
          item_id: String(claim.itemId || claimCode),
          status_stage: claim.status === 'PENDING' ? 'Claim Submitted' : `Claim ${claim.status}`,
          recipient_name: claim.claimantName || 'Claimant',
          recipient_email: claimEmail || userEmail,
          subject:
            claim.status === 'APPROVED'
              ? `Claim Approved: ${itemTitle}`
              : claim.status === 'HANDED_OVER'
              ? `Item Handed Over: ${itemTitle}`
              : claim.status === 'REJECTED'
              ? `Claim Update: ${itemTitle}`
              : `Claim Submitted: ${itemTitle}`,
          message:
            claim.status === 'APPROVED'
              ? `Your ownership claim #${claimCode} is approved! Collect it at ${relatedItem?.holdingLocation || 'Campus Security Desk'}.`
              : claim.status === 'HANDED_OVER'
              ? `Claim #${claimCode} completed — item handed over.`
              : claim.status === 'REJECTED'
              ? `Claim #${claimCode} was not approved.`
              : `Ownership claim #${claimCode} is awaiting staff verification.`,
          sent_at: claim.verifiedAt || claim.submittedAt || new Date().toISOString(),
        });
      }

      if (isItemOwner && !isClaimant) {
        addEntry({
          id: `clm-owner-${claimCode}`,
          dedupeKey: `CLAIM_OWNER:${claimCode}`,
          category_type: 'LOST_FOUND',
          item_id: String(claim.itemId || claimCode),
          status_stage: 'Claim Received',
          recipient_name: relatedItem?.reporterName || 'Reporter',
          recipient_email: itemOwnerEmail,
          subject: `New Ownership Claim: ${itemTitle}`,
          message: `${claim.claimantName || 'A student'} submitted claim #${claimCode} for your reported item.`,
          sent_at: claim.submittedAt || new Date().toISOString(),
        });
      }
    });

    // 4. Include backend emailLogs if not already represented
    (Array.isArray(serverEmails) ? serverEmails : []).forEach((e) => {
      const recEmail = (e.recipient_email || '').trim().toLowerCase();
      if (!isAdminOrStaff && userEmail && recEmail !== userEmail) return;
      const dedupeKey = e.complaint_id && e.status_stage
        ? `COMPLAINT:${e.complaint_id}:${e.status_stage}`
        : e.item_id && e.status_stage
        ? `LF:${e.item_id}:${e.status_stage}`
        : `SRV:${e.id}`;
      addEntry({
        ...e,
        id: `srv-${e.id}`,
        dedupeKey,
        category_type: e.category_type || 'COMPLAINT',
        status_stage: e.status_stage || 'Update',
        message: e.message || e.subject || 'Automated email dispatch',
      });
    });

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime()
    );
  }, [complaints, lfItems, lfClaims, serverEmails, isAdmin, isStaff, userEmail, user?.name]);

  // Surface a live toast when new Lost & Found match/claim notifications arrive during an active session
  useEffect(() => {
    if (!userEmail) return;
    if (!initializedRef.current) {
      if (complaintsLoadedRef.current || lfItems.length > 0 || serverEmails.length > 0) {
        emailNotifications.forEach((n) => knownIdsRef.current.add(n.id));
        initializedRef.current = true;
      }
      return;
    }

    const newlyArrived = emailNotifications.filter((n) => !knownIdsRef.current.has(n.id));
    if (newlyArrived.length > 0) {
      newlyArrived.forEach((n) => knownIdsRef.current.add(n.id));
      const nonStatusAlert = newlyArrived.find((n) => n.category_type === 'LOST_FOUND');
      if (showToastRef.current && nonStatusAlert) {
        showToastRef.current(`Email Alert: ${nonStatusAlert.subject}`, 'info');
      }
    }
  }, [emailNotifications, lfItems.length, serverEmails.length, userEmail]);

  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => emailNotifications.filter((n) => !readSet.has(n.id)).length,
    [emailNotifications, readSet]
  );

  const filteredEmails = useMemo(() => {
    if (categoryFilter === 'ALL') return emailNotifications;
    return emailNotifications.filter((n) => n.category_type === categoryFilter);
  }, [emailNotifications, categoryFilter]);

  const persistReadIds = (nextIds) => {
    setReadIds(nextIds);
    try {
      localStorage.setItem(readStorageKey, JSON.stringify(nextIds.slice(-300)));
    } catch {
      // ignore storage quota errors
    }
  };

  const handleMarkAllRead = () => {
    const allIds = Array.from(new Set([...readIds, ...emailNotifications.map((n) => n.id)]));
    persistReadIds(allIds);
  };

  const handleEmailClick = (item) => {
    if (!readSet.has(item.id)) {
      persistReadIds([...readIds, item.id]);
    }
    if (onChangeModule) {
      onChangeModule(item.category_type === 'LOST_FOUND' ? 'lost-found' : 'issues');
    }
    setIsOpen(false);
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
        title="Automated Email Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              backgroundColor: '#ef4444',
              color: 'white',
              fontSize: '0.65rem',
              fontWeight: 800,
              borderRadius: '9999px',
              padding: '1px 5px',
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 4px rgba(239, 68, 68, 0.4)',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '380px',
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: '480px',
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
            border: '1px solid #e2e8f0',
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px 10px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#4f46e5',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                }}
              >
                <Mail size={15} />
                <span>Emails ({emailNotifications.length})</span>
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4f46e5',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>

            {/* Category Filter Switcher */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { key: 'ALL', label: `All (${emailNotifications.length})` },
                {
                  key: 'COMPLAINT',
                  label: `Issues (${emailNotifications.filter((n) => n.category_type === 'COMPLAINT').length})`,
                  icon: Wrench,
                },
                {
                  key: 'LOST_FOUND',
                  label: `Lost & Found (${emailNotifications.filter((n) => n.category_type === 'LOST_FOUND').length})`,
                  icon: Search,
                },
              ].map((tab) => {
                const isActive = categoryFilter === tab.key;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCategoryFilter(tab.key)}
                    style={{
                      border: isActive ? '1px solid #c7d2fe' : '1px solid #e2e8f0',
                      background: isActive ? '#eef2ff' : '#ffffff',
                      color: isActive ? '#4338ca' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '4px 9px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {Icon && <Icon size={11} />}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Email List Content */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {filteredEmails.length === 0 ? (
              <div style={{ padding: '28px 20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
                No email notifications yet. Updates for your complaints (Submitted, Under Review, In Progress, Resolved) and Lost &amp; Found reports will appear here automatically.
              </div>
            ) : (
              filteredEmails.map((e) => {
                const isUnread = !readSet.has(e.id);
                const badgeStyle = getStageBadgeStyle(e.status_stage);
                return (
                  <div
                    key={e.id}
                    onClick={() => handleEmailClick(e)}
                    style={{
                      padding: '11px 14px',
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isUnread ? '#f8faff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        {isUnread && (
                          <span
                            style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              backgroundColor: '#4f46e5',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {e.subject || `${e.complaint_id || e.item_id || 'System'} Update`}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: badgeStyle.bg,
                          color: badgeStyle.color,
                          flexShrink: 0,
                        }}
                      >
                        {e.status_stage || e.status || 'SENT'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: '4px', lineHeight: 1.38 }}>
                      {e.message}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px', gap: '8px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        To: <strong>{e.recipient_email || userEmail}</strong>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                        <Clock size={10} />
                        <span>
                          {e.sent_at
                            ? new Date(e.sent_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : 'Just now'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
