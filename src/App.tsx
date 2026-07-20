import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown,
  AlertCircle, 
  AlertTriangle,
  ShoppingBag, 
  Plus, 
  Search, 
  Trash2, 
  Pencil,
  Download, 
  Calendar, 
  Tag, 
  BarChart3, 
  Info,
  CheckCircle,
  RefreshCw,
  Filter,
  X,
  SlidersHorizontal,
  ChevronDown,
  LayoutGrid,
  CheckSquare,
  Copy,
  Users,
  User as UserIcon,
  ShieldCheck,
  Mail,
  ExternalLink,
  Share2,
  FileSpreadsheet,
  Lock,
  Unlock,
  UserPlus,
  Cloud,
  Database,
  Server,
  Settings,
  Activity,
  Eye,
  EyeOff,
  HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Transaction, DashboardStats } from './types';
import { INITIAL_TRANSACTIONS } from './initialData';
import { computeStats, formatThaiDate, exportToCSV, exportToAppSheetCSV, getLocalTimestamp } from './utils';
// @ts-expect-error - Vite handles JPG imports natively, but TS lacks declaration
import tsdcLogo from './assets/images/tsdc_logo_bright_blue_1783745223705.jpg';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  initAuth, 
  googleSignIn, 
  logoutUser, 
  findSpreadsheet, 
  createSpreadsheet, 
  prepareSpreadsheetTabs, 
  syncDataToGoogleSheets,
  readDataFromGoogleSheets
} from './lib/firebase';
import { User } from 'firebase/auth';

