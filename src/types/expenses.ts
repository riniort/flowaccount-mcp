export interface ExpenseItem {
  name: string;
  description?: string;
  quantity: number;
  unitName?: string;
  pricePerUnit: number;
  discount?: number;
  vatType?: number;
  chartOfAccountCode?: string;
}

export interface Expense {
  recordId?: number;
  documentSerial?: string;
  contactCode?: string;
  contactName: string;
  contactAddress?: string;
  contactTaxId?: string;
  contactBranch?: string;
  publishedOn: string;
  dueDate?: string;
  items: ExpenseItem[];
  subTotal?: number;
  discountPercentage?: number;
  discountAmount?: number;
  totalAfterDiscount?: number;
  isVat?: boolean;
  vatAmount?: number;
  grandTotal?: number;
  remarks?: string;
  internalNotes?: string;
  status?: number;
  statusString?: string;
  paymentMethod?: number; // 1=Cash, 3=Cheque, 5=Transfer, 7=CreditCard
}

export interface ExpenseListParams {
  offset?: number;
  limit?: number;
  sortBy?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
}
