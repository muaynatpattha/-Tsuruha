import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { Transaction } from '../types';
import { getLocalTimestamp } from '../utils';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure Google OAuth Provider with Sheets & Drive Scopes
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = (() => {
  try {
    return localStorage.getItem('ecom_google_access_token');
  } catch (e) {
    return null;
  }
})();

// Initialize Auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // If logged in but no token cached (e.g. page reload), we can request signIn again or prompt
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      try {
        localStorage.removeItem('ecom_google_access_token');
      } catch (e) {}
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Provider');
    }
    cachedAccessToken = credential.accessToken;
    try {
      localStorage.setItem('ecom_google_access_token', cachedAccessToken);
    } catch (e) {}
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Logout
export const logoutUser = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  try {
    localStorage.removeItem('ecom_google_access_token');
  } catch (e) {}
};

// Get current cached access token
export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

/**
 * GOOGLE SHEETS & DRIVE API INTEGRATION HELPERS
 */

// 1. Search for existing spreadsheet in Drive
export async function findSpreadsheet(token: string, title: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`name = '${title}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('UNAUTHENTICATED_401');
      }
      throw new Error('Error searching file in Drive');
    }
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    return null;
  } catch (e: any) {
    const isNetworkOrFetchError = e.message?.includes('Failed to fetch') || e.message?.includes('network') || e.name === 'TypeError';
    if (e.message !== 'UNAUTHENTICATED_401' && !isNetworkOrFetchError) {
      console.error('findSpreadsheet error:', e);
    } else if (isNetworkOrFetchError) {
      console.warn('findSpreadsheet network fetch failed (offline or sandbox):', e.message);
    }
    if (e.message === 'UNAUTHENTICATED_401') {
      throw e;
    }
    return null;
  }
}

// 2. Create a new Spreadsheet
export async function createSpreadsheet(token: string, title: string): Promise<string> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        title: title
      }
    })
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('UNAUTHENTICATED_401');
    }
    const errText = await res.text();
    throw new Error(`Failed to create Spreadsheet: ${errText}`);
  }
  const data = await res.json();
  return data.spreadsheetId;
}

// 3. Ensure sheet tab exists (No-op as we write directly to the primary sheet dynamically)
export async function prepareSpreadsheetTabs(token: string, spreadsheetId: string): Promise<void> {
  // Primary sheet is dynamically fetched and updated on write now to keep it clean and simple!
}

// 4. Update data on primary Google Sheets tab matching the exact schema required for AppSheet
export async function syncDataToGoogleSheets(
  token: string,
  spreadsheetId: string,
  transactions: Transaction[]
): Promise<void> {
  // Let's fetch the first sheet's title dynamically to write directly to it (e.g. Sheet1, ชีต1)
  let sheetTitle = 'Sheet1';
  let sheetId = 0;
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title,sheetId))`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('UNAUTHENTICATED_401');
      }
    } else {
      const data = await res.json();
      const sheets = data.sheets || [];
      if (sheets.length > 0) {
        sheetTitle = sheets[0].properties.title;
        sheetId = sheets[0].properties.sheetId || 0;
      }
    }
  } catch (e: any) {
    const isNetworkOrFetchError = e.message?.includes('Failed to fetch') || e.message?.includes('network') || e.name === 'TypeError';
    if (e.message !== 'UNAUTHENTICATED_401' && !isNetworkOrFetchError) {
      console.error('Failed to fetch sheet title:', e);
    } else if (isNetworkOrFetchError) {
      console.warn('Failed to fetch sheet title network fetch failed (offline or sandbox):', e.message);
    }
    if (e.message === 'UNAUTHENTICATED_401') {
      throw e;
    }
  }

  // Column Headers matching the user's screenshot:
  // Date, Platform, Type, Amount, Order Number, Notes, Quantity, Items, Timestamp, Staff Code
  const txHeaders = ['Date', 'Platform', 'Type', 'Amount', 'Order Number', 'Notes', 'Quantity', 'Items', 'Timestamp', 'Staff Code'];

  // Sort transactions by date ascending for Google Sheets sync
  const sortedTransactions = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  const txRows = sortedTransactions.map(tx => [
    tx.date,
    tx.platform === 'shopee' ? 'Shopee' : 'Lazada',
    tx.type === 'sale' ? 'Sale' : 'Void',
    tx.amount,
    '',                     // Order Number (Left blank)
    tx.note || '',          // Notes
    tx.orders,              // Quantity
    tx.items !== undefined && !isNaN(tx.items) ? tx.items : 0, // Items (จำนวนชิ้น)
    tx.timestamp || `${tx.date} 09:00:00`, // Individual timestamp
    tx.staffCode || ''      // Staff Code
  ]);
  const txData = [txHeaders, ...txRows];

  // Clear existing values in the sheet to avoid leftover rows
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:Z10000:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!clearRes.ok && clearRes.status === 401) {
    throw new Error('UNAUTHENTICATED_401');
  }

  // Write new data
  const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `${sheetTitle}!A1`,
          values: txData
        }
      ]
    })
  });

  if (!writeRes.ok) {
    if (writeRes.status === 401) {
      throw new Error('UNAUTHENTICATED_401');
    }
    const errTxt = await writeRes.text();
    throw new Error(`Failed to write values into Google Sheets: ${errTxt}`);
  }

  // Explicitly format Column G (Quantity) and Column H (Items) as standard integer numbers to clear date formatting in Google Sheets
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startColumnIndex: 6, // Column G (Quantity) is index 6
                endColumnIndex: 8,   // Column H (Items) is index 7 (exclusive up to index 8)
                startRowIndex: 1     // Skip header row
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: {
                    type: 'NUMBER',
                    pattern: '0'
                  }
                }
              },
              fields: 'userEnteredFormat.numberFormat'
            }
          }
        ]
      })
    });
  } catch (formatErr) {
    console.warn('Failed to format spreadsheet columns G and H:', formatErr);
  }
}

