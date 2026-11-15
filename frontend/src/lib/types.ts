// Shapes returned by the API (money values are strings like "1200.00").

export type Role = "owner" | "helper";
export type PayMode = "cash" | "esewa" | "khalti" | "bank" | "other";
export const PAY_MODES: PayMode[] = ["cash", "esewa", "khalti", "bank", "other"];

export interface Me {
  id: string;
  name: string;
  login: string;
  role: Role;
  shop: { id: string; name: string };
}

export interface CustomerRow {
  id: string;
  name: string;
  other_name: string | null;
  phone: string | null;
  address: string | null;
  balance: string;
  last_activity: string | null;
  days_owing: number | null;
  next_collection_date: string | null;
  archived: boolean;
  possible_duplicate_of: string | null;
  /** client only: customer exists only in the outbox so far */
  pending_new?: boolean;
}

export interface BriefRow {
  id: string;
  name: string;
  balance: string;
  next_collection_date: string | null;
  last_activity: string | null;
  overdue_days?: number;
}

export interface TodayCard {
  date: string;
  bills: number;
  total_sales: string;
  total_received: string;
  received_by_mode: Record<string, string>;
  discounts: string;
  people: { user_id: string; name: string; entries: number; sales: string; received: string }[];
}

export interface OwingGroup {
  bucket: "0-7" | "8-14" | "15-30" | "30+";
  total: string;
  count: number;
  customers: { id: string; name: string; amount: string }[];
  estimated: boolean;
}

export interface Khata {
  today: string;
  total_to_collect: string;
  owing_count: number;
  today_card: TodayCard;
  collect_now: BriefRow[];
  coming_up: BriefRow[];
  no_date: BriefRow[];
  owing_for: OwingGroup[];
  customers: CustomerRow[];
  possible_duplicates?: { id: string; name: string; twin_id: string; twin_name: string | null }[];
}

export interface TodayEntry {
  type: "sale" | "payment" | "discount";
  id: string;
  customer_id: string;
  customer_name: string | null;
  amount: string;
  bill_no?: string | null;
  mode?: string;
  at: string;
  entered_by: string | null;
}

export interface SaleLineOut {
  fruit_name: string;
  kg: string;
  rate: string;
  crates: number | null;
  amount: string;
}

export interface HistoryEntry {
  type: "opening" | "sale" | "payment" | "discount";
  id: string;
  date: string;
  at: string;
  amount: string;
  voided: boolean;
  void_reason?: string | null;
  entered_by: string | null;
  entered_by_id?: string;
  entered_at: string;
  bill_no?: string | null;
  lines?: SaleLineOut[];
  mode?: string;
  note?: string | null;
  /** a sale: the money received at the counter with this bill (saved in the same entry) */
  paid_with?: { id: string; amount: string; mode: string; voided: boolean } | null;
  /** a payment: the bill it was received with */
  with_sale?: string | null;
  balance_before: string;
  balance_after: string;
}

export interface StillOwedRow {
  kind: "opening" | "sale";
  ref_id: string;
  bill_no: string | null;
  date: string;
  original: string;
  left: string;
  age_days: number;
}

export interface Sheet extends CustomerRow {
  total_sold: string;
  total_received: string;
  total_discounts: string;
  payments_count: number;
  last_paid: string | null;
  advance: boolean;
  merged_into_id: string | null;
  old_balance: string | null;
  old_balance_date: string | null;
  still_owed: StillOwedRow[];
  ageing_estimated: boolean;
}

export interface Settings {
  name: string;
  next_bill_no: number;
  role: Role;
  backup_email_day?: number;
  backup_email_time?: string;
  owner_email?: string | null;
}

export interface FruitName {
  id: string;
  name: string;
  last_rate: string | null;
  last_used_at: string | null;
}

export interface UserRow {
  id: string;
  name: string;
  login: string;
  role: Role;
  disabled: boolean;
}

export interface SalesGroup {
  key: string;
  label: string;
  start: string;
  end: string;
  bills: number;
  total_kg: string;
  total_sales: string;
  received: string;
  fruits: { fruit: string; kg: string; amount: string; customers: { customer_id: string; name: string; kg: string }[] }[];
  bill_list: { sale_id: string; customer_id: string; customer_name: string; bill_no: string | null; date: string; total: string }[];
}

// ---- POST /entries
export interface EntryLine {
  fruit_name: string;
  kg: string;
  rate: string;
  crates?: number | null;
}

export interface NewCustomerPayload {
  id: string;
  name: string;
  other_name?: string | null;
  phone?: string | null;
  address?: string | null;
  old_balance?: string | null;
  old_balance_date?: string | null;
}

export interface EntryPayload {
  customer_id?: string;
  new_customer?: NewCustomerPayload;
  sale_id?: string;
  lines?: EntryLine[];
  bill_no?: string | null;
  entry_date?: string;
  payment_id?: string;
  received_amount?: string;
  mode?: PayMode;
  kind?: "payment" | "discount";
  note?: string | null;
  collect_by?: string | null; // omitted = keep, null = none
  created_at: string;
}

export interface EntryResult {
  customer: { id: string; name: string; balance: string; next_collection_date: string | null };
  sale: { id: string; total: string; bill_no: string | null } | null;
  payment: { id: string; amount: string; kind: string } | null;
  duplicate: boolean;
}
