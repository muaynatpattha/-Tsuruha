export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  platform: 'shopee' | 'lazada';
  type: 'sale' | 'void';
  amount: number;
  orders: number;
  items: number; // จำนวนชิ้น
  note: string;
  staffCode?: string;
}

export interface PlatformSummary {
  grossSales: number;
  voidAmount: number;
  netSales: number;
  orders: number;
  items: number; // จำนวนชิ้น
  revenueShare: number; // percentage
}

export interface DashboardStats {
  netRevenue: number;
  grossRevenue: number;
  voidAmount: number;
  totalOrders: number;
  shopeeOrders: number;
  lazadaOrders: number;
  totalItems: number; // จำนวนชิ้นรวม
  shopeeItems: number; // จำนวนชิ้น Shopee
  lazadaItems: number; // จำนวนชิ้น Lazada
  shopee: PlatformSummary;
  lazada: PlatformSummary;
}