// Helper to robustly parse numeric cell values, converting Excel/Google Sheets serial date format strings back to numbers if needed
function parseNumericCell(val: string | undefined | null, defaultFallback: number = NaN): number {
  if (val === undefined || val === null) return defaultFallback;
  const str = val.trim();
  if (str === '') return defaultFallback;

  // If it's a pure number, return it
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  // If it has decimal point or other clean numeric formats
  const parsedFloat = parseFloat(str);
  if (!isNaN(parsedFloat) && /^\d+(\.\d+)?$/.test(str)) {
    return Math.round(parsedFloat);
  }

  // If it's a date string (contains "-" or "/")
  if (str.includes('-') || str.includes('/')) {
    // Try parsing as a Date
    const timestamp = Date.parse(str);
    if (!isNaN(timestamp)) {
      const d = new Date(timestamp);
      const year = d.getFullYear();
      const month = d.getMonth();
      const date = d.getDate();

      // Excel/Sheets serial date number calculation
      // Epoch is 1899-12-30. Use UTC calculations to prevent timezone distortion
      const utcDate = Date.UTC(year, month, date);
      const utcEpoch = Date.UTC(1899, 11, 30);
      const diffDays = Math.round((utcDate - utcEpoch) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 0 && diffDays < 100000) {
        return diffDays;
      }
    }
  }

  return isNaN(parsedFloat) ? defaultFallback : Math.round(parsedFloat);
}

