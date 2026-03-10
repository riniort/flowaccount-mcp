export interface DocumentItem {
  name: string;
  description?: string;
  quantity: number;
  unitName?: string;
  pricePerUnit: number;
  discount?: number;
  vatType?: number; // 1=Vat, 2=VatExempt, 3=NoVat
}

export interface Document {
  recordId?: number;
  documentSerial?: string;
  contactCode?: string;
  contactName: string;
  contactAddress?: string;
  contactTaxId?: string;
  contactBranch?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhoneNumber?: string;
  contactZipCode?: string;
  contactGroup?: number; // 1=Individual, 3=Business
  publishedOn: string; // yyyy-MM-dd
  creditType?: number; // 1=Credit(days), 3=Cash, 5=NoDate
  creditDays?: number;
  dueDate?: string; // yyyy-MM-dd
  salesName?: string;
  projectName?: string;
  reference?: string;
  isVatInclusive?: boolean;
  items: DocumentItem[];
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
}

export interface DocumentListParams {
  offset?: number;
  limit?: number;
  sortBy?: string;
  filter?: string;
  startDate?: string;
  endDate?: string;
}
