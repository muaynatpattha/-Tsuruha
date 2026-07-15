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
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`, {
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
  const timestampStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

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
    tx.items || 0,          // Items (จำนวนชิ้น)
    timestampStr,           // Timestamp
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

    // Header validation
    const headers = rows[0].map((h: string) => h.trim().toLowerCase());
    const dateIdx = headers.indexOf('date');
    const platformIdx = headers.indexOf('platform');
    const typeIdx = headers.indexOf('type');
    const amountIdx = headers.indexOf('amount');
    const notesIdx = headers.indexOf('notes');
    const qtyIdx = headers.indexOf('quantity');
    const staffIdx = headers.indexOf('staff code');
    const itemsIdx = headers.indexOf('items');

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
      const rawQty = qtyIdx !== -1 ? (parseInt(row[qtyIdx], 10) || 1) : 1;
      const rawStaff = staffIdx !== -1 ? (row[staffIdx] || '') : '';
      const rawItems = itemsIdx !== -1 ? (parseInt(row[itemsIdx], 10) || rawQty) : rawQty;

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
        staffCode: rawStaff.trim()
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