// 5. Read data from Google Sheets to sync back to local storage in real-time
export async function readDataFromGoogleSheets(
  token: string,
  spreadsheetId: string
): Promise<Transaction[] | null> {
  try {
    let sheetTitle = 'Sheet1';
    const metadataRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metadataRes.ok) {
      if (metadataRes.status === 401) {
        throw new Error('UNAUTHENTICATED_401');
      }
      return null;
    }
    const metadataData = await metadataRes.json();
    const sheets = metadataData.sheets || [];
    if (sheets.length > 0) {
      sheetTitle = sheets[0].properties.title;
    }

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:J10000`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('UNAUTHENTICATED_401');
      }
      return null;
    }

    const data = await res.json();
    const rows = data.values || [];
    if (rows.length <= 1) {
      return [];
    }

    // Header validation with extremely robust dual-language (Thai & English) partial-matching
    const headers = rows[0].map((h: string) => h.trim().toLowerCase());
    
    const findHeaderIndex = (searchTerms: string[]): number => {
      // 1. Try exact or full match
      let idx = headers.findIndex(h => searchTerms.some(term => h === term));
      if (idx !== -1) return idx;
      
      // 2. Try partial match (substring contains or is contained in)
      idx = headers.findIndex(h => {
        return searchTerms.some(term => h.includes(term) || term.includes(h));
      });
      return idx;
    };

    const dateIdx = findHeaderIndex(['date', 'วันที่', 'วัน']);
    const platformIdx = findHeaderIndex(['platform', 'แพลตฟอร์ม', 'ช่องทาง', 'ระบบ']);
    const typeIdx = findHeaderIndex(['type', 'ประเภท', 'รายการ']);
    const amountIdx = findHeaderIndex(['amount', 'จำนวนเงิน', 'ยอดเงิน', 'ยอดขาย', 'เงิน']);
    const notesIdx = findHeaderIndex(['notes', 'note', 'หมายเหตุ', 'สาเหตุ']);
    const qtyIdx = findHeaderIndex(['quantity', 'qty', 'จำนวนออเดอร์', 'ออเดอร์']);
    const staffIdx = findHeaderIndex(['staff code', 'staff', 'employee', 'รหัสพนักงาน', 'พนักงาน']);
    const itemsIdx = findHeaderIndex(['items', 'item', 'จำนวนชิ้น', 'ชิ้น']);
    const timestampIdx = findHeaderIndex(['timestamp', 'เวลา', 'ประทับเวลา']);

    if (dateIdx === -1 || platformIdx === -1 || typeIdx === -1 || amountIdx === -1) {
      console.warn('Headers mismatch in sheet reading:', headers);
      return null;
    }

    const fetchedTransactions: Transaction[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const rawDate = row[dateIdx];
      if (!rawDate) continue;

      const rawPlatform = (row[platformIdx] || '').toLowerCase();
      const rawType = (row[typeIdx] || '').toLowerCase();
      const rawAmount = parseFloat(row[amountIdx]) || 0;
      const rawNotes = notesIdx !== -1 ? (row[notesIdx] || '') : '';
      const rawQtyVal = qtyIdx !== -1 ? parseNumericCell(row[qtyIdx]) : NaN;
      const rawQty = isNaN(rawQtyVal) ? (rawType.includes('void') ? 0 : 1) : rawQtyVal;
      const rawStaff = staffIdx !== -1 ? (row[staffIdx] || '') : '';
      const rawItemsVal = itemsIdx !== -1 ? parseNumericCell(row[itemsIdx]) : NaN;
      const rawItems = isNaN(rawItemsVal) ? (rawType.includes('void') ? 0 : 1) : rawItemsVal;
      const rawTimestamp = timestampIdx !== -1 ? (row[timestampIdx] || '') : '';

      const platform: 'shopee' | 'lazada' = rawPlatform.includes('lazada') ? 'lazada' : 'shopee';
      const type: 'sale' | 'void' = rawType.includes('void') ? 'void' : 'sale';

      fetchedTransactions.push({
        id: `TX-GS-${i}-${rawDate.replace(/-/g, '')}`,
        date: rawDate.trim(),
        platform,
        type,
        amount: rawAmount,
        orders: rawQty,
        items: rawItems,
        note: rawNotes.trim(),
        staffCode: rawStaff.trim(),
        timestamp: rawTimestamp || `${rawDate.trim()} 09:00:00`
      });
    }

    return fetchedTransactions;
  } catch (e: any) {
    const isNetworkOrFetchError = e.message?.includes('Failed to fetch') || e.message?.includes('network') || e.name === 'TypeError';
    if (e.message !== 'UNAUTHENTICATED_401' && !isNetworkOrFetchError) {
      console.error('readDataFromGoogleSheets error:', e);
    } else if (isNetworkOrFetchError) {
      console.warn('readDataFromGoogleSheets network fetch failed (offline or sandbox):', e.message);
    }
    if (e.message === 'UNAUTHENTICATED_401') {
      throw e;
    }
    return null;
  }
}