export default function App() {
  // Load transactions from localStorage or default to initial simplified seeded data
  const cleanTransactions = (list: Transaction[]): Transaction[] => {
    return list.map((t: Transaction) => {
      const cleanNote = [
        'ยอดขายสินค้าไอทีแคมเปญหลัก',
        'ออเดอร์หมวดหมู่เสื้อผ้าแฟชั่น',
        'ยอดโอนสะสมรอบเที่ยงวัน',
        'คำสั่งซื้อเครื่องเขียนและของใช้ในบ้าน',
        'ยอดขายหมวดเครื่องสำอางแคมเปญพิเศษ',
        'ยอดจำหน่ายของสะสมและโมเดลนำเข้า',
        'คำสั่งซื้อสินค้าแคมเปญประจำเดือน 7.7',
        'ยอดขาย Shopee ประจำวัน',
        'ยอดขาย Lazada ประจำวัน',
        'ยอดออเดอร์ปกติ Lazada',
        'ลูกค้ายกเลิกสินค้าพรีออเดอร์',
        'ยอดขายรายวันหมวดหมู่ต่างๆ'
      ];
      const randomNote = cleanNote[Math.floor(Math.random() * cleanNote.length)];
      return {
        ...t,
        note: t.note ? t.note.trim() : randomNote
      };
    });
  };

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('ecom_sales_transactions_v3');
        if (saved) {
          let loaded = JSON.parse(saved);
          const loadedIds = new Set(loaded.map(tx => tx.id));
          const missingInit = INITIAL_TRANSACTIONS.filter(tx => !loadedIds.has(tx.id));
          if (missingInit.length > 0) {
            loaded = [...loaded, ...cleanTransactions(missingInit)];
            loaded.sort((a, b) => {
              if (b.date !== a.date) return b.date.localeCompare(a.date);
              return b.id.localeCompare(a.id);
            });
          }
          return loaded;
        }
      } catch (e) {
        console.error('Error parsing saved transactions:', e);
      }
    }
    return cleanTransactions(INITIAL_TRANSACTIONS);
  });

  // Save transactions to localStorage
  useEffect(() => {
    localStorage.setItem('ecom_sales_transactions_v3', JSON.stringify(transactions));
  }, [transactions]);

  // View Mode: 'ledger' (Main detailed table), 'analytics' (Summaries & Charts), or 'void' (Void tracking dashboard)
  const [activeView, setActiveView] = useState<'ledger' | 'analytics' | 'void'>('ledger');
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'charts'>('daily');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [dateSelectionTransactions, setDateSelectionTransactions] = useState<Transaction[] | null>(null);
  const [selectedQueryDate, setSelectedQueryDate] = useState<string>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [showKpiCards, setShowKpiCards] = useState(true);

  // Sync Success Modal States (for displaying a Google Sheets preview window after saving updates)
  const [isSyncSuccessModalOpen, setIsSyncSuccessModalOpen] = useState<boolean>(false);
  const [syncSuccessModalTx, setSyncSuccessModalTx] = useState<Transaction | null>(null);
  const [syncSuccessAction, setSyncSuccessAction] = useState<'save' | 'delete'>('save');
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'success' | 'offline_success' | 'failed'>('offline_success');

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'shopee' | 'lazada'>('all');
  const [filterType, setFilterType] = useState<'all' | 'sale' | 'void'>('all');
  const [summaryStartDate, setSummaryStartDate] = useState<string>('');
  const [summaryEndDate, setSummaryEndDate] = useState<string>('');
  const [voidStartDate, setVoidStartDate] = useState<string>('');
  const [voidEndDate, setVoidEndDate] = useState<string>('');
  const [isVoidReasonsCollapsed, setIsVoidReasonsCollapsed] = useState<boolean>(false);

  // Simplified Single-Form State for Modal
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    platform: 'shopee' as 'shopee' | 'lazada',
    type: 'sale' as 'sale' | 'void',
    amount: '',
    orders: '',
    items: '',
    note: '',
    staffCode: 'Auehen'
  });

  // Google Sheets simulated connection state
  const [sheetConnection, setSheetConnection] = useState<'disconnected' | 'connecting' | 'connected'>(() => {
    return (localStorage.getItem('ecom_sheets_connected_v3') as any) || 'disconnected';
  });

  // User Role / Access Status: 'visitor' | 'user' | 'admin'
  const [userRole, setUserRole] = useState<'visitor' | 'user' | 'admin'>(() => {
    return (localStorage.getItem('ecom_user_role') as 'visitor' | 'user' | 'admin') || 'visitor';
  });

  const [targetRoleToUnlock, setTargetRoleToUnlock] = useState<'user' | 'admin'>('user');

  // Dynamic list of Admin Emails (for verifying and granting admin privileges)
  const [adminEmails, setAdminEmails] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ecom_admin_emails');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Error loading admin emails:', e);
    }
    return ['muaynatpattha@gmail.com', 'natthawut.pay5444@gmail.com'];
  });

  // Save admin emails whenever changed
  useEffect(() => {
    localStorage.setItem('ecom_admin_emails', JSON.stringify(adminEmails));
  }, [adminEmails]);

  const [isAdminManagerOpen, setIsAdminManagerOpen] = useState<boolean>(false);
  const [newAdminEmail, setNewAdminEmail] = useState<string>('');

  // Manage user accounts for Authentication & individual logs
  const [userAccounts, setUserAccounts] = useState<{ userCode: string; password: string; role: 'user' | 'admin' }[]>(() => {
    try {
      const saved = localStorage.getItem('ecom_user_accounts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error loading user accounts:', e);
    }
    return [
      { userCode: 'Auehen', password: '1234', role: 'user' },
      { userCode: 'CR-140575', password: '1234', role: 'user' },
      { userCode: 'Admin', password: '1234', role: 'admin' },
      { userCode: 'EMP001', password: '1234', role: 'user' }
    ];
  });

  useEffect(() => {
    localStorage.setItem('ecom_user_accounts', JSON.stringify(userAccounts));
  }, [userAccounts]);

  const [loggedInUserCode, setLoggedInUserCode] = useState<string>(() => {
    return localStorage.getItem('ecom_logged_in_user_code') || 'Auehen';
  });

  useEffect(() => {
    localStorage.setItem('ecom_logged_in_user_code', loggedInUserCode);
  }, [loggedInUserCode]);

  const [isEmployeeManagerOpen, setIsEmployeeManagerOpen] = useState<boolean>(false);
  const [newEmployeeCode, setNewEmployeeCode] = useState<string>('');
  const [newEmployeePassword, setNewEmployeePassword] = useState<string>('1234');
  const [newEmployeeRole, setNewEmployeeRole] = useState<'user' | 'admin'>('user');
  const [confirmDeleteUserCode, setConfirmDeleteUserCode] = useState<string | null>(null);

  const [selectedUserCode, setSelectedUserCode] = useState<string>('');

  // Real Google Sheets states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => {
    return localStorage.getItem('ecom_spreadsheet_id') || null;
  });
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const isLastSyncFromSheetRef = useRef<boolean>(false);
  const lastLocalWriteTimeRef = useRef<number>(0);
  const [isPollingSheets, setIsPollingSheets] = useState<boolean>(false);
  const [isPrintingPDF, setIsPrintingPDF] = useState<boolean>(false);

  // AppSheet / Google Sheets Access Password States
  const [appSheetPassword, setAppSheetPassword] = useState<string>(() => {
    return localStorage.getItem('ecom_appsheet_password') || '1234';
  });
  const [enteredPassword, setEnteredPassword] = useState<string>('');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<'sync' | 'open_sheet' | 'switch_to_admin' | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [currentPasswordConfirm, setCurrentPasswordConfirm] = useState<string>('');
  const [newPasswordValue, setNewPasswordValue] = useState<string>('');
  const [showPasswordText, setShowPasswordText] = useState<boolean>(false);

  // Customizable Theme and Colors
  const shopeeColor = '#F53D2D';
  const lazadaColor = '#2563EB';

  const themeStyles = {
    bg: 'bg-[#F4F6F9]',
    card: 'bg-white border-slate-100',
    cardHover: 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.03)]',
    textTitle: 'text-slate-800',
    textMuted: 'text-slate-400',
    border: 'border-slate-200/60',
    bgMuted: 'bg-slate-50/50',
    tableHeader: 'bg-slate-50/70 border-b border-slate-200 text-slate-500',
    toast: 'selection:bg-emerald-100 selection:text-emerald-950',
    themeLabel: 'โหมดสว่างมาตรฐาน'
  };

  // Initialize Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setGoogleAccessToken(token);
        setSheetConnection('connected');
        localStorage.setItem('ecom_sheets_connected_v3', 'connected');
        if (user.email && adminEmails.some(email => email.toLowerCase() === user.email?.toLowerCase())) {
          setUserRole('admin');
          localStorage.setItem('ecom_user_role', 'admin');
        }
      },
      () => {
        setCurrentUser(null);
        setGoogleAccessToken(null);
        setSheetConnection('disconnected');
        localStorage.setItem('ecom_sheets_connected_v3', 'disconnected');
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Auto-hide toast notifications
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Filter transactions based on summary date range
  const summaryFilteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (summaryStartDate && tx.date < summaryStartDate) return false;
      if (summaryEndDate && tx.date > summaryEndDate) return false;
      return true;
    });
  }, [transactions, summaryStartDate, summaryEndDate]);

  // Live calculation of financial metrics
  const stats: DashboardStats = useMemo(() => {
    return computeStats(summaryFilteredTransactions);
  }, [summaryFilteredTransactions]);

  // Filter for void transactions with dedicated date range filtering
  const voidTransactionsWithNotes = useMemo(() => {
    return transactions.filter(tx => {
      if (tx.type !== 'void') return false;
      if (voidStartDate && tx.date < voidStartDate) return false;
      if (voidEndDate && tx.date > voidEndDate) return false;
      return true;
    });
  }, [transactions, voidStartDate, voidEndDate]);

  // Total voided/canceled orders from filtered void transactions
  const totalVoidOrders = useMemo(() => {
    return transactions
      .filter(tx => {
        if (tx.type !== 'void') return false;
        if (voidStartDate && tx.date < voidStartDate) return false;
        if (voidEndDate && tx.date > voidEndDate) return false;
        return true;
      })
      .reduce((sum, tx) => sum + (Number(tx.orders) || 0), 0);
  }, [transactions, voidStartDate, voidEndDate]);

  // Total voided/canceled amount from filtered void transactions
  const totalVoidAmount = useMemo(() => {
    return transactions
      .filter(tx => {
        if (tx.type !== 'void') return false;
        if (voidStartDate && tx.date < voidStartDate) return false;
        if (voidEndDate && tx.date > voidEndDate) return false;
        return true;
      })
      .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  }, [transactions, voidStartDate, voidEndDate]);

  // Helper to quickly apply date range presets for VOID transactions
  const setVoidPresetRange = (rangeType: 'all' | '7days' | '30days') => {
    if (rangeType === 'all') {
      setVoidStartDate('');
      setVoidEndDate('');
      setToast({ message: 'แสดงรายงานการ Void สะสมทั้งหมดของระบบ', type: 'info' });
      return;
    }

    const latestTx = [...transactions].filter(t => t.type === 'void').sort((a, b) => b.date.localeCompare(a.date))[0];
    const anchorDateStr = latestTx ? latestTx.date : new Date().toISOString().split('T')[0];
    
    const anchor = new Date(anchorDateStr);
    const start = new Date(anchor);

    if (rangeType === '7days') {
      start.setDate(anchor.getDate() - 6);
      setVoidStartDate(start.toISOString().split('T')[0]);
      setVoidEndDate(anchorDateStr);
      setToast({ message: `แสดงรายงานการ Void ย้อนหลัง 7 วัน (${formatThaiDate(start.toISOString().split('T')[0])} - ${formatThaiDate(anchorDateStr)})`, type: 'success' });
    } else if (rangeType === '30days') {
      start.setDate(anchor.getDate() - 29);
      setVoidStartDate(start.toISOString().split('T')[0]);
      setVoidEndDate(anchorDateStr);
      setToast({ message: `แสดงรายงานการ Void ย้อนหลัง 30 วัน (${formatThaiDate(start.toISOString().split('T')[0])} - ${formatThaiDate(anchorDateStr)})`, type: 'success' });
    }
  };

  // Helper to quickly apply date range presets (anchored to the latest transaction date)
  const setPresetRange = (rangeType: 'all' | '7days' | '30days') => {
    if (rangeType === 'all') {
      setSummaryStartDate('');
      setSummaryEndDate('');
      setToast({ message: 'แสดงสถิติสะสมทั้งหมดของระบบ', type: 'info' });
      return;
    }

    // Anchor to the latest transaction date (usually index 0, or today)
    const latestTx = [...transactions].sort((a, b) => b.date.localeCompare(a.date))[0];
    const anchorDateStr = latestTx ? latestTx.date : new Date().toISOString().split('T')[0];
    
    const anchor = new Date(anchorDateStr);
    const start = new Date(anchor);

    if (rangeType === '7days') {
      start.setDate(anchor.getDate() - 6);
      setSummaryStartDate(start.toISOString().split('T')[0]);
      setSummaryEndDate(anchorDateStr);
      setToast({ message: `แสดงสถิติย้อนหลัง 7 วัน (${formatThaiDate(start.toISOString().split('T')[0])} - ${formatThaiDate(anchorDateStr)})`, type: 'success' });
    } else if (rangeType === '30days') {
      start.setDate(anchor.getDate() - 29);
      setSummaryStartDate(start.toISOString().split('T')[0]);
      setSummaryEndDate(anchorDateStr);
      setToast({ message: `แสดงสถิติย้อนหลัง 30 วัน (${formatThaiDate(start.toISOString().split('T')[0])} - ${formatThaiDate(anchorDateStr)})`, type: 'success' });
    }
  };

  // Open the Unified Add Modal with default template
  const handleOpenAddModal = () => {
    if (userRole === 'visitor') {
      setToast({ message: '⚠️ คุณอยู่ในสถานะผู้เยี่ยมชม ไม่สามารถเพิ่มข้อมูลใหม่ได้ กรุณาลงชื่อเข้าใช้งานสิทธิ์ผู้ดูแลระบบ', type: 'error' });
      return;
    }
    const currentDate = new Date().toISOString().split('T')[0];

    setEditingTransactionId(null);
    setFormData({
      date: currentDate,
      platform: 'shopee',
      type: 'sale',
      amount: '',
      orders: '',
      items: '',
      note: '',
      staffCode: loggedInUserCode || 'Auehen'
    });
    setIsAddModalOpen(true);
  };

  // Open the Unified Edit Modal with existing values
  const handleOpenEditModal = (tx: Transaction) => {
    if (userRole === 'visitor') {
      setToast({ message: '⚠️ คุณอยู่ในสถานะผู้เยี่ยมชม ไม่สามารถแก้ไขข้อมูลได้ กรุณาลงชื่อเข้าใช้งานสิทธิ์ผู้ดูแลระบบ', type: 'error' });
      return;
    }
    setEditingTransactionId(tx.id);
    setFormData({
      date: tx.date,
      platform: tx.platform,
      type: tx.type,
      amount: String(tx.amount),
      orders: String(tx.orders),
      items: String(tx.items !== undefined && !isNaN(tx.items) ? tx.items : 0),
      note: tx.note || '',
      staffCode: tx.staffCode || loggedInUserCode || 'Auehen'
    });
    setIsAddModalOpen(true);
  };

  const handleEditByDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (userRole === 'visitor') {
      setToast({ message: '⚠️ คุณอยู่ในสถานะผู้เยี่ยมชม ไม่สามารถทำการแก้ไขข้อมูลได้', type: 'error' });
      e.target.value = '';
      return;
    }
    const selectedDate = e.target.value;
    if (!selectedDate) return;
    
    setSelectedQueryDate(selectedDate);
    const matching = transactions.filter(t => t.date === selectedDate);
    
    if (matching.length === 0) {
      setToast({ message: `ไม่พบรายการข้อมูลในวันที่ ${formatThaiDate(selectedDate)} กรุณาลองเลือกวันอื่น`, type: 'error' });
      e.target.value = '';
    } else if (matching.length === 1) {
      handleOpenEditModal(matching[0]);
      setToast({ message: `ดึงข้อมูลวันที่ ${formatThaiDate(selectedDate)} สำเร็จ!`, type: 'success' });
      e.target.value = '';
    } else {
      setDateSelectionTransactions(matching);
      e.target.value = '';
    }
  };

  // Helper when changing platform/type in form to auto-adjust values
  const handleFormChange = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Process and save new or edited simplified transaction
  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole === 'visitor') {
      setToast({ message: '⚠️ คุณอยู่ในสถานะผู้เยี่ยมชม ไม่สามารถเพิ่มหรือแก้ไขข้อมูลได้', type: 'error' });
      return;
    }

    const amountNum = formData.amount ? parseFloat(formData.amount) : 0;
    const ordersNum = formData.orders ? parseInt(formData.orders, 10) : 0;
    const itemsNum = formData.items ? parseInt(formData.items, 10) : 0;

    let txDate = formData.date;
    if (!txDate) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      txDate = `${yyyy}-${mm}-${dd}`;
    }
    isLastSyncFromSheetRef.current = false;
    lastLocalWriteTimeRef.current = Date.now();

    let updatedTx: Transaction;
    let nextTransactions: Transaction[];
    const currentTimestamp = getLocalTimestamp();
    const activeUserCode = loggedInUserCode || 'Auehen';

    if (editingTransactionId) {
      // Edit mode
      updatedTx = {
        id: editingTransactionId,
        date: txDate,
        platform: formData.platform,
        type: formData.type,
        amount: amountNum,
        orders: isNaN(ordersNum) ? 0 : ordersNum,
        items: isNaN(itemsNum) ? 0 : itemsNum,
        note: formData.note.trim(),
        staffCode: activeUserCode,
        timestamp: currentTimestamp
      };
      
      nextTransactions = transactions.map(tx => tx.id === editingTransactionId ? updatedTx : tx);
      setTransactions(nextTransactions);
      setEditingTransactionId(null);
      setIsAddModalOpen(false);
      
      setToast({ message: `แก้ไขรายการ ${editingTransactionId} สำเร็จ!`, type: 'success' });
    } else {
      // Add mode
      const cleanDateId = txDate.replace(/-/g, '');
      const randomIdSuffix = Math.floor(100 + Math.random() * 900);
      const generatedId = `TX-${cleanDateId}-${randomIdSuffix}`;

      updatedTx = {
        id: generatedId,
        date: txDate,
        platform: formData.platform,
        type: formData.type,
        amount: amountNum,
        orders: isNaN(ordersNum) ? 0 : ordersNum,
        items: isNaN(itemsNum) ? 0 : itemsNum,
        note: formData.note.trim(),
        staffCode: activeUserCode,
        timestamp: currentTimestamp
      };

      nextTransactions = [updatedTx, ...transactions];
      setTransactions(nextTransactions);
      setIsAddModalOpen(false);

      setToast({ message: 'บันทึกยอดขายใหม่เรียบร้อยแล้ว!', type: 'success' });
    }

    // Save states but do NOT open the Google Sheets sync preview window!
    setSyncSuccessAction('save');
    setSyncSuccessModalTx(updatedTx);
    // setIsSyncSuccessModalOpen(true); // Disabled popup to prevent user distraction

    if (sheetConnection === 'connected' && googleAccessToken && currentUser) {
      setSyncStatus('syncing');
      handleRealSync(googleAccessToken, currentUser, nextTransactions).then((spreadsheetIdResult) => {
        if (spreadsheetIdResult) {
          setSyncStatus('success');
        } else {
          setSyncStatus('failed');
        }
      }).catch((err) => {
        console.error('Background sync failed:', err);
        setSyncStatus('failed');
      });
    } else {
      setSyncStatus('offline_success');
    }
  };

  // Delete a specific transaction (triggered via custom modal confirmation)
  const handleConfirmDelete = () => {
    if (userRole === 'visitor') {
      setToast({ message: '⚠️ คุณอยู่ในสถานะผู้เยี่ยมชม ไม่สามารถลบข้อมูลได้', type: 'error' });
      return;
    }
    if (deleteTargetId) {
      isLastSyncFromSheetRef.current = false;
      lastLocalWriteTimeRef.current = Date.now();
      const targetTx = transactions.find(tx => tx.id === deleteTargetId);
      const nextTransactions = transactions.filter(tx => tx.id !== deleteTargetId);
      setTransactions(nextTransactions);
      setToast({ message: `ลบรายการ ${deleteTargetId} เรียบร้อยแล้ว`, type: 'info' });
      setDeleteTargetId(null);

      if (targetTx) {
        setSyncSuccessAction('delete');
        setSyncSuccessModalTx(targetTx);
        // setIsSyncSuccessModalOpen(true); // Disabled popup to prevent user distraction

        if (sheetConnection === 'connected' && googleAccessToken && currentUser) {
          setSyncStatus('syncing');
          handleRealSync(googleAccessToken, currentUser, nextTransactions).then((spreadsheetIdResult) => {
            if (spreadsheetIdResult) {
              setSyncStatus('success');
            } else {
              setSyncStatus('failed');
            }
          }).catch((err) => {
            console.error('Background sync failed on delete:', err);
            setSyncStatus('failed');
          });
        } else {
          setSyncStatus('offline_success');
        }
      }
    }
  };

  // Real Sheets Sync Logic
  const handleRealSync = async (forceToken?: string, forceUser?: User, customTransactions?: Transaction[]): Promise<string | null> => {
    const token = forceToken || googleAccessToken;
    const activeUser = forceUser || currentUser;
    
    if (!token || !activeUser) {
      return null;
    }

    const txsToSync = customTransactions || transactions;

    setIsSyncingSheets(true);
    try {
      let activeSpreadsheetId = spreadsheetId;
      
      // Always search Drive first for 'Shopee_Lazada_Sales_Records' to ensure we use the correct spreadsheet name
      const existingId = await findSpreadsheet(token, 'Shopee_Lazada_Sales_Records');
      if (existingId) {
        activeSpreadsheetId = existingId;
        setSpreadsheetId(activeSpreadsheetId);
        localStorage.setItem('ecom_spreadsheet_id', activeSpreadsheetId);
      } else if (!activeSpreadsheetId) {
        activeSpreadsheetId = await createSpreadsheet(token, 'Shopee_Lazada_Sales_Records');
        setSpreadsheetId(activeSpreadsheetId);
        localStorage.setItem('ecom_spreadsheet_id', activeSpreadsheetId);
      }

      await prepareSpreadsheetTabs(token, activeSpreadsheetId);
      await syncDataToGoogleSheets(token, activeSpreadsheetId, txsToSync);

      setSheetConnection('connected');
      localStorage.setItem('ecom_sheets_connected_v3', 'connected');
      return activeSpreadsheetId;
    } catch (error: any) {
      const isAuthError = error.message?.includes('401') || 
                          error.message?.includes('UNAUTHENTICATED') || 
                          error.message?.includes('credential') ||
                          error.status === 401;
      const isNetworkOrFetchError = error.message?.includes('Failed to fetch') || 
                                    error.message?.includes('network') || 
                                    error.name === 'TypeError';
      
      if (!isAuthError && !isNetworkOrFetchError) {
        console.error('Sync to sheets failed:', error);
      } else if (isNetworkOrFetchError) {
        console.warn('Sync to sheets network fetch failed (offline or sandbox):', error.message);
      }

      if (isAuthError) {
        setGoogleAccessToken(null);
        setCurrentUser(null);
        setSheetConnection('disconnected');
        localStorage.removeItem('ecom_google_access_token');
        setToast({ message: '⚠️ สิทธิ์เชื่อมต่อ Google ของคุณหมดอายุ กรุณาคลิกปุ่มซิงค์ข้อมูลอีกครั้งเพื่อลงชื่อเข้าใช้งานใหม่', type: 'error' });
      } else if (isNetworkOrFetchError) {
        setToast({ message: '⚠️ การเชื่อมต่อล้มเหลว: ไม่สามารถเชื่อมต่อกับบริการของ Google ได้ กรุณาตรวจสอบอินเทอร์เน็ตของคุณ', type: 'error' });
      } else {
        setToast({ message: `การซิงค์ล้มเหลว: ${error.message || 'เกิดข้อผิดพลาด'}`, type: 'error' });
      }
      return null;
    } finally {
      setIsSyncingSheets(false);
    }
  };

  // 1. Password/Access Check Handler (Always require password verification every time)
  const handleRequestAccess = (action: 'sync' | 'open_sheet' | 'switch_to_admin') => {
    setPendingAction(action);
    setEnteredPassword('');
    setSelectedUserCode('');
    setIsPasswordModalOpen(true);
  };

  // 2. Password Verification Handler (Verifies and runs the pending action immediately, then locks again)
  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const inputVal = enteredPassword.trim();
    const account = userAccounts.find(acc => acc.userCode.toLowerCase() === selectedUserCode.toLowerCase());

    if (account) {
      if (account.password === inputVal) {
        setIsPasswordModalOpen(false);
        setLoggedInUserCode(account.userCode);
        setUserRole(account.role);
        localStorage.setItem('ecom_user_role', account.role);
        localStorage.setItem('ecom_logged_in_user_code', account.userCode);

        const actionToRun = pendingAction;
        setPendingAction(null);

        // Execute the pending action
        if (actionToRun === 'sync') {
          setToast({ message: `🔓 เข้าสู่ระบบคุณ ${account.userCode} สำเร็จ! กำลังซิงค์ข้อมูล...`, type: 'success' });
          handleSyncAndOpenSheetsDirect();
        } else if (actionToRun === 'open_sheet' && spreadsheetId) {
          setToast({ message: `🔓 เข้าสู่ระบบคุณ ${account.userCode} สำเร็จ! กำลังเปิด Google Sheets...`, type: 'success' });
          window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
        } else {
          setToast({ message: `🔓 ยินดีต้อนรับคุณ ${account.userCode}! เข้าสู่ระบบด้วยสิทธิ์${account.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป'}`, type: 'success' });
        }
      } else {
        setToast({ message: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', type: 'error' });
      }
    } else {
      setToast({ message: 'ไม่พบผู้ใช้นี้ในระบบ', type: 'error' });
    }
  };

  // 3. Password Changing Handler
  const handleSaveNewPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const account = userAccounts.find(acc => acc.userCode.toLowerCase() === selectedUserCode.toLowerCase());
    if (!account) {
      setToast({ message: 'ไม่พบผู้ใช้นี้ในระบบ', type: 'error' });
      return;
    }
    if (currentPasswordConfirm !== account.password) {
      setToast({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง กรุณากรอกรหัสผ่านปัจจุบันให้ถูกต้อง', type: 'error' });
      return;
    }
    if (!newPasswordValue.trim()) {
      setToast({ message: 'กรุณากรอกรหัสผ่านใหม่', type: 'error' });
      return;
    }

    const updatedAccounts = userAccounts.map(acc => {
      if (acc.userCode.toLowerCase() === selectedUserCode.toLowerCase()) {
        return { ...acc, password: newPasswordValue.trim() };
      }
      return acc;
    });

    setUserAccounts(updatedAccounts);
    setIsChangingPassword(false);
    setCurrentPasswordConfirm('');
    setNewPasswordValue('');
    setToast({ message: `เปลี่ยนรหัสผ่านสำเร็จ! รหัสผ่านใหม่ของ ${selectedUserCode} คือ: ${newPasswordValue.trim()}`, type: 'success' });
  };

  // Synchronize with Google Sheets and immediately open it in a new tab for AppSheet integration
  const handleSyncAndOpenSheetsDirect = async () => {
    let token = googleAccessToken;
    let user = currentUser;

    // 1. If not connected, sign in with Google first
    if (!token || !user) {
      setSheetConnection('connecting');
      setToast({ message: 'กำลังเชื่อมโยงบัญชี Google ของคุณ...', type: 'info' });
      try {
        const result = await googleSignIn();
        if (result) {
          token = result.accessToken;
          user = result.user;
          setCurrentUser(result.user);
          setGoogleAccessToken(result.accessToken);
          setToast({ message: `เชื่อมต่อบัญชีสำเร็จ! กำลังซิงค์ข้อมูล...`, type: 'success' });
        } else {
          setSheetConnection('disconnected');
          setToast({ message: 'การเชื่อมต่อบัญชี Google ถูกยกเลิก', type: 'error' });
          return;
        }
      } catch (err: any) {
        console.error('Google Sign In failed:', err);
        setToast({ message: `เชื่อมต่อล้มเหลว: ${err.message || 'ปฏิเสธการเข้าถึง'}`, type: 'error' });
        setSheetConnection('disconnected');
        return;
      }
    }

    // 2. Perform sync
    setToast({ message: 'กำลังซิงค์และเขียนข้อมูลเข้าสู่ Google Sheets...', type: 'info' });
    const activeSpreadsheetId = await handleRealSync(token, user);
    
    if (activeSpreadsheetId) {
      setToast({ message: '🎉 ซิงค์เรียบร้อย! กำลังเปิดแผ่นงาน Google Sheets...', type: 'success' });
      
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${activeSpreadsheetId}`;
      
      // Attempt to open in a new tab
      const newWindow = window.open(sheetUrl, '_blank');
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // Fallback if browser blocked the pop-up
        setToast({ 
          message: 'ซิงค์สำเร็จแล้ว! แต่เบราว์เซอร์บล็อกป๊อปอัปของคุณ กรุณาคลิก "เปิด Google Sheet ↗" ที่ด้านบนตัวควบคุม', 
          type: 'info' 
        });
      }
    } else {
      setToast({ message: 'ไม่สามารถซิงค์ข้อมูลลง Google Sheets ได้สำเร็จ', type: 'error' });
    }
  };

  // Proxy function to check password before syncing and opening sheets
  const handleSyncAndOpenSheets = () => {
    if (userRole !== 'admin') {
      setToast({ message: '⚠️ คุณไม่มีสิทธิ์ผู้ดูแลระบบ (Admin) ไม่สามารถซิงค์และเปิด Google Sheets ได้', type: 'error' });
      return;
    }
    handleRequestAccess('sync');
  };

  // Sync / Connect Google Sheets
  const handleToggleSheets = async () => {
    if (userRole !== 'admin') {
      setToast({ message: '⚠️ คุณไม่มีสิทธิ์ผู้ดูแลระบบ (Admin) ไม่สามารถแก้ไขหรือตั้งค่า Google Sheets ได้', type: 'error' });
      return;
    }
    if (sheetConnection === 'connected') {
      await logoutUser();
      setCurrentUser(null);
      setGoogleAccessToken(null);
      setSheetConnection('disconnected');
      localStorage.setItem('ecom_sheets_connected_v3', 'disconnected');
      setToast({ message: 'ตัดการเชื่อมโยงข้อมูลกับ Google Sheets เรียบร้อยแล้ว', type: 'info' });
    } else {
      setSheetConnection('connecting');
      try {
        const result = await googleSignIn();
        if (result) {
          setCurrentUser(result.user);
          setGoogleAccessToken(result.accessToken);
          setToast({ message: `เชื่อมต่อบัญชีสำเร็จ! ยินดีต้อนรับคุณ ${result.user.displayName || result.user.email}`, type: 'success' });
          await handleRealSync(result.accessToken, result.user);
        } else {
          setSheetConnection('disconnected');
        }
      } catch (err: any) {
        console.error('Google Sign In failed:', err);
        setToast({ message: `เชื่อมต่อบัญชีล้มเหลว: ${err.message || 'ปฏิเสธการเข้าถึง'}`, type: 'error' });
        setSheetConnection('disconnected');
      }
    }
  };



  // Compare two transaction lists to check for deep equality
  const areTransactionListsEqual = (listA: Transaction[], listB: Transaction[]) => {
    if (listA.length !== listB.length) return false;
    const sortedA = [...listA].sort((x, y) => x.date.localeCompare(y.date) || x.platform.localeCompare(y.platform) || (x.amount - y.amount));
    const sortedB = [...listB].sort((x, y) => x.date.localeCompare(y.date) || x.platform.localeCompare(y.platform) || (x.amount - y.amount));
    
    for (let i = 0; i < sortedA.length; i++) {
      const a = sortedA[i];
      const b = sortedB[i];
      const itemA = a.items !== undefined && !isNaN(a.items) ? a.items : 0;
      const itemB = b.items !== undefined && !isNaN(b.items) ? b.items : 0;
      
      if (
        a.date !== b.date ||
        a.platform !== b.platform ||
        a.type !== b.type ||
        a.amount !== b.amount ||
        a.orders !== b.orders ||
        itemA !== itemB ||
        (a.staffCode || '') !== (b.staffCode || '') ||
        (a.note || '') !== (b.note || '')
      ) {
        return false;
      }
    }
    return true;
  };

  // Real-time polling to load changes made directly on Google Sheets back to the dashboard
  useEffect(() => {
    if (sheetConnection !== 'connected' || !googleAccessToken || !spreadsheetId || userRole === 'visitor') {
      return;
    }

    let intervalId: any;
    let active = true;

    const pollGoogleSheets = async () => {
      // Don't poll if we are actively writing, tab is not focused, or if we performed a local write recently (allow 15 seconds for Google Sheets propagation)
      if (isSyncingSheets || document.visibilityState !== 'visible' || (Date.now() - lastLocalWriteTimeRef.current < 15000)) {
        return;
      }

      try {
        setIsPollingSheets(true);
        const fetched = await readDataFromGoogleSheets(googleAccessToken, spreadsheetId);
        if (!active) return;

        if (fetched) {
          if (fetched.length === 0 && transactions.length > 0) {
            // Google Sheets is empty, but we have local transactions.
            // Avoid wiping out local data, sync local transactions UP to Google Sheets!
            console.log('Google Sheets is empty. Syncing local transactions up to prevent data loss...');
            handleRealSync(googleAccessToken, currentUser, transactions);
          } else {
            const isSame = areTransactionListsEqual(transactions, fetched);
            if (!isSame) {
              console.log('Detected Google Sheets modifications, updating dashboard...');
              isLastSyncFromSheetRef.current = true;
              setTransactions(fetched);
              setToast({ message: '🔄 อัปเดตข้อมูลแบบเรียลไทม์จาก Google Sheets เรียบร้อย!', type: 'success' });
            }
          }
        }
      } catch (e: any) {
        const isAuthError = e.message === 'UNAUTHENTICATED_401' || e.message?.includes('401');
        if (!isAuthError) {
          console.error('Polling error:', e);
        }
        if (isAuthError) {
          setSheetConnection('disconnected');
          setGoogleAccessToken(null);
          setCurrentUser(null);
          localStorage.setItem('ecom_sheets_connected_v3', 'disconnected');
          localStorage.removeItem('ecom_google_access_token');
          setToast({ message: '⚠️ เซสชัน Google Sheets หมดอายุ กรุณาเชื่อมต่อใหม่อีกครั้ง', type: 'error' });
        }
      } finally {
        if (active) {
          setIsPollingSheets(false);
        }
      }
    };

    // Run immediately on focus/load
    pollGoogleSheets();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollGoogleSheets();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    intervalId = setInterval(pollGoogleSheets, 8000);

    return () => {
      active = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sheetConnection, googleAccessToken, spreadsheetId, userRole, transactions, isSyncingSheets]);

  // Auto-sync to Google Sheets on changes when connected (Debounced)
  useEffect(() => {
    if (sheetConnection === 'connected' && googleAccessToken && userRole !== 'visitor' && !isSyncingSheets) {
      if (isLastSyncFromSheetRef.current) {
        isLastSyncFromSheetRef.current = false;
        return;
      }

      const timer = setTimeout(() => {
        handleRealSync();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [transactions, sheetConnection, googleAccessToken, userRole]);

  // Export ledger to CSV format
  const handleExportCSV = () => {
    const hideStaffCode = userRole !== 'admin';
    const csvContent = exportToCSV(filteredTransactions, hideStaffCode);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Ecom_Sales_Report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToast({ message: `ส่งออกไฟล์รายงานเรียบร้อย (รวมทั้งหมด ${filteredTransactions.length} รายการ)`, type: 'success' });
  };

  // Export ledger specifically formatted for AppSheet and Google Sheets (clean raw UTF-8 CSV with English column headers)
  const handleExportAppSheetCSV = () => {
    const hideStaffCode = userRole !== 'admin';
    const csvContent = exportToAppSheetCSV(filteredTransactions, hideStaffCode);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AppSheet_Import_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setToast({ message: `ส่งออกไฟล์สำหรับ Google Sheets เรียบร้อย (รวม ${filteredTransactions.length} รายการ)`, type: 'success' });
  };

  // Copy daily summary report to clipboard for chat channels
  const handleCopyDailySummary = (row: any) => {
    try {
      const text = `📋 สรุปยอดขายรายวัน ประจำวันที่ ${formatThaiDate(row.date)}
━━━━━━━━━━━━━━━━━━━━━━━━
💰 ยอดสุทธิรวม 2 แพลตฟอร์ม: ฿${row.totalNet.toLocaleString('th-TH')}
📦 ออเดอร์รวม: ${row.totalOrders.toLocaleString('th-TH')} รายการ
🛒 จำนวนชิ้นรวม: ${row.totalItems.toLocaleString('th-TH')} ชิ้น

แยกตามแพลตฟอร์ม:
🟧 Shopee (ส้ม)
- ยอดสุทธิ: ฿${row.shopeeNet.toLocaleString('th-TH')}
- จำนวนออเดอร์: ${row.shopeeOrders.toLocaleString('th-TH')} ออเดอร์
- จำนวนชิ้น: ${row.shopeeItems.toLocaleString('th-TH')} ชิ้น

🟦 Lazada (น้ำเงิน)
- ยอดสุทธิ: ฿${row.lazadaNet.toLocaleString('th-TH')}
- จำนวนออเดอร์: ${row.lazadaOrders.toLocaleString('th-TH')} ออเดอร์
- จำนวนชิ้น: ${row.lazadaItems.toLocaleString('th-TH')} ชิ้น

❌ ยอดหัก Void/ยกเลิก รวม: ฿${(row.shopeeVoid + row.lazadaVoid).toLocaleString('th-TH')}`;

      navigator.clipboard.writeText(text);
      setToast({ message: `📋 คัดลอกสรุปยอดขายวันที่ ${formatThaiDate(row.date)} สำเร็จ!`, type: 'success' });
    } catch (err) {
      console.error('Clipboard copy error:', err);
      setToast({ message: 'ไม่สามารถคัดลอกไปยังคลิปบอร์ดได้', type: 'error' });
    }
  };

  // Helper to get formatted date range for the PDF report header
  const getReportDateRangeString = () => {
    if (summaryStartDate && summaryEndDate) {
      return `${formatThaiDate(summaryStartDate)} ถึง ${formatThaiDate(summaryEndDate)}`;
    } else if (summaryStartDate) {
      return `ตั้งแต่ ${formatThaiDate(summaryStartDate)} เป็นต้นไป`;
    } else if (summaryEndDate) {
      return `จนถึงวันที่ ${formatThaiDate(summaryEndDate)}`;
    } else {
      return 'ข้อมูลทั้งหมดสะสมในระบบ';
    }
  };

  // Export Analytics to a beautiful PDF report containing a summary and comparison charts
  const handleExportPDF = async () => {
    setIsPrintingPDF(true);
    setToast({ message: 'กำลังสร้างรายงาน PDF กรุณารอสักครู่...', type: 'info' });

    try {
      // Find the template
      const element = document.getElementById('pdf-report-template');
      if (!element) {
        setToast({ message: 'ไม่พบเทมเพลตรายงานสถิติ', type: 'error' });
        setIsPrintingPDF(false);
        return;
      }

      // Generate the canvas using html2canvas
      const canvas = await html2canvas(element, {
        scale: 2, // Double resolution for ultra-sharp rendering
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById('pdf-report-template');
          if (clonedElement) {
            clonedElement.style.display = 'block';
            clonedElement.style.position = 'static';
            clonedElement.style.left = '0';
            clonedElement.style.top = '0';
          }
        }
      });

      const imgData = canvas.toDataURL('image/png');

      // Setup jsPDF A4 Document
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      // Add image pages
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;
      }

      const dateStr = new Date().toISOString().split('T')[0];
      pdf.save(`Sales_Analytics_Report_${dateStr}.pdf`);
      setToast({ message: 'ดาวน์โหลดรายงาน PDF สำเร็จเรียบร้อย!', type: 'success' });
    } catch (error) {
      console.error('PDF Generation Error:', error);
      setToast({ message: 'เกิดข้อผิดพลาดระหว่างการดาวน์โหลดรายงาน PDF', type: 'error' });
    } finally {
      setIsPrintingPDF(false);
    }
  };

  // Group transactions daily
  const dailyReport = useMemo(() => {
    const groups: { [key: string]: { shopeeSales: number; shopeeVoid: number; shopeeOrders: number; shopeeItems: number; lazadaSales: number; lazadaVoid: number; lazadaOrders: number; lazadaItems: number; totalNet: number } } = {};
    
    summaryFilteredTransactions.forEach(tx => {
      const date = tx.date;
      if (!groups[date]) {
        groups[date] = { shopeeSales: 0, shopeeVoid: 0, shopeeOrders: 0, shopeeItems: 0, lazadaSales: 0, lazadaVoid: 0, lazadaOrders: 0, lazadaItems: 0, totalNet: 0 };
      }

      const amount = Number(tx.amount) || 0;
      const orders = Number(tx.orders) || 0;
      const items = Number(tx.items) || 0;
      if (tx.platform === 'shopee') {
        if (tx.type === 'sale') {
          groups[date].shopeeSales += amount;
          groups[date].shopeeOrders += orders;
          groups[date].shopeeItems += items;
        } else if (tx.type === 'void') {
          groups[date].shopeeVoid += amount;
        }
      } else {
        if (tx.type === 'sale') {
          groups[date].lazadaSales += amount;
          groups[date].lazadaOrders += orders;
          groups[date].lazadaItems += items;
        } else if (tx.type === 'void') {
          groups[date].lazadaVoid += amount;
        }
      }
    });

    return Object.keys(groups)
      .map(date => {
        const item = groups[date];
        const shopeeNet = item.shopeeSales - item.shopeeVoid;
        const lazadaNet = item.lazadaSales - item.lazadaVoid;
        return {
          date,
          shopeeSales: item.shopeeSales,
          shopeeVoid: item.shopeeVoid,
          shopeeNet,
          shopeeOrders: item.shopeeOrders,
          shopeeItems: item.shopeeItems,
          lazadaSales: item.lazadaSales,
          lazadaVoid: item.lazadaVoid,
          lazadaNet,
          lazadaOrders: item.lazadaOrders,
          lazadaItems: item.lazadaItems,
          totalNet: shopeeNet + lazadaNet,
          totalOrders: item.shopeeOrders + item.lazadaOrders,
          totalItems: item.shopeeItems + item.lazadaItems
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [summaryFilteredTransactions]);

  // Group transactions monthly
  const monthlyReport = useMemo(() => {
    const groups: { [key: string]: { shopeeSales: number; shopeeVoid: number; shopeeOrders: number; lazadaSales: number; lazadaVoid: number; lazadaOrders: number; totalNet: number } } = {};

    summaryFilteredTransactions.forEach(tx => {
      const month = tx.date.substring(0, 7); // YYYY-MM
      if (!groups[month]) {
        groups[month] = { shopeeSales: 0, shopeeVoid: 0, shopeeOrders: 0, lazadaSales: 0, lazadaVoid: 0, lazadaOrders: 0, totalNet: 0 };
      }

      const amount = Number(tx.amount) || 0;
      const orders = Number(tx.orders) || 0;
      if (tx.platform === 'shopee') {
        if (tx.type === 'sale') {
          groups[month].shopeeSales += amount;
          groups[month].shopeeOrders += orders;
        } else if (tx.type === 'void') {
          groups[month].shopeeVoid += amount;
        }
      } else {
        if (tx.type === 'sale') {
          groups[month].lazadaSales += amount;
          groups[month].lazadaOrders += orders;
        } else if (tx.type === 'void') {
          groups[month].lazadaVoid += amount;
        }
      }
    });

    return Object.keys(groups)
      .map(month => {
        const item = groups[month];
        const shopeeNet = item.shopeeSales - item.shopeeVoid;
        const lazadaNet = item.lazadaSales - item.lazadaVoid;
        return {
          month,
          shopeeSales: item.shopeeSales,
          shopeeVoid: item.shopeeVoid,
          shopeeNet,
          shopeeOrders: item.shopeeOrders,
          lazadaSales: item.lazadaSales,
          lazadaVoid: item.lazadaVoid,
          lazadaNet,
          lazadaOrders: item.lazadaOrders,
          totalNet: shopeeNet + lazadaNet,
          totalOrders: item.shopeeOrders + item.lazadaOrders
        };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [summaryFilteredTransactions]);

  // Filter transactions for main table (respecting search, platform, type, and date range filters)
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = query === '' || 
        tx.note.toLowerCase().includes(query) ||
        tx.id.toLowerCase().includes(query) ||
        tx.platform.toLowerCase().includes(query);
      
      const matchesPlatform = filterPlatform === 'all' || tx.platform === filterPlatform;
      const matchesType = filterType === 'all' || tx.type === filterType;
      
      const matchesStartDate = !summaryStartDate || tx.date >= summaryStartDate;
      const matchesEndDate = !summaryEndDate || tx.date <= summaryEndDate;
      
      return matchesSearch && matchesPlatform && matchesType && matchesStartDate && matchesEndDate;
    });
  }, [transactions, searchQuery, filterPlatform, filterType, summaryStartDate, summaryEndDate]);

  // Render month in Thai format (e.g. กรกฎาคม 2569)
  const formatThaiMonth = (monthStr: string): string => {
    const parts = monthStr.split('-');
    if (parts.length !== 2) return monthStr;
    const yearBE = parseInt(parts[0], 10) + 543;
    const monthsFull = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    return `${monthsFull[parseInt(parts[1], 10) - 1]} ${yearBE}`;
  };

  // Percentage void rate calculation
  const voidRate = useMemo(() => {
    if (stats.grossRevenue === 0) return '0.0';
    return ((stats.voidAmount / stats.grossRevenue) * 100).toFixed(1);
  }, [stats]);

  // Interactive dynamic chart calculations
  const chartPoints = useMemo(() => {
    const sortedDays = [...dailyReport].reverse().slice(-7);
    if (sortedDays.length === 0) return [];
    
    const maxVal = Math.max(...sortedDays.map(d => Math.max(d.shopeeNet, d.lazadaNet, d.totalNet, 1000)));
    
    return sortedDays.map((d, index) => {
      const x = 50 + (index * 68);
      const yShopee = 180 - (Math.max(0, d.shopeeNet) / maxVal * 130);
      const yLazada = 180 - (Math.max(0, d.lazadaNet) / maxVal * 130);
      const yTotal = 180 - (Math.max(0, d.totalNet) / maxVal * 130);
      return { ...d, x, yShopee, yLazada, yTotal };
    });
  }, [dailyReport]);

  return (
    <div className={`min-h-screen ${themeStyles.bg} transition-colors duration-300 font-sans antialiased ${themeStyles.toast}`}>
      
      {/* Toast Notification Container */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl border ${
              toast.type === 'success' ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-200/50' : 
              toast.type === 'error' ? 'bg-rose-600 text-white border-rose-500 shadow-rose-200/50' : 
              'bg-slate-800 text-white border-slate-700'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0 text-emerald-100" /> : 
             toast.type === 'error' ? <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-100" /> : 
             <Info className="w-5 h-5 flex-shrink-0 text-slate-100" />}
            <span className="font-semibold text-xs tracking-wide">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>



      {/* PLATFORM/ROLE TOP BAR BANNER */}
      {userRole === 'visitor' ? (
        /* Visitor Platform Header */
        <div className="px-4 md:px-8 py-3 bg-slate-100 text-slate-800 border-b border-slate-300 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs font-bold shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center flex-shrink-0 shadow-xs">
              <Eye className="w-4.5 h-4.5 animate-pulse text-slate-600" />
            </div>
            <div>
              <span className="text-[13px] font-extrabold text-slate-900 block">🌐 แพลตฟอร์มผู้เข้าเยี่ยมชม (Visitor View Only)</span>
            </div>
          </div>
          <div>
            <button
              onClick={() => handleRequestAccess('switch_to_admin')}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-extrabold transition-all shadow-sm flex items-center justify-center cursor-pointer active:scale-95"
              title="สลับไปแพลตฟอร์มผู้ใช้งาน (User Login)"
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : userRole === 'user' ? (
        /* User Platform Header */
        <div className="px-4 md:px-8 py-3 bg-slate-800 text-white border-b border-slate-900 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs font-bold shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-700 text-slate-200 flex items-center justify-center flex-shrink-0 shadow-xs border border-slate-600">
              <UserIcon className="w-4.5 h-4.5 text-slate-300" />
            </div>
            <div>
              <span className="text-[13px] font-extrabold text-slate-200 block">⚡ แพลตฟอร์มผู้ใช้งานทั่วไป (User Workspace) - บัญชี: {loggedInUserCode || 'Auehen'}</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-end gap-3 ml-auto">
            <button
              onClick={() => {
                setUserRole('visitor');
                localStorage.setItem('ecom_user_role', 'visitor');
                setToast({ message: '🔒 เปลี่ยนสถานะเป็นผู้เยี่ยมชมเรียบร้อยแล้ว', type: 'info' });
              }}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-950 text-slate-300 hover:text-white rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 text-xs border border-slate-700"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>สลับไปแพลตฟอร์มผู้เยี่ยมชม 🔒</span>
            </button>
          </div>
        </div>
      ) : (
        /* Admin Platform Header */
        <div className="px-4 md:px-8 py-3 bg-indigo-900 text-white border-b border-indigo-950 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs font-bold shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-800 text-indigo-200 flex items-center justify-center flex-shrink-0 shadow-xs border border-indigo-700">
              <ShieldCheck className="w-4.5 h-4.5 text-indigo-400 animate-bounce" />
            </div>
            <div>
              <span className="text-[13px] font-extrabold text-indigo-200 block">👑 แพลตฟอร์มผู้ดูแลระบบ (Admin Workspace) - บัญชี: {loggedInUserCode || 'Auehen'}</span>
              <span className="text-[10px] text-indigo-300 font-semibold block mt-0.5">คุณได้รับสิทธิ์เข้าถึงทั้งหมด: สามารถบันทึกยอดขายใหม่, แก้ไขรายการ, ลบรายการ และควบคุมการซิงค์ข้อมูลลงแผ่นงาน Google Sheets</span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-end gap-3 ml-auto">
            {/* Google Sheets status button for Admin */}
            {sheetConnection === 'connected' && spreadsheetId ? (
              <div className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-xs border border-emerald-500 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
                <span className="font-bold flex items-center gap-1">
                  <span>Google Sheets เชื่อมต่อแล้ว</span>
                  <span className="text-[10px] bg-emerald-700/80 px-1.5 py-0.5 rounded-md font-mono text-emerald-200 flex items-center gap-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 ${isPollingSheets ? 'animate-pulse' : ''}`} />
                    <span>เรียลไทม์ ⚡</span>
                  </span>
                </span>
                <button 
                  onClick={() => {
                    if (userRole === 'admin') {
                      if (spreadsheetId) {
                        setToast({ message: '🔄 กำลังเปิด Google Sheets...', type: 'success' });
                        window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
                      } else {
                        setToast({ message: '⚠️ ไม่พบ Spreadsheet ID', type: 'error' });
                      }
                    } else {
                      handleRequestAccess('open_sheet');
                    }
                  }}
                  className="ml-1 hover:underline text-xs text-emerald-100 font-bold flex items-center gap-0.5 bg-transparent border-none cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>เปิดแผ่นงาน ↗</span>
                </button>
                <span className="text-emerald-400 font-normal">|</span>
                <button
                  onClick={handleToggleSheets}
                  className="text-emerald-200 hover:text-white hover:underline text-xs bg-transparent border-none cursor-pointer"
                  title="ยกเลิกการเชื่อมโยงบัญชี Google"
                >
                  ยกเลิกเชื่อมต่อ
                </button>
              </div>
            ) : (
              <button
                onClick={handleToggleSheets}
                disabled={sheetConnection === 'connecting'}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm border border-indigo-500"
              >
                <Cloud className="w-3.5 h-3.5 text-indigo-200 animate-bounce" />
                <span>{sheetConnection === 'connecting' ? 'กำลังซิงค์เชื่อมต่อ...' : 'เชื่อมต่อ Google Sheets ⚡'}</span>
              </button>
            )}

            <button
              onClick={() => setIsAdminManagerOpen(true)}
              className="px-3.5 py-1.5 bg-indigo-850 hover:bg-indigo-800 text-indigo-100 hover:text-white rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 text-xs border border-indigo-700"
            >
              <Users className="w-3.5 h-3.5 text-indigo-300" />
              <span>จัดการอีเมลแอดมิน 👑</span>
            </button>

            <button
              onClick={() => setIsEmployeeManagerOpen(true)}
              className="px-3.5 py-1.5 bg-indigo-850 hover:bg-indigo-800 text-indigo-100 hover:text-white rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 text-xs border border-indigo-700"
            >
              <UserPlus className="w-3.5 h-3.5 text-indigo-300" />
              <span>จัดการบัญชีผู้ใช้งาน 👥</span>
            </button>

            <button
              onClick={() => {
                setUserRole('visitor');
                localStorage.setItem('ecom_user_role', 'visitor');
                setToast({ message: '🔒 เปลี่ยนสถานะเป็นผู้เยี่ยมชมเรียบร้อยแล้ว', type: 'info' });
              }}
              className="px-3.5 py-1.5 bg-indigo-950 hover:bg-slate-800 text-indigo-200 hover:text-white rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 text-xs border border-indigo-800"
            >
              <Lock className="w-3.5 h-3.5 text-indigo-300" />
              <span>สลับไปแพลตฟอร์มผู้เยี่ยมชม 🔒</span>
            </button>
          </div>
        </div>
      )}

      {/* HEADER 2: SECONDARY WHITE WORKSPACE HEADER */}
      <div className="bg-white border-b border-slate-200/60 px-4 md:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <img 
            src={tsdcLogo} 
            alt="TSDC Fulfillment Center Logo" 
            className="w-12 h-12 md:w-14 md:h-14 rounded-xl object-cover shadow-xs border border-slate-200/80 flex-shrink-0 mt-0.5"
            referrerPolicy="no-referrer"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-bold text-slate-800 tracking-tight">ระบบบันทึกยอดขาย Tsuruha</h2>
              <span className="bg-slate-100 text-slate-600 text-[10px] font-extrabold px-2 py-0.5 rounded-md">
                รวม {stats.totalOrders} รายการออเดอร์
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">บันทึกและแสดงสถิตยอดขายสุทธิของ Shopee และ Lazada ร่วมกันอย่างเป็นระเบียบสำหรับ Tsuruha</p>
            

          </div>
        </div>

        {/* SINGLE UNIFIED PLACE TO ADD DATA FROM THE TOP */}
        <div className="flex items-center gap-2.5 self-end sm:self-center">
          
          <button
            onClick={() => setShowKpiCards(!showKpiCards)}
            className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              showKpiCards ? 'bg-slate-50 text-slate-700 border-slate-200' : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{showKpiCards ? 'ซ่อนสรุปย่อ' : 'แสดงสรุปย่อ'}</span>
          </button>

          <div className="bg-slate-100 p-1 rounded-lg flex items-center gap-1">
            <button
              onClick={() => setActiveView('ledger')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                activeView === 'ledger' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ตารางข้อมูล
            </button>
            <button
              onClick={() => setActiveView('analytics')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                activeView === 'analytics' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              รายงานสรุป & กราฟ
            </button>
            <button
              onClick={() => setActiveView('void')}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                activeView === 'void' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              🚫 ติดตามการ Void
            </button>
          </div>

          {userRole !== 'visitor' && (
            <>
              <div className="h-6 w-[1px] bg-slate-200 hidden sm:block"></div>
              
              {/* Quick Date Edit Selector */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/75 border border-indigo-200 rounded-xl text-xs font-extrabold shadow-2xs transition-all relative cursor-pointer" title="เลือกวันที่เพื่อค้นหาข้อมูลของวันนั้นขึ้นมาแก้ไขด่วน">
                <Calendar className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                <span className="text-indigo-900 hidden md:inline whitespace-nowrap">แก้ไขตามวันที่:</span>
                <input
                  type="date"
                  onChange={handleEditByDateChange}
                  className="outline-none text-[11px] font-extrabold text-indigo-700 bg-transparent cursor-pointer border-none p-0 w-[110px]"
                />
              </div>

              <button
                id="btn-add-unified"
                onClick={handleOpenAddModal}
                className="px-4 py-1.5 bg-[#02A562] hover:bg-[#028f54] text-white shadow-emerald-100 border border-emerald-600 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4 stroke-[2.5px]" />
                <span>Add / บันทึกรายการ</span>
              </button>
            </>
          )}

        </div>
      </div>

      {/* Main Workspace Frame */}
      <main className="max-w-7xl mx-auto px-4 py-6 md:p-8 space-y-6">


        {/* DYNAMIC KPI SUMMARY CARDS */}
        <AnimatePresence>
          {showKpiCards && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pb-2">
                
                {/* Net Income */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.015)] relative overflow-hidden group ${themeStyles.cardHover} transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-extrabold tracking-tight uppercase">ยอดขายสุทธิรวมสองช่องทาง (Net Sales)</span>
                    <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 stroke-[2.5px]" />
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-extrabold text-slate-800 tracking-tight">
                      ฿{stats.netRevenue.toLocaleString('th-TH')}
                    </span>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-50 flex items-center justify-between text-[11px] sm:text-xs font-extrabold">
                    <span style={{ color: shopeeColor }}>Shopee: ฿{stats.shopee.netSales.toLocaleString('th-TH')}</span>
                    <span style={{ color: lazadaColor }}>Lazada: ฿{stats.lazada.netSales.toLocaleString('th-TH')}</span>
                  </div>
                </div>

                {/* Total Orders */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.015)] relative overflow-hidden group ${themeStyles.cardHover} transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-extrabold tracking-tight uppercase">จำนวนออเดอร์สะสม (Total Orders)</span>
                    <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <ShoppingBag className="w-4 h-4" />
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-extrabold text-blue-600 tracking-tight">
                      {stats.totalOrders.toLocaleString('th-TH')}{' '}
                      <span className="text-sm font-semibold text-slate-500">ออเดอร์</span>
                    </span>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-50 flex items-center justify-between text-[11px] sm:text-xs font-extrabold">
                    <span style={{ color: shopeeColor }}>Shopee: {stats.shopeeOrders} ออเดอร์</span>
                    <span style={{ color: lazadaColor }}>Lazada: {stats.lazadaOrders} ออเดอร์</span>
                  </div>
                </div>

                {/* Total Items */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.015)] relative overflow-hidden group ${themeStyles.cardHover} transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-extrabold tracking-tight uppercase">จำนวนชิ้นสะสม (Total Items)</span>
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Tag className="w-4 h-4" />
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-extrabold text-indigo-600 tracking-tight">
                      {stats.totalItems.toLocaleString('th-TH')}{' '}
                      <span className="text-sm font-semibold text-slate-500">ชิ้น</span>
                    </span>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-50 flex items-center justify-between text-[11px] sm:text-xs font-extrabold">
                    <span style={{ color: shopeeColor }}>Shopee: {stats.shopeeItems} ชิ้น</span>
                    <span style={{ color: lazadaColor }}>Lazada: {stats.lazadaItems} ชิ้น</span>
                  </div>
                </div>

                {/* Voided Cancellations */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.015)] relative overflow-hidden group ${themeStyles.cardHover} transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-xs font-extrabold tracking-tight uppercase">ยอดขอยกเลิก (Voids)</span>
                    <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4" />
                    </span>
                  </div>
                  <div>
                    <span className="text-2xl font-extrabold text-rose-600 tracking-tight">
                      ฿{stats.voidAmount.toLocaleString('th-TH')}
                    </span>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-50 flex items-center justify-between text-[10px] font-bold">
                    <span className="text-slate-400 font-medium">อัตราการยกเลิก:</span>
                    <span className="text-rose-500 font-extrabold">{voidRate}% ของ Gross</span>
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>


        {/* VIEW 1: DETAILED TRANSACTION LEDGER TABLE */}
        {activeView === 'ledger' && (
          <div className={`${themeStyles.card} border rounded-2xl shadow-sm overflow-hidden transition-all duration-300`}>
            
            {/* Table Controller: Search & Filters Bar */}
            <div className={`p-4 border-b ${themeStyles.border} ${themeStyles.bgMuted} flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 transition-colors duration-300`}>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">ตัวกรองรายการ</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200/70 text-slate-600 rounded-full">
                  แสดง {filteredTransactions.length} จาก {transactions.length} รายการ
                </span>
              </div>

              {/* Advanced Controls & Input */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Search query input */}
                <div className="relative min-w-[240px] flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input 
                    type="text"
                    placeholder="ค้นหาแพลตฟอร์ม, หมายเหตุ..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-white pl-8 pr-3 py-1.5 border border-slate-200 focus:border-emerald-500 rounded-lg text-xs outline-none transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Filter platform dropdown */}
                <select
                  value={filterPlatform}
                  onChange={e => setFilterPlatform(e.target.value as any)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 outline-none cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <option value="all">แพลตฟอร์มทั้งหมด</option>
                  <option value="shopee">Shopee</option>
                  <option value="lazada">Lazada</option>
                </select>

                {/* Filter type dropdown */}
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value as any)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 outline-none cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <option value="all">ประเภทรายการทั้งหมด</option>
                  <option value="sale">เฉพาะ ยอดขาย (Sale)</option>
                  <option value="void">เฉพาะ ยอด Void</option>
                </select>

                {/* Export Date Range Filters */}
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg">
                  <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">เลือกช่วงเวลา:</span>
                  <input
                    type="date"
                    value={summaryStartDate}
                    onChange={e => {
                      setSummaryStartDate(e.target.value);
                      if (e.target.value) {
                        setToast({ message: 'กำหนดช่วงเริ่มต้นของข้อมูลสำเร็จ', type: 'info' });
                      }
                    }}
                    className="outline-none text-[11px] font-extrabold text-slate-600 bg-white border border-slate-200/60 rounded px-1.5 py-0.5 max-w-[110px] cursor-pointer hover:border-emerald-500/50 transition-colors"
                    title="เลือกวันที่เริ่มต้นของข้อมูลที่จะกรองและส่งออก"
                  />
                  <span className="text-[11px] text-slate-400 font-extrabold">ถึง</span>
                  <input
                    type="date"
                    value={summaryEndDate}
                    onChange={e => {
                      setSummaryEndDate(e.target.value);
                      if (e.target.value) {
                        setToast({ message: 'กำหนดช่วงสิ้นสุดของข้อมูลสำเร็จ', type: 'info' });
                      }
                    }}
                    className="outline-none text-[11px] font-extrabold text-slate-600 bg-white border border-slate-200/60 rounded px-1.5 py-0.5 max-w-[110px] cursor-pointer hover:border-emerald-500/50 transition-colors"
                    title="เลือกวันที่สิ้นสุดของข้อมูลที่จะกรองและส่งออก"
                  />
                  {(summaryStartDate || summaryEndDate) && (
                    <button
                      onClick={() => {
                        setSummaryStartDate('');
                        setSummaryEndDate('');
                        setToast({ message: 'แสดงยอดขายทุกช่วงเวลา', type: 'info' });
                      }}
                      className="text-[10px] text-rose-500 hover:text-rose-700 font-extrabold hover:underline pl-0.5 cursor-pointer bg-transparent border-none"
                    >
                      ล้าง
                    </button>
                  )}
                </div>

                {/* General Export button */}
                <button
                  onClick={handleExportCSV}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                  title="ส่งออกรายงานในรูปแบบ Excel / CSV ภาษาไทย"
                >
                  <Download className="w-3 h-3 text-slate-400" />
                  <span>Export CSV (Excel)</span>
                </button>



              </div>
            </div>

            {/* WIDE DETAILED TABLE GRID */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className={`${themeStyles.tableHeader} border-b ${themeStyles.border} font-extrabold transition-colors duration-300`}>
                    <th className="p-4 w-[160px]">วันที่</th>
                    <th className="p-4 w-[150px]">แพลตฟอร์ม</th>
                    <th className="p-4">รายละเอียดการทำรายการ</th>
                    <th className="p-4 w-[110px] text-center">ออเดอร์</th>
                    <th className="p-4 w-[110px] text-center">จำนวนชิ้น</th>
                    <th className="p-4 w-[140px] text-right">จำนวนเงิน</th>
                    {userRole !== 'visitor' && <th className="p-4 w-[80px] text-center">จัดการ</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center p-16 text-slate-400 font-medium">
                        ไม่พบรายการตามที่ระบุในตัวกรอง หรือไม่มีข้อมูลเหลืออยู่
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const isShopee = tx.platform === 'shopee';
                      const isVoid = tx.type === 'void';
                      
                      // Status display indicating successful recording
                      let statusDisplay = (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 font-extrabold">
                          <CheckCircle className="w-4 h-4 stroke-[2.5px] text-emerald-500 flex-shrink-0" />
                          <span>บันทึกออเดอร์ขายสำเร็จ</span>
                        </span>
                      );
                      if (isVoid) {
                        statusDisplay = (
                          <span className="inline-flex items-center gap-1.5 text-rose-500 font-extrabold">
                            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                            <span>ออเดอร์ void สำเร็จ</span>
                          </span>
                        );
                      }

                      return (
                        <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors group">
                          
                          {/* 1. วันที่ (Date) */}
                          <td className="p-4 border-b border-slate-100 text-slate-500 font-semibold">
                            {formatThaiDate(tx.date)}
                          </td>

                          {/* 2. แพลตฟอร์ม (Platform: Shopee / Lazada) */}
                          <td className="p-4 border-b border-slate-100">
                            <div className="flex items-center gap-1.5">
                              {isShopee ? (
                                <span 
                                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-extrabold transition-colors duration-300"
                                  style={{ backgroundColor: `${shopeeColor}15`, color: shopeeColor }}
                                >
                                  S
                                </span>
                              ) : (
                                <span 
                                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-extrabold transition-colors duration-300"
                                  style={{ backgroundColor: `${lazadaColor}15`, color: lazadaColor }}
                                >
                                  L
                                </span>
                              )}
                              <span className="font-semibold text-slate-700">
                                {isShopee ? 'Shopee' : 'Lazada'}
                              </span>
                            </div>
                          </td>

                          {/* 3. รายละเอียดการทำรายการ (Status display only) */}
                          <td className="p-4 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                              {statusDisplay}
                            </div>
                          </td>

                          {/* 4. ออเดอร์ (Orders) */}
                          <td className="p-4 border-b border-slate-100 text-center font-extrabold text-slate-700">
                            {tx.orders > 0 ? `${tx.orders}` : '-'}
                          </td>

                          {/* 4.5 จำนวนชิ้น (Items) */}
                          <td className="p-4 border-b border-slate-100 text-center font-extrabold text-slate-700">
                            {tx.items !== undefined && tx.items > 0 ? `${tx.items}` : '-'}
                          </td>

                          {/* 5. จำนวนเงิน (Amount) */}
                          <td className="p-4 border-b border-slate-100 text-right">
                            <span className={`font-extrabold text-sm ${
                              isVoid ? 'text-rose-600' : 'text-emerald-600'
                            }`}>
                              {isVoid ? '-' : '+'}฿{tx.amount.toLocaleString('th-TH')}
                            </span>
                          </td>

                          {/* 6. Action Buttons (Edit / Delete) - Only show for User & Admin */}
                          {userRole !== 'visitor' && (
                            <td className="p-4 border-b border-slate-100 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleOpenEditModal(tx)}
                                  className="p-1 text-slate-300 hover:text-indigo-600 rounded-lg transition-colors animate-none cursor-pointer"
                                  title="แก้ไขรายการนี้"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteTargetId(tx.id)}
                                  className="p-1 text-slate-300 hover:text-rose-600 rounded-lg transition-colors animate-none cursor-pointer"
                                  title="ลบรายการนี้"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}

                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer Summary bar */}
            <div className="p-4 bg-slate-50/70 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] font-bold text-slate-500">
              <div className="flex flex-wrap items-center gap-4">
                <span>ยอดเงินก่อนหัก (Gross): ฿{stats.grossRevenue.toLocaleString('th-TH')}</span>
                <span>•</span>
                <span className="text-rose-500">ยอด Void รวม: ฿{stats.voidAmount.toLocaleString('th-TH')}</span>
                <span>•</span>
                <span className="text-emerald-600">ยอดขายรวมทั้งสิ้น (Net Revenue): ฿{stats.netRevenue.toLocaleString('th-TH')}</span>
              </div>
              <div className="text-slate-400 font-semibold">
                ปรับปรุงข้อมูลเรียลไทม์: {new Date().toLocaleDateString('th-TH')}
              </div>
            </div>

          </div>
        )}

        {/* VIEW 2: REPORTS & ANALYTICS CHARTS TAB */}
        {activeView === 'analytics' && (
          <div className="space-y-6">

            {/* Elegant Report Date Range Filter Panel */}
            <div className={`p-5 rounded-2xl border ${themeStyles.card} shadow-2xs space-y-4`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Calendar className="w-4 h-4 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">เลือกช่วงเวลาสำหรับรายงานสรุป (Report Period Filter)</h4>
                    <p className="text-[10px] text-slate-400 font-semibold">
                      {summaryStartDate || summaryEndDate ? (
                        <span className="text-emerald-600 font-extrabold">กำลังกรองข้อมูลเฉพาะช่วงเวลาที่เลือก</span>
                      ) : (
                        <span>กำลังแสดงยอดขายและสถิติตลอดเวลาสะสมทั้งหมด</span>
                      )}
                    </p>
                  </div>
                </div>
                
                {/* Statistics badge */}
                <span className="text-[10px] font-extrabold px-3 py-1 bg-slate-50 border border-slate-200/60 rounded-full text-slate-500 self-start md:self-center">
                  พบข้อมูล {summaryFilteredTransactions.length} จาก {transactions.length} รายการ
                </span>
              </div>

              {/* Controls Grid */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
                
                {/* Inputs area */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">ตั้งแต่วันที่:</span>
                    <input 
                      type="date"
                      value={summaryStartDate}
                      onChange={e => {
                        setSummaryStartDate(e.target.value);
                        if (e.target.value) {
                          setToast({ message: 'กำหนดวันเริ่มต้นสำเร็จ', type: 'info' });
                        }
                      }}
                      className="px-3 py-1.5 bg-white border border-slate-200 focus:border-emerald-500 rounded-lg text-xs font-bold text-slate-600 outline-none transition-all cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">ถึงวันที่:</span>
                    <input 
                      type="date"
                      value={summaryEndDate}
                      onChange={e => {
                        setSummaryEndDate(e.target.value);
                        if (e.target.value) {
                          setToast({ message: 'กำหนดวันสิ้นสุดสำเร็จ', type: 'info' });
                        }
                      }}
                      className="px-3 py-1.5 bg-white border border-slate-200 focus:border-emerald-500 rounded-lg text-xs font-bold text-slate-600 outline-none transition-all cursor-pointer"
                    />
                  </div>

                  {(summaryStartDate || summaryEndDate) && (
                    <button
                      onClick={() => {
                        setSummaryStartDate('');
                        setSummaryEndDate('');
                        setToast({ message: 'แสดงข้อมูลทั้งหมด', type: 'info' });
                      }}
                      className="px-3 py-1.5 text-xs font-extrabold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer"
                    >
                      ล้างตัวกรอง
                    </button>
                  )}
                </div>

                {/* Presets and PDF Action area */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-400 mr-1">เลือกด่วน:</span>
                    <button
                      onClick={() => setPresetRange('7days')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        summaryStartDate && summaryEndDate && (new Date(summaryEndDate).getTime() - new Date(summaryStartDate).getTime() <= 6 * 24 * 3600 * 1000 + 100) && !(new Date(summaryEndDate).getTime() - new Date(summaryStartDate).getTime() < 5 * 24 * 3600 * 1000)
                          ? 'bg-emerald-600 text-white shadow-xs font-extrabold'
                          : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      7 วันล่าสุด
                    </button>
                    <button
                      onClick={() => setPresetRange('30days')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        summaryStartDate && summaryEndDate && (new Date(summaryEndDate).getTime() - new Date(summaryStartDate).getTime() > 20 * 24 * 3600 * 1000)
                          ? 'bg-emerald-600 text-white shadow-xs font-extrabold'
                          : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      30 วันล่าสุด
                    </button>
                    <button
                      onClick={() => setPresetRange('all')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        !summaryStartDate && !summaryEndDate
                          ? 'bg-emerald-600 text-white shadow-xs font-extrabold'
                          : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600'
                      }`}
                    >
                      แสดงทั้งหมด
                    </button>
                  </div>

                  <div className="h-6 w-[1px] bg-slate-200 hidden sm:block"></div>

                  <button
                    onClick={handleExportPDF}
                    disabled={isPrintingPDF}
                    className={`px-3.5 py-1.5 text-xs font-extrabold rounded-lg shadow-xs border flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer ${
                      isPrintingPDF
                        ? 'bg-slate-100 text-slate-400 border-slate-200'
                        : 'bg-rose-600 hover:bg-rose-700 border-rose-700 text-white shadow-xs'
                    }`}
                  >
                    {isPrintingPDF ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>{isPrintingPDF ? 'กำลังสร้าง PDF...' : 'ส่งออกรายงาน PDF 📄'}</span>
                  </button>
                </div>

              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Detailed Grouped Lists (Daily / Monthly) */}
              <div className={`lg:col-span-7 ${themeStyles.card} border rounded-2xl shadow-sm overflow-hidden transition-all duration-300`}>
                
                {/* Selector Header inside Panel */}
                <div className={`${themeStyles.bgMuted} border-b ${themeStyles.border} px-5 pt-4 flex gap-2 overflow-x-auto transition-colors duration-300`}>
                  <button
                    onClick={() => setActiveTab('daily')}
                    className={`px-5 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                      activeTab === 'daily' 
                        ? 'border-emerald-600 text-emerald-600 font-extrabold' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    รายงานสรุปยอดขายรายวันรวมกัน
                  </button>
                  <button
                    onClick={() => setActiveTab('monthly')}
                    className={`px-5 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                      activeTab === 'monthly' 
                        ? 'border-emerald-600 text-emerald-600 font-extrabold' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    รายงานยอดขายรายเดือน
                  </button>
                  <button
                    onClick={() => setActiveTab('charts')}
                    className={`px-5 py-3 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                      activeTab === 'charts' 
                        ? 'border-emerald-600 text-emerald-600 font-extrabold' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    กราฟเปรียบเทียบแนวโน้ม (Trend)
                  </button>
                </div>

                <div className="p-6">
                  
                  {/* Daily list - "รวมยอดขายรายวันรวมกัน 2 แพลตฟอร์ม" */}
                  {activeTab === 'daily' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">ตารางสรุปยอดขายรายวันสะสมร่วมกัน 2 แพลตฟอร์ม</h3>
                          <p className="text-[10px] text-slate-400 font-medium">รวมผลงานขายรายวันของ Shopee และ Lazada สุทธิแบบรวมศูนย์</p>
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold">ล่าสุด</span>
                      </div>

                      <div className="overflow-x-auto border border-slate-100 rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-extrabold">
                              <th className="p-3">วันที่</th>
                              <th className="p-3 text-center bg-emerald-50/40 text-emerald-700">ยอดสุทธิรวมกัน (฿)</th>
                              <th className="p-3 text-center">ออเดอร์รวม (รายการ)</th>
                              <th className="p-3 text-center">สัดส่วนรายละเอียดแพลตฟอร์ม</th>
                              <th className="p-3 text-right">ยอดตัดหัก Void (฿)</th>
                              <th className="p-3 text-center">คัดลอกสรุป</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-medium text-slate-600">
                            {dailyReport.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="text-center p-8 text-slate-400">ไม่มีสถิติสะสมรายวัน</td>
                              </tr>
                            ) : (
                              dailyReport.map(row => (
                                <tr key={row.date} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="p-3 font-extrabold text-slate-800">{formatThaiDate(row.date)}</td>
                                  <td className="p-3 text-center text-emerald-600 font-extrabold bg-emerald-50/20">฿{row.totalNet.toLocaleString('th-TH')}</td>
                                  <td className="p-3 text-center">
                                    <div className="font-extrabold text-slate-700">{row.totalOrders.toLocaleString('th-TH')} <span className="text-[10px] text-slate-400 font-normal">ออเดอร์</span></div>
                                    <div className="text-[9px] text-slate-400 font-medium">(S: {row.shopeeOrders} | L: {row.lazadaOrders})</div>
                                  </td>
                                  <td className="p-3 text-center text-[10px] font-bold">
                                    <span style={{ color: shopeeColor }}>Shopee: ฿{row.shopeeNet.toLocaleString('th-TH')}</span>
                                    <span className="text-slate-300 mx-2">|</span>
                                    <span style={{ color: lazadaColor }}>Lazada: ฿{row.lazadaNet.toLocaleString('th-TH')}</span>
                                  </td>
                                  <td className="p-3 text-right text-rose-500 font-bold">฿{(row.shopeeVoid + row.lazadaVoid).toLocaleString('th-TH')}</td>
                                  <td className="p-3 text-center">
                                    <button
                                      onClick={() => handleCopyDailySummary(row)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-slate-200 rounded-lg active:scale-95 transition-all cursor-pointer"
                                      title="คัดลอกสรุปยอดขายสำหรับส่งรายงานแชท"
                                    >
                                      <Copy className="w-3 h-3 text-emerald-600" />
                                      <span>คัดลอกสรุป</span>
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Monthly List */}
                  {activeTab === 'monthly' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">ตารางสรุปสะสมรายเดือนปฏิทิน</h3>
                        <span className="text-[10px] text-slate-400 font-bold">ล่าสุด</span>
                      </div>

                      <div className="overflow-x-auto border border-slate-100 rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-extrabold">
                              <th className="p-3">เดือนปฏิทิน</th>
                              <th className="p-3 text-center bg-emerald-50/40 text-emerald-700">รายได้สุทธิรวม (฿)</th>
                              <th className="p-3 text-center">ออเดอร์รวม (รายการ)</th>
                              <th className="p-3 text-center">สัดส่วนรายละเอียดแพลตฟอร์ม</th>
                              <th className="p-3 text-right">ยอด Void หัก (฿)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-medium text-slate-600">
                            {monthlyReport.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="text-center p-8 text-slate-400">ไม่มีสถิติสะสมรายเดือน</td>
                              </tr>
                            ) : (
                              monthlyReport.map(row => (
                                <tr key={row.month} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="p-3 font-extrabold text-slate-800">{formatThaiMonth(row.month)}</td>
                                  <td className="p-3 text-center text-emerald-600 font-extrabold bg-emerald-50/20">฿{row.totalNet.toLocaleString('th-TH')}</td>
                                  <td className="p-3 text-center">
                                    <div className="font-extrabold text-slate-700">{row.totalOrders.toLocaleString('th-TH')} <span className="text-[10px] text-slate-400 font-normal">ออเดอร์</span></div>
                                    <div className="text-[9px] text-slate-400 font-medium">(S: {row.shopeeOrders} | L: {row.lazadaOrders})</div>
                                  </td>
                                  <td className="p-3 text-center text-[10px] font-bold">
                                    <span style={{ color: shopeeColor }}>Shopee: ฿{row.shopeeNet.toLocaleString('th-TH')}</span>
                                    <span className="text-slate-300 mx-2">|</span>
                                    <span style={{ color: lazadaColor }}>Lazada: ฿{row.lazadaNet.toLocaleString('th-TH')}</span>
                                  </td>
                                  <td className="p-3 text-right text-rose-500 font-bold">฿{(row.shopeeVoid + row.lazadaVoid).toLocaleString('th-TH')}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Line Trend Chart Tab */}
                  {activeTab === 'charts' && (
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider mb-1">กราฟแนวโน้มการจำหน่ายสะสม</h3>
                        <p className="text-slate-400 text-[10px] font-semibold">เปรียบเทียบความเคลื่อนไหวของยอดขายสุทธิ Shopee และ Lazada รวมช่องทาง</p>
                      </div>

                      {chartPoints.length === 0 ? (
                        <div className="h-64 border-2 border-dashed border-slate-100 rounded-xl flex flex-col items-center justify-center text-slate-400">
                          <BarChart3 className="w-8 h-8 mb-2 text-slate-300" />
                          <span className="text-xs font-semibold">ไม่มีรายการสะสมที่จะวาดเป็นกราฟสถิติ</span>
                        </div>
                      ) : (
                        <div className="bg-slate-50/40 border border-slate-100 p-4 rounded-xl">
                          <svg viewBox="0 0 500 220" className="w-full h-auto overflow-visible">
                            <line x1="50" y1="50" x2="480" y2="50" stroke="#f1f5f9" strokeWidth="1" />
                            <line x1="50" y1="115" x2="480" y2="115" stroke="#f1f5f9" strokeWidth="1" />
                            <line x1="50" y1="180" x2="480" y2="180" stroke="#e2e8f0" strokeWidth="1.5" />

                            {chartPoints.map((p, i) => (
                              <text key={i} x={p.x} y="200" textAnchor="middle" className="text-[9px] fill-slate-400 font-extrabold">
                                {p.date.substring(5, 10).replace('-', '/')}
                              </text>
                            ))}

                            {/* Paths */}
                            <path
                              d={`M ${chartPoints.map(p => `${p.x} ${p.yShopee}`).join(' L ')}`}
                              fill="none"
                              stroke={shopeeColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />
                            <path
                              d={`M ${chartPoints.map(p => `${p.x} ${p.yLazada}`).join(' L ')}`}
                              fill="none"
                              stroke={lazadaColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />
                            <path
                              d={`M ${chartPoints.map(p => `${p.x} ${p.yTotal}`).join(' L ')}`}
                              fill="none"
                              stroke="#10B981"
                              strokeWidth="2"
                              strokeDasharray="3 3"
                            />

                            {/* Circles */}
                            {chartPoints.map((p, i) => (
                              <g key={i}>
                                <circle cx={p.x} cy={p.yShopee} r="3.5" fill={shopeeColor} stroke="#fff" strokeWidth="1" />
                                <circle cx={p.x} cy={p.yLazada} r="3.5" fill={lazadaColor} stroke="#fff" strokeWidth="1" />
                              </g>
                            ))}
                          </svg>

                          <div className="flex items-center justify-center gap-5 mt-4 text-[9px] font-bold">
                            <span className="flex items-center gap-1 font-extrabold" style={{ color: shopeeColor }}>
                              <span className="w-2.5 h-1 rounded-full inline-block" style={{ backgroundColor: shopeeColor }}></span>
                              <span>Shopee Net</span>
                            </span>
                            <span className="flex items-center gap-1 font-extrabold" style={{ color: lazadaColor }}>
                              <span className="w-2.5 h-1 rounded-full inline-block" style={{ backgroundColor: lazadaColor }}></span>
                              <span>Lazada Net</span>
                            </span>
                            <span className="flex items-center gap-1 text-[#10B981]">
                              <span className="w-2.5 h-1 border-b-2 border-dashed border-[#10B981] inline-block"></span>
                              <span>ยอดขายสะสมรวม</span>
                            </span>
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                </div>
              </div>

              {/* Platform Performance KPIs */}
              <div className="lg:col-span-5 space-y-6">
                
                {/* Shopee performance Detail card */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-sm relative overflow-hidden transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: shopeeColor }}></span>
                      <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">ประสิทธิภาพยอดขาย Shopee</h4>
                    </div>
                    <span className="text-slate-400 font-mono text-[10px] font-bold">ส่วนแบ่ง: {stats.shopee.revenueShare}%</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className={`${themeStyles.bgMuted} p-3 rounded-xl border ${themeStyles.border} transition-colors duration-300`}>
                      <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">ยอดขายดิบ</span>
                      <span className="text-sm font-extrabold text-slate-700">฿{stats.shopee.grossSales.toLocaleString('th-TH')}</span>
                    </div>
                    <div className={`${themeStyles.bgMuted} p-3 rounded-xl border ${themeStyles.border} transition-colors duration-300`}>
                      <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">ยอดหัก Void</span>
                      <span className="text-sm font-extrabold text-rose-500">฿{stats.shopee.voidAmount.toLocaleString('th-TH')}</span>
                    </div>
                  </div>

                  {/* Progress slide */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-extrabold text-slate-400">
                      <span>ยอดขายจริงหลังหัก (Net)</span>
                      <span className="text-emerald-600 font-extrabold">฿{stats.shopee.netSales.toLocaleString('th-TH')}</span>
                    </div>
                    <div className={`${themeStyles.bgMuted} h-2 rounded-full overflow-hidden transition-colors duration-300`}>
                      <div 
                        className="h-full"
                        style={{ 
                          backgroundColor: shopeeColor,
                          width: `${stats.shopee.grossSales > 0 
                            ? (stats.shopee.netSales / stats.shopee.grossSales) * 100 
                             : 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Lazada performance Detail card */}
                <div className={`${themeStyles.card} border p-5 rounded-2xl shadow-sm relative overflow-hidden transition-all duration-300`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lazadaColor }}></span>
                      <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">ประสิทธิภาพยอดขาย Lazada</h4>
                    </div>
                    <span className="text-slate-400 font-mono text-[10px] font-bold">ส่วนแบ่ง: {stats.lazada.revenueShare}%</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className={`${themeStyles.bgMuted} p-3 rounded-xl border ${themeStyles.border} transition-colors duration-300`}>
                      <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">ยอดขายดิบ</span>
                      <span className="text-sm font-extrabold text-slate-700">฿{stats.lazada.grossSales.toLocaleString('th-TH')}</span>
                    </div>
                    <div className={`${themeStyles.bgMuted} p-3 rounded-xl border ${themeStyles.border} transition-colors duration-300`}>
                      <span className="text-[10px] font-bold text-slate-400 block uppercase mb-1">ยอดหัก Void</span>
                      <span className="text-sm font-extrabold text-rose-500">฿{stats.lazada.voidAmount.toLocaleString('th-TH')}</span>
                    </div>
                  </div>

                  {/* Progress slide */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-extrabold text-slate-400">
                      <span>ยอดขายจริงหลังหัก (Net)</span>
                      <span className="text-emerald-600 font-extrabold">฿{stats.lazada.netSales.toLocaleString('th-TH')}</span>
                    </div>
                    <div className={`${themeStyles.bgMuted} h-2 rounded-full overflow-hidden transition-colors duration-300`}>
                      <div 
                        className="h-full"
                        style={{ 
                          backgroundColor: lazadaColor,
                          width: `${stats.lazada.grossSales > 0 
                            ? (stats.lazada.netSales / stats.lazada.grossSales) * 100 
                            : 0}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* VIEW 3: DEDICATED VOID TRACKING TAB */}
        {activeView === 'void' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Title & Description Header Block */}
            <div className="bg-white border border-slate-200/80 p-6 rounded-2xl shadow-2xs">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center border border-rose-100 flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 stroke-[2.2px]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">
                      กระดานติดตามและวิเคราะห์สาเหตุการ Void (Void Tracking Dashboard)
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      วิเคราะห์รายละเอียดและเหตุผลของการยกเลิกรายการขาย (Void) ทั้ง Shopee และ Lazada พร้อมตัวกรองเวลาโดยเฉพาะ
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Elegant Report Date Range Filter Panel (Void Specific) */}
            <div className={`p-5 rounded-2xl border ${themeStyles.card} shadow-2xs space-y-4`}>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 flex-shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">เลือกกรองช่วงเวลาประวัติการ Void</h4>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">ค้นหาหรือระบุช่วงวันที่ต้องการสืบค้นหาสาเหตุการยกเลิก</p>
                  </div>
                </div>

                {/* Preset Ranges */}
                <div className="flex flex-wrap items-center gap-1.5 self-start lg:self-center">
                  <span className="text-[10px] font-bold text-slate-400 mr-1.5 hidden sm:inline">ช่วงเวลาด่วน:</span>
                  <button
                    type="button"
                    onClick={() => setVoidPresetRange('all')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ${
                      !voidStartDate && !voidEndDate
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ทั้งหมด
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoidPresetRange('7days')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ${
                      voidStartDate && voidEndDate && (new Date(voidEndDate).getTime() - new Date(voidStartDate).getTime() <= 7 * 24 * 60 * 60 * 1000)
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ย้อนหลัง 7 วัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoidPresetRange('30days')}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ${
                      voidStartDate && voidEndDate && (new Date(voidEndDate).getTime() - new Date(voidStartDate).getTime() > 7 * 24 * 60 * 60 * 1000)
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ย้อนหลัง 30 วัน
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-slate-100 w-full" />

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">ตั้งแต่วันที่</label>
                  <input
                    type="date"
                    value={voidStartDate}
                    onChange={e => {
                      setVoidStartDate(e.target.value);
                      setToast({ message: `เปลี่ยนวันที่เริ่มการ Void เป็น ${formatThaiDate(e.target.value)}`, type: 'info' });
                    }}
                    className="w-full pl-3 pr-3 py-2.5 text-xs font-extrabold text-slate-700 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">ถึงวันที่</label>
                  <input
                    type="date"
                    value={voidEndDate}
                    onChange={e => {
                      setVoidEndDate(e.target.value);
                      setToast({ message: `เปลี่ยนวันที่สิ้นสุดการ Void เป็น ${formatThaiDate(e.target.value)}`, type: 'info' });
                    }}
                    className="w-full pl-3 pr-3 py-2.5 text-xs font-extrabold text-slate-700 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all cursor-pointer"
                  />
                </div>

                <div className="flex gap-2">
                  {(voidStartDate || voidEndDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoidStartDate('');
                        setVoidEndDate('');
                        setToast({ message: 'ล้างตัวกรองวันที่ Void เรียบร้อยแล้ว', type: 'info' });
                      }}
                      className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all cursor-pointer flex-1 flex items-center justify-center gap-1.5 h-[42px]"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>ล้างค่า</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Custom KPI Cards for Current Filtered Period */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Card 1: Total Voided Amount */}
              <div className={`p-5 rounded-2xl border ${themeStyles.card} relative overflow-hidden group hover:shadow-md transition-all duration-300`}>
                <div className="absolute top-0 right-0 p-3 text-rose-100/30 group-hover:scale-110 transition-transform duration-300 pointer-events-none">
                  <AlertTriangle className="w-16 h-16 stroke-[1px]" />
                </div>
                <div className="relative space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ยอดเงินที่ถูก Void รวม</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-rose-600 tracking-tight">฿{totalVoidAmount.toLocaleString('th-TH')}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-semibold">ยอดรวมความเสียหายที่พบในช่วงเวลาที่เลือก</p>
                </div>
              </div>

              {/* Card 2: Total Voided Orders */}
              <div className={`p-5 rounded-2xl border ${themeStyles.card} relative overflow-hidden group hover:shadow-md transition-all duration-300`}>
                <div className="absolute top-0 right-0 p-3 text-rose-100/30 group-hover:scale-110 transition-transform duration-300 pointer-events-none">
                  <ShoppingBag className="w-16 h-16 stroke-[1px]" />
                </div>
                <div className="relative space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">จำนวนออเดอร์ที่ยกเลิก</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-slate-700 tracking-tight">{totalVoidOrders}</span>
                    <span className="text-xs font-extrabold text-slate-400">ออเดอร์</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-semibold">ปริมาณจำนวนกล่อง/คำสั่งซื้อที่ทำการ Void</p>
                </div>
              </div>

              {/* Card 3: Total Reported Reasons */}
              <div className={`p-5 rounded-2xl border ${themeStyles.card} relative overflow-hidden group hover:shadow-md transition-all duration-300`}>
                <div className="absolute top-0 right-0 p-3 text-indigo-100/30 group-hover:scale-110 transition-transform duration-300 pointer-events-none">
                  <Tag className="w-16 h-16 stroke-[1px]" />
                </div>
                <div className="relative space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">จำนวนรายการระบุเหตุผล</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-indigo-600 tracking-tight">
                      {voidTransactionsWithNotes.filter(tx => tx.note && tx.note.trim() !== '').length}
                    </span>
                    <span className="text-xs font-extrabold text-slate-400">/ {voidTransactionsWithNotes.length} รายการ</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-semibold">รายการที่มีบันทึกระบุสาเหตุการ Void</p>
                </div>
              </div>
            </div>

            {/* The Detailed Void Transactions Table with Control Instruments */}
            <div className={`${themeStyles.card} border rounded-2xl shadow-xs overflow-hidden`}>
              {/* Header */}
              <div className={`p-5 border-b ${themeStyles.border} ${themeStyles.bgMuted} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2`}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center border border-rose-100 flex-shrink-0">
                    <AlertTriangle className="w-4.5 h-4.5 stroke-[2.2px]" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">ตารางตรวจสอบสาเหตุและข้อมูลการ Void</h4>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">ค้นหาและวิเคราะห์สาเหตุการแก้ไขหรือถอนรายการธุรกรรม</p>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-full shadow-3xs self-start sm:self-center">
                  กรองพบทั้งหมด {voidTransactionsWithNotes.length} รายการ
                </span>
              </div>

              <div className="p-5 pt-0 space-y-4">
                <div className="h-1"></div>
                {voidTransactionsWithNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-100">
                    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                      <Info className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-bold text-slate-600">ไม่มีประวัติการ Void ในช่วงเวลาที่เลือก</p>
                    <p className="text-[10px] text-slate-400 font-semibold mt-1">
                      {totalVoidAmount > 0 
                        ? "💡 มีบางรายการถูก Void แต่ยังไม่มีการระบุสาเหตุเพิ่มเติมในช่องหมายเหตุ" 
                        : "🎉 ยอดเยี่ยม! ไม่พบรายการถูกยกเลิก (Void) ในช่วงเวลานี้เลย"}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead className="sticky top-0 bg-white z-10">
                        <tr className="border-b border-slate-100 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider bg-white">
                          <th className="py-3 px-3">วันที่ทำรายการ</th>
                          <th className="py-3 px-3 w-[120px]">ช่องทาง</th>
                          <th className="py-3 px-3">สาเหตุ / เหตุผลหลักการ Void</th>
                          <th className="py-3 px-3 text-center w-[120px]">จำนวนที่ยกเลิก</th>
                          <th className="py-3 px-3 text-right w-[140px]">จำนวนเงินรวม</th>
                          <th className="py-3 px-3 text-center w-[120px]">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60">
                        {voidTransactionsWithNotes.map((tx) => {
                          const isShopee = tx.platform === 'shopee';
                          return (
                            <tr key={tx.id} className="hover:bg-slate-50/40 transition-colors">
                              <td className="py-3 px-3">
                                <span className="text-[11px] font-extrabold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                                  {formatThaiDate(tx.date)}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span 
                                    className="w-4.5 h-4.5 rounded-md flex items-center justify-center text-[10px] font-extrabold"
                                    style={{ backgroundColor: `${isShopee ? shopeeColor : lazadaColor}12`, color: isShopee ? shopeeColor : lazadaColor }}
                                  >
                                    {isShopee ? 'S' : 'L'}
                                  </span>
                                  <span className="text-xs font-bold text-slate-700">
                                    {isShopee ? 'Shopee' : 'Lazada'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                {tx.note && tx.note.trim() !== '' ? (
                                  <div className="bg-rose-50/60 border border-rose-100/40 px-3 py-1.5 rounded-xl inline-block max-w-full">
                                    <span className="text-xs font-extrabold text-rose-700 leading-relaxed whitespace-pre-wrap">
                                      💬 {tx.note}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="bg-slate-100 border border-slate-200/60 px-3 py-1.5 rounded-xl inline-block max-w-full">
                                    <span className="text-xs font-extrabold text-slate-400 leading-relaxed whitespace-pre-wrap">
                                      ไม่ได้ระบุสาเหตุ
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 text-center">
                                <span className="text-xs font-extrabold text-rose-600 bg-rose-50/80 border border-rose-100/40 px-2.5 py-1 rounded-lg font-mono">
                                  {tx.orders || 0} ออเดอร์
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right">
                                <span className="text-xs font-extrabold text-rose-500 font-mono">
                                  -฿{tx.amount.toLocaleString('th-TH')}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditModal(tx)}
                                    className="p-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-indigo-200 text-slate-500 hover:text-indigo-600 rounded-lg transition-all cursor-pointer"
                                    title="แก้ไขข้อมูลรายการ Void"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  {userRole === 'admin' && (
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTargetId(tx.id)}
                                      className="p-1.5 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 rounded-lg transition-all cursor-pointer"
                                      title="ลบข้อมูลรายการ Void"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}



      </main>

      {/* COMPACT MODAL: Add New Transaction (SINGLE ENTRY PLACE) */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            
            {/* Modal Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 z-10 space-y-5"
            >
              
              {/* Header with platform-specific branding color */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-3">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
                    formData.platform === 'shopee' 
                      ? 'bg-orange-50 border-orange-100 text-[#F53D2D]' 
                      : 'bg-blue-50 border-blue-100 text-[#2563EB]'
                  }`}>
                    {editingTransactionId ? (
                      <Pencil className="w-5 h-5 stroke-[2.5px]" />
                    ) : (
                      <Plus className="w-5 h-5 stroke-[2.5px]" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-[16px] tracking-tight">
                      {editingTransactionId ? 'แก้ไขรายการยอดขาย' : 'บันทึกยอดขาย'} {formData.platform === 'shopee' ? 'Shopee' : 'Lazada'}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      {editingTransactionId ? `รหัสอ้างอิง: ${editingTransactionId}` : `บันทึกยอดขายลง Google Sheet สำหรับ ${formData.platform === 'shopee' ? 'Shopee' : 'Lazada'}`}
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleAddTransaction} className="space-y-4 text-xs font-semibold text-slate-600">
                <div className="grid grid-cols-2 gap-4">
                  
                  {/* วันที่ทำรายการ - Full Width */}
                  <div className="space-y-1.5 col-span-2">
                    <label className="text-[11px] font-bold text-slate-500 block">วันที่ทำรายการ</label>
                    <input 
                      type="date"
                      value={formData.date}
                      onChange={e => handleFormChange({ date: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-medium text-slate-700 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    />
                  </div>

                  {/* แพลตฟอร์ม - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">แพลตฟอร์ม</label>
                    <select
                      value={formData.platform}
                      onChange={e => handleFormChange({ platform: e.target.value as any })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-bold text-slate-700 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    >
                      <option value="shopee">Shopee</option>
                      <option value="lazada">Lazada</option>
                    </select>
                  </div>

                  {/* ประเภทรายการ - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">ประเภทรายการ</label>
                    <select
                      value={formData.type}
                      onChange={e => handleFormChange({ type: e.target.value as any })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-bold text-slate-700 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    >
                      <option value="sale">ยอดขาย (Sale)</option>
                      <option value="void">ยอด Void</option>
                    </select>
                  </div>

                  {/* จำนวนเงิน (บาท) - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      {formData.type === 'void' ? 'จำนวนเงินที่ Void (บาท)' : 'จำนวนเงินยอดขาย (บาท)'}
                    </label>
                    <input 
                      type="number"
                      step="any"
                      placeholder="0.00"
                      name="tx_amount_value"
                      id="tx_amount_value"
                      autoComplete="off"
                      value={formData.amount}
                      onChange={e => handleFormChange({ amount: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-bold text-slate-800 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    />
                    {formData.type === 'void' && (
                      <span className="text-[9px] text-rose-500 font-bold block leading-normal mt-0.5">
                        * ระบบจะนำยอดนี้ไปหักลบจากยอดรวมสะสม (Gross) โดยอัตโนมัติ
                      </span>
                    )}
                  </div>

                  {/* จำนวนออเดอร์ - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      {formData.type === 'void' ? 'จำนวนออเดอร์ที่ยกเลิก' : 'จำนวนออเดอร์'}
                    </label>
                    <input 
                      type="number"
                      min="0"
                      placeholder=""
                      name="tx_orders_count"
                      id="tx_orders_count"
                      autoComplete="off"
                      value={formData.orders}
                      onChange={e => handleFormChange({ orders: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-bold text-slate-800 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    />
                  </div>

                  {/* จำนวนชิ้น - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      {formData.type === 'void' ? 'จำนวนชิ้นที่ยกเลิก' : 'จำนวนชิ้น (ชิ้น)'}
                    </label>
                    <input 
                      type="number"
                      min="0"
                      placeholder=""
                      name="tx_items_count"
                      id="tx_items_count"
                      autoComplete="off"
                      value={formData.items}
                      onChange={e => handleFormChange({ items: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-bold text-slate-800 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    />
                  </div>

                  {/* รหัสผู้บันทึกข้อมูล (แบบดึงข้อมูลอัตโนมัติจากการล็อกอิน) - Half Width */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">👤 บันทึกข้อมูลด้วยบัญชี</label>
                    <div className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl font-bold text-slate-500 select-none cursor-not-allowed">
                      {loggedInUserCode || 'Auehen'} (ล็อกอินอัตโนมัติ)
                    </div>
                  </div>

                  {/* หมายเหตุ / ข้อมูลเพิ่มเติม - Full Width */}
                  <div className="space-y-1.5 col-span-2">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      {formData.type === 'void' ? 'สาเหตุ / เหตุผลการ Void' : 'หมายเหตุ / ข้อมูลเพิ่มเติม'}
                    </label>
                    <input 
                      type="text"
                      placeholder={formData.type === 'void' ? 'ระบุสาเหตุที่ยกเลิก (เช่น ลูกค้าขอยกเลิก, พัสดุตีกลับ, คืนเงิน)' : 'ระบุหมายเหตุย่อ...'}
                      value={formData.note}
                      onChange={e => handleFormChange({ note: e.target.value })}
                      className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none transition-all font-medium text-slate-800 ${
                        formData.platform === 'shopee' ? 'focus:bg-white focus:border-[#F53D2D]' : 'focus:bg-white focus:border-[#2563EB]'
                      }`}
                    />
                  </div>

                </div>

                {/* Footer buttons with styled cancel and submit */}
                <div className="pt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="w-[45%] py-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-2xl text-xs font-bold transition-all cursor-pointer border border-transparent hover:border-slate-200 text-center"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className={`w-[50%] py-3 text-white rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg ${
                      formData.platform === 'shopee' 
                        ? 'bg-[#F53D2D] hover:bg-[#d43122] shadow-orange-500/10' 
                        : 'bg-[#2563EB] hover:bg-[#1d4ed8] shadow-blue-500/10'
                    }`}
                  >
                    {editingTransactionId ? (
                      <>
                        <CheckCircle className="w-4 h-4 stroke-[2.5px]" />
                        <span>บันทึกการแก้ไข</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 stroke-[2.5px]" />
                        <span>บันทึกข้อมูล</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTargetId && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl border border-slate-100 p-6 max-w-sm w-full shadow-2xl space-y-5 overflow-hidden"
            >
              {/* Icon & Title */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0 border border-rose-100">
                  <Trash2 className="w-6 h-6 stroke-[2px]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-[16px] tracking-tight">
                    ยืนยันการลบรายการ?
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    ระบบจะดำเนินการลบรายการนี้ออกจากระบบอย่างถาวร
                  </p>
                </div>
              </div>

              {/* ID Reference Details */}
              <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>รหัสรายการ:</span>
                  <span className="font-bold text-slate-700">{deleteTargetId}</span>
                </div>
                {(() => {
                  const tx = transactions.find(t => t.id === deleteTargetId);
                  if (!tx) return null;
                  return (
                    <>
                      <div className="flex justify-between text-slate-500">
                        <span>แพลตฟอร์ม:</span>
                        <span className="font-bold text-slate-700 capitalize">
                          {tx.platform === 'shopee' ? 'Shopee' : 'Lazada'}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>ประเภท:</span>
                        <span className={`font-bold ${tx.type === 'void' ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {tx.type === 'void' ? 'ยอด Void' : 'ยอดขาย (Sale)'}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-500">
                        <span>จำนวนเงิน:</span>
                        <span className="font-extrabold text-slate-800">
                          ฿{tx.amount.toLocaleString('th-TH')}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Message */}
              <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                * คุณแน่ใจใช่หรือไม่ว่าต้องการลบธุรกรรมนี้จริง ๆ ? รายการที่ถูกลบจะไม่สามารถกู้คืนกลับมาได้อีก
              </p>

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                  className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-rose-500/15"
                >
                  ลบรายการถาวร
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Multiple Transactions Select Modal for Edit by Date */}
      <AnimatePresence>
        {dateSelectionTransactions && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl border border-slate-100 p-6 max-w-md w-full shadow-2xl space-y-5 overflow-hidden"
            >
              {/* Icon & Title */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 border border-indigo-100">
                  <Calendar className="w-6 h-6 stroke-[2px]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-[16px] tracking-tight">
                    เลือกรายการที่จะแก้ไข
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    พบรายการทำธุรกรรมทั้งหมด {dateSelectionTransactions.length} รายการ ในวันที่ {formatThaiDate(selectedQueryDate)}
                  </p>
                </div>
              </div>

              {/* Transactions List */}
              <div className="max-h-[250px] overflow-y-auto space-y-2 pr-1">
                {dateSelectionTransactions.map((tx) => {
                  const isShopee = tx.platform === 'shopee';
                  const isVoid = tx.type === 'void';
                  return (
                    <div 
                      key={tx.id} 
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-100 bg-slate-50/50 hover:bg-slate-50 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <span 
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-extrabold"
                          style={{ 
                            backgroundColor: isShopee ? `${shopeeColor}15` : `${lazadaColor}15`, 
                            color: isShopee ? shopeeColor : lazadaColor 
                          }}
                        >
                          {isShopee ? 'S' : 'L'}
                        </span>
                        <div>
                          <p className="font-bold text-xs text-slate-700 capitalize">
                            {isShopee ? 'Shopee' : 'Lazada'} - {isVoid ? 'ยอด Void' : 'ยอดขาย (Sale)'}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {tx.note || (isVoid ? 'ออเดอร์ void สำเร็จ' : 'บันทึกออเดอร์ยอดขายสำเร็จ')}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className={`font-extrabold text-xs ${isVoid ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {isVoid ? '-' : '+'}฿{tx.amount.toLocaleString('th-TH')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            handleOpenEditModal(tx);
                            setDateSelectionTransactions(null);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg transition-all cursor-pointer shadow-xs"
                        >
                          แก้ไข
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDateSelectionTransactions(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* APPSHEET / GOOGLE SHEETS ACCESS PASSWORD MODAL */}
      <AnimatePresence>
        {isPasswordModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            
            {/* Modal Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsPasswordModalOpen(false);
                setPendingAction(null);
                setIsChangingPassword(false);
                setCurrentPasswordConfirm('');
                setNewPasswordValue('');
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 z-10 space-y-5"
            >
              
              {/* Header */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                    <Lock className="w-5 h-5 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-[15px] tracking-tight">
                      การตรวจสอบสิทธิ์เข้าถึง
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      {pendingAction === 'switch_to_admin' 
                        ? 'กรุณากรอกรหัสผ่านเพื่อสลับไปแพลตฟอร์มผู้ใช้งาน'
                        : 'กรุณากรอกรหัสผ่านเพื่อจัดการข้อมูล Google Sheets (สิทธิ์ผู้ดูแลระบบ)'
                      }
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setIsPasswordModalOpen(false);
                    setPendingAction(null);
                    setIsChangingPassword(false);
                    setCurrentPasswordConfirm('');
                    setNewPasswordValue('');
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!isChangingPassword ? (
                /* 1. PASSWORD VERIFICATION FORM */
                <form onSubmit={handleVerifyPassword} className="space-y-4">

                  {/* ระบุรหัสผู้ใช้งาน */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      👤 ระบุรหัสผู้ใช้งาน (Enter User ID)
                    </label>
                    <input
                      type="text"
                      value={selectedUserCode}
                      onChange={e => setSelectedUserCode(e.target.value)}
                      required
                      placeholder="ระบุรหัสผู้ใช้งาน เช่น Auehen, CR-140575..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-slate-800"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      รหัสผ่านความปลอดภัย (Security Password)
                    </label>
                    <div className="relative">
                      <input 
                        type={showPasswordText ? 'text' : 'password'}
                        value={enteredPassword}
                        onChange={e => setEnteredPassword(e.target.value)}
                        required
                        placeholder="กรอกรหัสผ่านเพื่อเข้าสู่ระบบ..."
                        className={`w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-slate-700 text-center tracking-[0.15em]`}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswordText(!showPasswordText)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      >
                        {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end text-[10px] text-slate-400 font-medium px-1 gap-1">
                      <span className="text-amber-600 font-bold flex items-center gap-0.5">🔒 ต้องกรอกรหัสผ่านเพื่อความปลอดภัย</span>
                    </div>
                  </div>

                  {/* Submit and Actions */}
                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="submit"
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-sm shadow-indigo-100 border border-indigo-700 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>ยืนยันรหัสเข้าใช้งาน 🔑</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsChangingPassword(true);
                        setCurrentPasswordConfirm('');
                        setNewPasswordValue('');
                      }}
                      className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 text-center hover:underline cursor-pointer py-1 mt-1"
                    >
                      ต้องการเปลี่ยนรหัสผ่านใหม่? (Change Password)
                    </button>
                  </div>
                </form>
              ) : (
                /* 2. CHANGE PASSWORD FORM */
                <form onSubmit={handleSaveNewPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      รหัสผ่านเดิม/ปัจจุบัน (Current Password)
                    </label>
                    <input 
                      type="password"
                      value={currentPasswordConfirm}
                      onChange={e => setCurrentPasswordConfirm(e.target.value)}
                      required
                      placeholder="กรอกรหัสผ่านเดิมเพื่อยืนยัน..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-slate-700 text-center tracking-[0.25em]"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 block">
                      รหัสผ่านใหม่ที่ต้องการตั้ง (New Password)
                    </label>
                    <input 
                      type="text"
                      value={newPasswordValue}
                      onChange={e => setNewPasswordValue(e.target.value)}
                      required
                      placeholder="เช่น 123456, admin99..."
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-slate-700 text-center"
                    />
                    <p className="text-[10px] text-slate-400 font-medium px-1">
                      * รหัสผ่านใหม่จะถูกจัดเก็บลงในอุปกรณ์เครื่องนี้เพื่อการเข้าใช้งานในอนาคต
                    </p>
                  </div>

                  {/* Submit and Back */}
                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsChangingPassword(false);
                        setCurrentPasswordConfirm('');
                        setNewPasswordValue('');
                      }}
                      className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all border border-indigo-700 cursor-pointer"
                    >
                      บันทึกรหัสผ่านใหม่
                    </button>
                  </div>
                </form>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ADMIN EMAILS MANAGEMENT MODAL */}
      <AnimatePresence>
        {isAdminManagerOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            
            {/* Modal Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsAdminManagerOpen(false);
                setNewAdminEmail('');
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 z-10 space-y-5"
            >
              
              {/* Header */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-[15px] tracking-tight">
                      จัดการรายชื่อผู้ดูแลระบบ (Admin)
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      เพิ่มหรือนำอีเมลผู้ดูแลระบบออกได้โดยตรง
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setIsAdminManagerOpen(false);
                    setNewAdminEmail('');
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Add Admin Email Form */}
              <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <label className="text-[11px] font-extrabold text-slate-500 block">
                  เพิ่มอีเมลผู้ดูแลระบบคนใหม่
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newAdminEmail}
                    onChange={e => setNewAdminEmail(e.target.value)}
                    placeholder="เช่น admin.new@gmail.com"
                    className="flex-1 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-semibold text-slate-700 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const emailToAdd = newAdminEmail.trim().toLowerCase();
                      if (!emailToAdd) return;
                      
                      // basic validation
                      if (!emailToAdd.includes('@') || !emailToAdd.includes('.')) {
                        setToast({ message: '⚠️ รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', type: 'error' });
                        return;
                      }

                      if (adminEmails.map(e => e.toLowerCase()).includes(emailToAdd)) {
                        setToast({ message: '⚠️ อีเมลนี้เป็นแอดมินอยู่แล้ว', type: 'error' });
                        return;
                      }

                      setAdminEmails([...adminEmails, emailToAdd]);
                      setNewAdminEmail('');
                      setToast({ message: `🎉 เพิ่มอีเมล ${emailToAdd} เป็นผู้ดูแลระบบเรียบร้อยแล้ว`, type: 'success' });
                    }}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center cursor-pointer active:scale-95"
                  >
                    เพิ่ม ➕
                  </button>
                </div>
              </div>

              {/* Admin Emails List */}
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold text-slate-500 block px-1">
                  รายชื่อผู้ดูแลระบบในปัจจุบัน ({adminEmails.length})
                </label>
                <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                  {adminEmails.map((email, idx) => (
                    <div key={email + idx} className="flex items-center justify-between py-2 px-1 first:pt-0">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0"></div>
                        <span className="text-slate-700 font-semibold text-xs truncate max-w-[240px]" title={email}>
                          {email}
                        </span>
                      </div>
                      
                      {/* Delete Action (only if more than 1 admin remains) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (adminEmails.length <= 1) {
                            setToast({ message: '⚠️ ต้องมีแอดมินเหลืออย่างน้อย 1 คน เพื่อความปลอดภัย', type: 'error' });
                            return;
                          }
                          
                          const filtered = adminEmails.filter(e => e.toLowerCase() !== email.toLowerCase());
                          setAdminEmails(filtered);
                          setToast({ message: `🗑️ นำอีเมล ${email} ออกจากการเป็นผู้ดูแลระบบแล้ว`, type: 'info' });

                          // If the logged in user is the one being removed, sign them out of admin
                          if (currentUser?.email && currentUser.email.toLowerCase() === email.toLowerCase()) {
                            setUserRole('visitor');
                            localStorage.setItem('ecom_user_role', 'visitor');
                            setIsAdminManagerOpen(false);
                            setToast({ message: '🔒 คุณนำบัญชีตัวเองออกจากแอดมินแล้ว จึงสลับเป็นสถานะผู้เยี่ยมชม', type: 'info' });
                          }
                        }}
                        className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-all cursor-pointer"
                        title="ลบสิทธิ์แอดมินคนนี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Close Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdminManagerOpen(false);
                    setNewAdminEmail('');
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  ปิดหน้าต่าง
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* USER ACCOUNTS MANAGEMENT MODAL */}
      <AnimatePresence>
        {isEmployeeManagerOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            
            {/* Modal Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsEmployeeManagerOpen(false);
                setNewEmployeeCode('');
                setNewEmployeePassword('1234');
                setNewEmployeeRole('user');
                setConfirmDeleteUserCode(null);
              }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 z-10 space-y-5"
            >
              
              {/* Header */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                    <UserPlus className="w-5 h-5 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-[15px] tracking-tight">
                      จัดการบัญชีผู้ใช้งานระบบ (User Accounts)
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      เพิ่ม/ลบผู้ใช้งาน และระบุรหัสผ่านรายบุคคลเพื่อความปลอดภัย
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setIsEmployeeManagerOpen(false);
                    setNewEmployeeCode('');
                    setNewEmployeePassword('1234');
                    setNewEmployeeRole('user');
                    setConfirmDeleteUserCode(null);
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Add User Form */}
              <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <label className="text-[11px] font-extrabold text-slate-500 block">
                  เพิ่มบัญชีผู้ใช้งานใหม่ (Add User)
                </label>
                
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newEmployeeCode}
                    onChange={e => setNewEmployeeCode(e.target.value)}
                    placeholder="รหัสผู้ใช้งาน / Username เช่น Auehen, CR-140575"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-semibold text-slate-700 text-sm"
                  />
                  
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newEmployeePassword}
                      onChange={e => setNewEmployeePassword(e.target.value)}
                      placeholder="กำหนดรหัสผ่าน (Password)"
                      className="flex-1 px-3.5 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-semibold text-slate-700 text-sm"
                    />
                    
                    <select
                      value={newEmployeeRole}
                      onChange={e => setNewEmployeeRole(e.target.value as 'user' | 'admin')}
                      className="px-3 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-500 transition-all font-semibold text-slate-700 text-xs"
                    >
                      <option value="user">สิทธิ์ทั่วไป (User)</option>
                      <option value="admin">ผู้ดูแลระบบ (Admin)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const username = newEmployeeCode.trim();
                      const password = newEmployeePassword.trim();
                      if (!username || !password) {
                        setToast({ message: '⚠️ กรุณาระบุชื่อผู้ใช้งานและรหัสผ่าน', type: 'error' });
                        return;
                      }

                      if (userAccounts.some(acc => acc.userCode.toLowerCase() === username.toLowerCase())) {
                        setToast({ message: '⚠️ ชื่อผู้ใช้งานนี้มีอยู่ในระบบแล้ว', type: 'error' });
                        return;
                      }

                      const updatedAccounts = [
                        ...userAccounts,
                        { userCode: username, password, role: newEmployeeRole }
                      ];
                      setUserAccounts(updatedAccounts);
                      setNewEmployeeCode('');
                      setNewEmployeePassword('1234');
                      setNewEmployeeRole('user');
                      setToast({ message: `🎉 เพิ่มผู้ใช้งาน ${username} สำเร็จแล้ว`, type: 'success' });
                    }}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                  >
                    เพิ่มบัญชีผู้ใช้ใหม่ ➕
                  </button>
                </div>
              </div>

              {/* User Accounts List */}
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold text-slate-500 block px-1">
                  รายชื่อผู้ใช้งานทั้งหมด ({userAccounts.length})
                </label>
                {userAccounts.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 text-xs font-semibold">
                    ยังไม่มีการเพิ่มบัญชีผู้ใช้งานใดๆ ในระบบ
                  </div>
                ) : (
                  <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-100">
                    {userAccounts.map((acc, idx) => (
                      <div key={acc.userCode + idx} className="flex items-center justify-between py-2 px-1 first:pt-0">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                            <span className="text-slate-800 font-extrabold text-xs">
                              {acc.userCode}
                            </span>
                            <span className={`px-1.5 py-0.5 text-[9px] font-extrabold rounded-md ${
                              acc.role === 'admin' ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-slate-50 text-slate-500 border border-slate-100'
                            }`}>
                              {acc.role === 'admin' ? 'Admin' : 'User'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono pl-4">
                            รหัสผ่าน: <span className="text-indigo-600 font-bold">{acc.password}</span>
                          </span>
                        </div>
                        
                        {/* Delete Action with Confirmation */}
                        {confirmDeleteUserCode === acc.userCode ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const filtered = userAccounts.filter(c => c.userCode !== acc.userCode);
                                setUserAccounts(filtered);
                                setToast({ message: `🗑️ ลบบัญชีผู้ใช้ ${acc.userCode} เรียบร้อยแล้ว`, type: 'info' });
                                setConfirmDeleteUserCode(null);
                              }}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg transition-all cursor-pointer active:scale-95 flex items-center gap-0.5"
                            >
                              ยืนยันลบ ⚠️
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUserCode(null)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 font-extrabold text-[10px] rounded-lg transition-all cursor-pointer active:scale-95"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (acc.userCode === loggedInUserCode) {
                                setToast({ message: '⚠️ คุณไม่สามารถลบบัญชีผู้ใช้งานที่ตนเองกำลังล็อกอินอยู่ได้', type: 'error' });
                                return;
                              }
                              setConfirmDeleteUserCode(acc.userCode);
                            }}
                            className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-all cursor-pointer"
                            title="ลบบัญชีผู้ใช้งานนี้"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEmployeeManagerOpen(false);
                    setNewEmployeeCode('');
                    setNewEmployeePassword('1234');
                    setNewEmployeeRole('user');
                    setConfirmDeleteUserCode(null);
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  ปิดหน้าต่าง
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GOOGLE SHEETS SYNC & PREVIEW MODAL */}
      <AnimatePresence>
        {isSyncSuccessModalOpen && syncSuccessModalTx && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Modal Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSyncSuccessModalOpen(false)}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs"
            />

            {/* Modal Card */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 z-10 space-y-5"
            >
              
              {/* Header */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-3">
                  {syncStatus === 'syncing' ? (
                    <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center animate-spin">
                      <RefreshCw className="w-5 h-5 stroke-[2.5px]" />
                    </div>
                  ) : syncStatus === 'success' ? (
                    <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 stroke-[2.5px]" />
                    </div>
                  ) : syncStatus === 'offline_success' ? (
                    <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                      <Database className="w-5 h-5 stroke-[2.5px]" />
                    </div>
                  ) : (
                    <div className="w-11 h-11 rounded-2xl bg-red-50 border border-red-100 text-red-600 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 stroke-[2.5px]" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-[16px] tracking-tight">
                      {syncStatus === 'syncing' && (syncSuccessAction === 'delete' ? '⏳ กำลังซิงค์การลบข้อมูล...' : '⏳ กำลังซิงค์และบันทึกข้อมูล...')}
                      {syncStatus === 'success' && (syncSuccessAction === 'delete' ? '🎉 ลบรายการและอัปเดต Google Sheets สำเร็จ!' : '🎉 บันทึกการแก้ไขและอัปเดต Google Sheets สำเร็จ!')}
                      {syncStatus === 'offline_success' && (syncSuccessAction === 'delete' ? '💾 ลบรายการในเครื่อง (Local) สำเร็จ!' : '💾 บันทึกการแก้ไขในเครื่อง (Local) สำเร็จ!')}
                      {syncStatus === 'failed' && '⚠️ บันทึกข้อมูลแล้ว แต่การซิงค์ Google Sheets ขัดข้อง'}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-medium">
                      {syncStatus === 'syncing' && (syncSuccessAction === 'delete' ? 'ระบบกำลังอัปเดตสเปรดชีตเพื่อนำรายการนี้ออกอย่างถาวร' : 'ระบบกำลังนำส่งชุดข้อมูลใหม่ไปยังบัญชี Google Sheets ของคุณแบบเรียลไทม์')}
                      {syncStatus === 'success' && (syncSuccessAction === 'delete' ? 'สเปรดชีตได้รับการลบรายการและจัดเรียงข้อมูลใหม่เสร็จสิ้น' : 'อัปเดตฐานข้อมูลและส่งค่าแถวใหม่เข้าสู่แผ่นงานสเปรดชีตเรียบร้อยแล้ว')}
                      {syncStatus === 'offline_success' && (syncSuccessAction === 'delete' ? 'ลบรายการออกจากหน่วยความจำโลคัลแล้ว (จะถูกเอาออกจากสเปรดชีตเมื่อกดซิงค์)' : 'บันทึกในระบบเรียบร้อย (รออัปเดตลง Google Sheets เมื่อเชื่อมต่อสถานะผู้ดูแลระบบ)')}
                      {syncStatus === 'failed' && 'ข้อมูลถูกบันทึกในเบราว์เซอร์แล้ว กรุณาตรวจสอบสิทธิ์บัญชีผู้ดูแลระบบของคุณ'}
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsSyncSuccessModalOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-2xl border text-xs font-semibold flex items-center justify-between ${
                syncStatus === 'syncing' ? 'bg-amber-50/50 border-amber-100 text-amber-800' :
                syncStatus === 'success' ? 'bg-emerald-50/50 border-emerald-100 text-emerald-800' :
                syncStatus === 'offline_success' ? 'bg-indigo-50/50 border-indigo-100 text-indigo-800' :
                'bg-red-50/50 border-red-100 text-red-800'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      syncStatus === 'syncing' ? 'bg-amber-400' :
                      syncStatus === 'success' ? 'bg-emerald-400' :
                      syncStatus === 'offline_success' ? 'bg-indigo-400' :
                      'bg-red-400'
                    }`}></span>
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      syncStatus === 'syncing' ? 'bg-amber-500' :
                      syncStatus === 'success' ? 'bg-emerald-500' :
                      syncStatus === 'offline_success' ? 'bg-indigo-500' :
                      'bg-red-500'
                    }`}></span>
                  </span>
                  <span>
                    สถานะการซิงค์: {
                      syncStatus === 'syncing' ? 'กำลังส่งข้อมูล...' :
                      syncStatus === 'success' ? 'เชื่อมต่อเสร็จสมบูรณ์ (Synced)' :
                      syncStatus === 'offline_success' ? 'บันทึกโลคัลแล้ว (Awaiting Sync)' :
                      'เกิดข้อผิดพลาดในการเชื่อมโยงภายนอก'
                    }
                  </span>
                </div>
                {spreadsheetId && (
                  <span className="text-[10px] font-mono opacity-75">
                    ID สเปรดชีต: {spreadsheetId.substring(0, 12)}...
                  </span>
                )}
              </div>

              {/* Google Sheets Column Preview Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-extrabold text-slate-500 block uppercase tracking-wide">
                      📊 หน้าต่างพรีวิวแถวข้อมูล (Google Sheets Column Row Grid)
                    </label>
                    {syncSuccessAction === 'delete' && (
                      <span className="text-[10px] bg-rose-50 text-rose-600 px-2.5 py-0.5 rounded-full font-extrabold border border-rose-100 animate-pulse">
                        🗑️ รายการที่ถูกลบออก (Removed Row)
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">
                    รูปแบบ AppSheet Schema
                  </span>
                </div>

                <div className="w-full overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                  <table className="w-full text-[12px] font-medium text-slate-600 border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider bg-indigo-50/30">Date</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider">Platform</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider">Type</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider bg-slate-50/50">Amount</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-400 font-bold text-center uppercase tracking-wider">Order Number</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider">Notes</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider bg-emerald-50/20">Quantity</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider bg-indigo-50/20">Items</th>
                        <th className="px-3 py-2 border-r border-slate-200 text-slate-500 font-extrabold text-center uppercase tracking-wider">Timestamp</th>
                        <th className="px-3 py-2 text-slate-500 font-extrabold text-center uppercase tracking-wider">Staff Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={`bg-white hover:bg-slate-50/50 transition-colors ${syncSuccessAction === 'delete' ? 'bg-rose-50/40 line-through text-rose-950/70' : ''}`}>
                        <td className={`px-3 py-2.5 border-r border-slate-200 font-bold text-center bg-indigo-50/10 ${syncSuccessAction === 'delete' ? 'text-rose-900/60' : 'text-slate-800'}`}>{syncSuccessModalTx.date}</td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center font-bold">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase ${
                            syncSuccessModalTx.platform === 'shopee' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-blue-50 text-blue-600 border border-blue-100'
                          }`}>
                            {syncSuccessModalTx.platform}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center font-bold">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase ${
                            syncSuccessModalTx.type === 'sale' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {syncSuccessModalTx.type}
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 border-r border-slate-200 text-right font-extrabold bg-slate-50/20 ${syncSuccessAction === 'delete' ? 'text-rose-900/60' : 'text-slate-900'}`}>
                          ฿{syncSuccessModalTx.amount.toLocaleString('th-TH')}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center text-slate-400 italic font-normal">
                          (ปล่อยว่างไว้)
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-left truncate max-w-[150px] font-semibold text-slate-600" title={syncSuccessModalTx.note}>
                          {syncSuccessModalTx.note || '-'}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center font-extrabold text-slate-700 bg-emerald-50/10">
                          {syncSuccessModalTx.orders}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center font-extrabold text-slate-700 bg-indigo-50/10">
                          {syncSuccessModalTx.items !== undefined && !isNaN(syncSuccessModalTx.items) ? syncSuccessModalTx.items : 0}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200 text-center text-slate-700 text-[11px] font-mono">
                          {syncSuccessModalTx.timestamp || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-800 font-mono">
                          {syncSuccessModalTx.staffCode || '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tips Section */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1.5 text-xs text-slate-500 font-medium">
                <span className="font-extrabold text-slate-700 block">💡 ข้อมูลสำคัญเกี่ยวกับชีตของคุณ:</span>
                <p>• ลำดับคอลัมน์และหัวตาราง (Schema) ได้ถูกจัดเรียงตามสเปกสเปรดชีตของระบบหลัก เพื่อเชื่อมต่อไปยังระบบ AppSheet ได้อย่างสมบูรณ์แบบโดยไม่ต้องตั้งค่าใหม่</p>
                <p>• เมื่อทำการอัปเดตข้อมูลแล้ว หน้าแดชบอร์ดสรุปและรายงาน PDF จะอ้างอิงชุดข้อมูลที่ถูกต้องล่าสุดนี้ทันที</p>
              </div>

              {/* Actions Footer */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
                {syncStatus === 'offline_success' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setIsSyncSuccessModalOpen(false);
                      handleToggleSheets();
                    }}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Cloud className="w-4 h-4 text-indigo-200" />
                    <span>เชื่อมต่อ Google Sheets เพื่อส่งข้อมูลขึ้นชีตทันที ⚡</span>
                  </button>
                ) : spreadsheetId && (
                  <button
                    type="button"
                    onClick={() => {
                      window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
                    }}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4 text-emerald-200" />
                    <span>เปิดดูและตรวจสอบชีตใน Google Sheets ↗</span>
                  </button>
                )}
                
                <button
                  type="button"
                  onClick={() => setIsSyncSuccessModalOpen(false)}
                  className="sm:w-32 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  ตกลง (เสร็จสิ้น)
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* HIDDEN PRECISE A4 PDF REPORT TEMPLATE FOR PRINT/EXPORT */}
      <div 
        id="pdf-report-template" 
        style={{ 
          display: 'none', 
          position: 'absolute', 
          left: '-9999px', 
          top: '-9999px', 
          width: '800px', 
          padding: '40px', 
          backgroundColor: '#ffffff', 
          color: '#1e293b', 
          fontFamily: 'system-ui, -apple-system, sans-serif' 
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px', marginBottom: '25px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <img 
              src={tsdcLogo} 
              alt="TSDC Logo" 
              style={{ width: '55px', height: '55px', borderRadius: '10px', objectFit: 'cover', border: '1px solid #e2e8f0' }}
              referrerPolicy="no-referrer"
            />
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px 0' }}>รายงานวิเคราะห์ยอดขายประจำช่องทาง Tsuruha</h1>
              <p style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', margin: '0' }}>ระบบวิเคราะห์และสรุปผลข้อมูล E-Commerce (Shopee & Lazada) | Tsuruha</p>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#475569' }}>พิมพ์ ณ วันที่: {new Date().toLocaleDateString('th-TH')} {new Date().toLocaleTimeString('th-TH').slice(0, 5)} น.</div>
            <div style={{ fontSize: '10px', fontWeight: '600', color: '#94a3b8', marginTop: '2px' }}>ช่วงเวลาข้อมูล: {getReportDateRangeString()}</div>
          </div>
        </div>

        {/* Executive Summary (KPIs) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '25px' }}>
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>ยอดขายรวมสุทธิ (Net Revenue)</span>
            <span style={{ fontSize: '22px', fontWeight: '800', color: '#10b981' }}>฿{stats.netRevenue.toLocaleString('th-TH')}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>ก่อนหัก Void: ฿{stats.grossRevenue.toLocaleString('th-TH')} (Void: ฿{stats.voidAmount.toLocaleString('th-TH')})</span>
          </div>
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>จำนวนคำสั่งซื้อสะสม (Total Orders)</span>
            <span style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb' }}>{stats.totalOrders.toLocaleString('th-TH')} ออเดอร์</span>
            <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>Shopee: {stats.shopeeOrders} | Lazada: {stats.lazadaOrders}</span>
          </div>
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>อัตราการยกเลิกออเดอร์ (Void Rate)</span>
            <span style={{ fontSize: '22px', fontWeight: '800', color: '#ef4444' }}>{stats.grossRevenue > 0 ? ((stats.voidAmount / stats.grossRevenue) * 100).toFixed(1) : '0.0'}%</span>
            <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginTop: '4px' }}>มูลค่าเงิน Void รวม: ฿{stats.voidAmount.toLocaleString('th-TH')}</span>
          </div>
        </div>

        {/* Channel Comparison Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '25px' }}>
          {/* Shopee Summary Card */}
          <div style={{ border: '1.5px solid #fdd8d5', padding: '18px', borderRadius: '14px', backgroundColor: '#fffaf9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '800', color: shopeeColor, margin: 0 }}>ประสิทธิภาพยอดขาย Shopee</h4>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569', backgroundColor: '#fee2e2', padding: '2px 8px', borderRadius: '20px' }}>ส่วนแบ่ง: {stats.shopee.revenueShare}%</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#8898a5', display: 'block', marginBottom: '2px' }}>ยอดขายดิบ (Gross)</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#475569' }}>฿{stats.shopee.grossSales.toLocaleString('th-TH')}</span>
              </div>
              <div>
                <span style={{ fontSize: '10px', color: '#8898a5', display: 'block', marginBottom: '2px' }}>ยอดคืน Void</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#ef4444' }}>฿{stats.shopee.voidAmount.toLocaleString('th-TH')}</span>
              </div>
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid #fee2e2', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '10px', color: '#8898a5', display: 'block' }}>ยอดขายจริงสุทธิ (Net)</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: shopeeColor }}>฿{stats.shopee.netSales.toLocaleString('th-TH')}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '10px', color: '#8898a5', display: 'block' }}>จำนวนออเดอร์</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#475569' }}>{stats.shopee.orders} ออเดอร์</span>
                </div>
              </div>
            </div>
          </div>

          {/* Lazada Summary Card */}
          <div style={{ border: '1.5px solid #dbeafe', padding: '18px', borderRadius: '14px', backgroundColor: '#f0f7ff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '800', color: lazadaColor, margin: 0 }}>ประสิทธิภาพยอดขาย Lazada</h4>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#475569', backgroundColor: '#dbeafe', padding: '2px 8px', borderRadius: '20px' }}>ส่วนแบ่ง: {stats.lazada.revenueShare}%</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#8898a5', display: 'block', marginBottom: '2px' }}>ยอดขายดิบ (Gross)</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#475569' }}>฿{stats.lazada.grossSales.toLocaleString('th-TH')}</span>
              </div>
              <div>
                <span style={{ fontSize: '10px', color: '#8898a5', display: 'block', marginBottom: '2px' }}>ยอดคืน Void</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: '#ef4444' }}>฿{stats.lazada.voidAmount.toLocaleString('th-TH')}</span>
              </div>
              <div style={{ gridColumn: 'span 2', borderTop: '1px solid #dbeafe', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '10px', color: '#8898a5', display: 'block' }}>ยอดขายจริงสุทธิ (Net)</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: lazadaColor }}>฿{stats.lazada.netSales.toLocaleString('th-TH')}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '10px', color: '#8898a5', display: 'block' }}>จำนวนออเดอร์</span>
                  <span style={{ fontSize: '16px', fontWeight: '800', color: '#475569' }}>{stats.lazada.orders} ออเดอร์</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Comparison Chart */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '22px', marginBottom: '25px', backgroundColor: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a', margin: 0 }}>กราฟเปรียบเทียบสถิติและแนวโน้มยอดขายสุทธิ</h3>
              <p style={{ fontSize: '10px', fontWeight: '600', color: '#94a3b8', margin: '2px 0 0 0' }}>สถิติยอดขายรายวันสะสมของทั้งสองช่องทาง (ข้อมูลล่าสุด 7 วันที่มีธุรกรรม)</p>
            </div>
            <div style={{ display: 'flex', gap: '15px', fontSize: '9px', fontWeight: 'bold' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: shopeeColor }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: shopeeColor, display: 'inline-block' }}></span>
                Shopee Net
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: lazadaColor }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: lazadaColor, display: 'inline-block' }}></span>
                Lazada Net
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10B981' }}>
                <span style={{ width: '12px', height: '2px', borderBottom: '2px dashed #10B981', display: 'inline-block' }}></span>
                ยอดสุทธิรวมกัน
              </span>
            </div>
          </div>

          {chartPoints.length === 0 ? (
            <div style={{ height: '140px', border: '1px dashed #cbd5e1', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '11px' }}>
              ไม่มีข้อมูลธุรกรรมที่จะวาดเป็นกราฟ
            </div>
          ) : (
            <div style={{ backgroundColor: '#fafafa', padding: '12px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
              <svg viewBox="0 0 500 220" style={{ width: '100%', height: '160px', overflow: 'visible' }}>
                <line x1="50" y1="50" x2="480" y2="50" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="50" y1="115" x2="480" y2="115" stroke="#f1f5f9" strokeWidth="1" />
                <line x1="50" y1="180" x2="480" y2="180" stroke="#cbd5e1" strokeWidth="1" />

                {chartPoints.map((p, i) => (
                  <text key={i} x={p.x} y="202" textAnchor="middle" style={{ fontSize: '9px', fill: '#64748b', fontWeight: 'bold' }}>
                    {p.date.substring(5, 10).replace('-', '/')}
                  </text>
                ))}

                {/* Paths */}
                <path
                  d={`M ${chartPoints.map(p => `${p.x} ${p.yShopee}`).join(' L ')}`}
                  fill="none"
                  stroke={shopeeColor}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  d={`M ${chartPoints.map(p => `${p.x} ${p.yLazada}`).join(' L ')}`}
                  fill="none"
                  stroke={lazadaColor}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  d={`M ${chartPoints.map(p => `${p.x} ${p.yTotal}`).join(' L ')}`}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  strokeDasharray="4 4"
                />

                {/* Circles */}
                {chartPoints.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.yShopee} r="4.5" fill={shopeeColor} stroke="#fff" strokeWidth="1.5" />
                    <circle cx={p.x} cy={p.yLazada} r="4.5" fill={lazadaColor} stroke="#fff" strokeWidth="1.5" />
                  </g>
                ))}
              </svg>
            </div>
          )}
        </div>

        {/* Detailed Daily Breakdown Table (Recent 10 records) */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ backgroundColor: '#f8fafc', padding: '12px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', margin: 0 }}>ตารางสรุปข้อมูลรายวันย้อนหลัง (10 วันล่าสุดที่มีข้อมูลในช่วงเวลา)</h3>
            <span style={{ fontSize: '10px', fontWeight: '700', color: '#64748b' }}>มีข้อมูลทั้งหมด {dailyReport.length} วัน</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                <th style={{ padding: '10px 18px', fontWeight: '700', color: '#64748b' }}>วันที่ (Date)</th>
                <th style={{ padding: '10px 18px', fontWeight: '700', color: '#64748b', textAlign: 'center' }}>Shopee Net Sales</th>
                <th style={{ padding: '10px 18px', fontWeight: '700', color: '#64748b', textAlign: 'center' }}>Lazada Net Sales</th>
                <th style={{ padding: '10px 18px', fontWeight: '700', color: '#64748b', textAlign: 'right' }}>ยอดสุทธิรวมกัน (Total Net)</th>
              </tr>
            </thead>
            <tbody>
              {dailyReport.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontWeight: 'bold' }}>
                    ไม่มีข้อมูลธุรกรรมในช่วงเวลาที่เลือก
                  </td>
                </tr>
              ) : (
                dailyReport.slice(0, 10).map((row, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 18px', fontWeight: '700', color: '#1e293b' }}>{formatThaiDate(row.date)}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'center', color: shopeeColor, fontWeight: '700' }}>฿{row.shopeeNet.toLocaleString('th-TH')}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'center', color: lazadaColor, fontWeight: '700' }}>฿{row.lazadaNet.toLocaleString('th-TH')}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'right', color: '#10b981', fontWeight: '800' }}>฿{row.totalNet.toLocaleString('th-TH')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info inside PDF */}
        <div style={{ marginTop: '30px', borderTop: '1px solid #e2e8f0', paddingTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#94a3b8', fontWeight: '600' }}>
          <span>* รายงานเล่มนี้สร้างและรับรองข้อมูลอย่างเป็นทางการโดยระบบ E-Commerce Dashboard</span>
          <span>หน้า 1 จาก 1</span>
        </div>
      </div>

    </div>
  );
}
