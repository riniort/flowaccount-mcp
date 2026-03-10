export interface Contact {
  contactId?: number;
  contactCode?: string;
  contactName: string;
  contactGroup?: number; // 1=Individual, 3=Business
  contactType?: number; // 1=Customer, 2=Supplier, 3=Both
  contactAddress?: string;
  contactTaxId?: string;
  contactBranch?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhoneNumber?: string;
  contactMobileNumber?: string;
  contactFax?: string;
  contactWebsite?: string;
  contactZipCode?: string;
  contactNote?: string;
}

export interface ContactListParams {
  offset?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
}
