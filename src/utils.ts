import { Transaction, DashboardStats } from './types';

// Helper to generate local Thai timezone timestamp (Asia/Bangkok) in YYYY-MM-DD HH:mm:ss format
export function getLocalTimestamp(): string {
  try {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
  } catch (e) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}

// Helper to convert English date (YYYY-MM-DD) to Thai Buddhist Era date format (D ม.ค. 25XX)
export function formatThaiDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  
  const yearAD = parseInt(parts[0], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const yearBE = yearAD + 543;
  const thaiMonthsShort = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  
  return `${day} ${thaiMonthsShort[monthIdx] || ''} ${yearBE}`;
}

// Convert a Date object or date input value to Thai Input Format (DD/MM/YYYY B.E.)
export function formatThaiInputDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const yearBE = parseInt(parts[0], 10) + 543;
  return `${parts[2]}/${parts[1]}/${yearBE}`;
}

export function computeStats(transactions: Transaction[]): DashboardStats {
  let shopeeGross = 0;
  let shopeeVoid = 0;
  let shopeeOrders = 0;
  let shopeeItems = 0;

  let lazadaGross = 0;
  let lazadaVoid = 0;
  let lazadaOrders = 0;
  let lazadaItems = 0;

  transactions.forEach((tx) => {
    const amount = Number(tx.amount) || 0;
    const orders = Number(tx.orders) || 0;
    const items = Number(tx.items !== undefined && !isNaN(tx.items) ? tx.items : 0);

    if (tx.platform === 'shopee') {
      if (tx.type === 'sale') {
        shopeeGross += amount;
        shopeeOrders += orders;
        shopeeItems += items;
      } else if (tx.type === 'void') {
        shopeeVoid += amount;
      }
    } else if (tx.platform === 'lazada') {
      if (tx.type === 'sale') {
        lazadaGross += amount;
        lazadaOrders += orders;
        lazadaItems += items;
      } else if (tx.type === 'void') {
        lazadaVoid += amount;
      }
    }
  });

  const shopeeNet = shopeeGross - shopeeVoid;
  const lazadaNet = lazadaGross - lazadaVoid;

  const totalGross = shopeeGross + lazadaGross;
  const totalVoid = shopeeVoid + lazadaVoid;
  const totalNet = shopeeNet + lazadaNet;
  const totalOrders = shopeeOrders + lazadaOrders;
  const totalItems = shopeeItems + lazadaItems;

  // Calculate revenue share percentages
  const shopeeShare = totalNet > 0 ? Math.round((shopeeNet / totalNet) * 100) : 0;
  const lazadaShare = totalNet > 0 ? 100 - shopeeShare : 0;

  return {
    netRevenue: totalNet,
    grossRevenue: totalGross,
    voidAmount: totalVoid,
    totalOrders,
    shopeeOrders,
    lazadaOrders,
    totalItems,
    shopeeItems,
    lazadaItems,
    shopee: {
      grossSales: shopeeGross,
      voidAmount: shopeeVoid,
      netSales: shopeeNet,
      orders: shopeeOrders,
      items: shopeeItems,
      revenueShare: shopeeShare,
    },
    lazada: {
      grossSales: lazadaGross,
      voidAmount: lazadaVoid,
      netSales: lazadaNet,
      orders: lazadaOrders,
      items: lazadaItems,
      revenueShare: lazadaShare,
    },
  };
}

// Export list to CSV content
export function exportToCSV(transactions: Transaction[], hideStaffCode?: boolean): string {
  const sortedTransactions = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const headers = ['ID', 'วันที่ (YYYY-MM-DD)', 'แพลตฟอร์ม', 'ประเภท', 'จำนวนเงิน (บาท)', 'จำนวนออเดอร์', 'จำนวนชิ้น (ชิ้น)', 'หมายเหตุ'];
  if (!hideStaffCode) {
    headers.push('รหัสพนักงาน (Staff Code)');
  }
  
  const rows = sortedTransactions.map((tx) => {
    const row: any[] = [
      tx.id,
      tx.date,
      tx.platform === 'shopee' ? 'Shopee' : 'Lazada',
      tx.type === 'sale' ? 'ยอดขาย (Sale)' : 'ยอด Void',
      tx.amount,
      tx.orders,
      tx.items !== undefined && !isNaN(tx.items) ? tx.items : 0,
      `"${(tx.note || '').replace(/"/g, '""')}"`
    ];
    if (!hideStaffCode) {
      row.push(tx.staffCode || '');
    }
    return row;
  });
  
  // Use UTF-8 BOM for Excel to open Thai characters properly
  return '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
}

// Export list to CSV specifically formatted for AppSheet & Google Sheets (English headers and raw data)
export function exportToAppSheetCSV(transactions: Transaction[], hideStaffCode?: boolean): string {
  const sortedTransactions = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const headers = ['Date', 'Platform', 'Type', 'Amount', 'Order Number', 'Notes', 'Quantity', 'Items', 'Timestamp'];
  if (!hideStaffCode) {
    headers.push('Staff Code');
  }
  
  const rows = sortedTransactions.map((tx) => {
    const row: any[] = [
      tx.date,
      tx.platform === 'shopee' ? 'Shopee' : 'Lazada',
      tx.type === 'sale' ? 'Sale' : 'Void',
      tx.amount,
      '', // Map ID to 'Order Number' (Left blank)
      `"${(tx.note || '').replace(/"/g, '""')}"`, // Map note to 'Notes'
      tx.orders, // Map orders to 'Quantity'
      tx.items !== undefined && !isNaN(tx.items) ? tx.items : 0, // Items (จำนวนชิ้น)
      tx.timestamp || `${tx.date} 09:00:00` // Map to the transaction's specific timestamp
    ];
    if (!hideStaffCode) {
      row.push(tx.staffCode || '');
    }
    return row;
  });
  
  // Standard UTF-8 CSV representation for Google Sheets and AppSheet (no Excel BOM required, native structure)
  return [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
}
