// Real API endpoints discovered via network interception on advance.flowaccount.com
//
// Base URLs (discovered):
//   CORE_API  = https://api-core-canary.flowaccount.com/api  → quotations, expenses, contacts, banks, tax-invoices, receipts, billing-notes, purchase-orders
//   BIZ_API   = https://business-api.flowaccount.com         → cash-invoices
//   PROFILE   = https://profile.flowaccount.com              → company info, user profile

export const BASE = {
  CORE: "https://api-core-canary.flowaccount.com/api",
  BIZ: "https://business-api.flowaccount.com",
  PROFILE: "https://profile.flowaccount.com",
} as const;

// Each endpoint returns { baseUrl, path } so the HTTP client knows which host to call
type Ep = { base: string; path: string };
const ep = (base: string, path: string): Ep => ({ base, path });

export const endpoints = {
  // === SELL DOCUMENTS (api-core-canary) ===
  quotations: {
    list:         (c: string)             => ep(BASE.CORE, `/${c}/quotations`),
    get:          (c: string, id: number) => ep(BASE.CORE, `/${c}/quotations/${id}`),
    create:       (c: string)             => ep(BASE.CORE, `/${c}/quotations`),
    update:       (c: string, id: number) => ep(BASE.CORE, `/${c}/quotations/${id}`),
    delete:       (c: string, id: number) => ep(BASE.CORE, `/${c}/quotations/${id}`),
    changeStatus: (c: string, id: number, statusKey: string) => ep(BASE.CORE, `/${c}/quotations/${id}/status-key/${statusKey}`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/quotations/${id}/update-document-attachment`),
  },
  billingNotes: {
    list:          (c: string)             => ep(BASE.CORE, `/${c}/billing-notes`),
    get:           (c: string, id: number) => ep(BASE.CORE, `/${c}/billing-notes/${id}`),
    create:        (c: string)             => ep(BASE.CORE, `/${c}/billing-notes`),
    update:        (c: string, id: number) => ep(BASE.CORE, `/${c}/billing-notes/${id}`),
    delete:        (c: string, id: number) => ep(BASE.CORE, `/${c}/billing-notes/${id}`),
    recordPayment: (c: string, id: number) => ep(BASE.CORE, `/${c}/billing-notes/${id}/payments`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/billing-notes/${id}/update-document-attachment`),
  },
  taxInvoices: {
    list:          (c: string)             => ep(BASE.CORE, `/${c}/tax-invoices`),
    get:           (c: string, id: number) => ep(BASE.CORE, `/${c}/tax-invoices/${id}`),
    create:        (c: string)             => ep(BASE.CORE, `/${c}/tax-invoices`),
    update:        (c: string, id: number) => ep(BASE.CORE, `/${c}/tax-invoices/${id}`),
    delete:        (c: string, id: number) => ep(BASE.CORE, `/${c}/tax-invoices/${id}`),
    recordPayment: (c: string, id: number) => ep(BASE.CORE, `/${c}/tax-invoices/${id}/payments`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/tax-invoices/${id}/update-document-attachment`),
  },
  receipts: {
    list:          (c: string)             => ep(BASE.CORE, `/${c}/receipts`),
    get:           (c: string, id: number) => ep(BASE.CORE, `/${c}/receipts/${id}`),
    create:        (c: string)             => ep(BASE.CORE, `/${c}/receipts`),
    update:        (c: string, id: number) => ep(BASE.CORE, `/${c}/receipts/${id}`),
    delete:        (c: string, id: number) => ep(BASE.CORE, `/${c}/receipts/${id}`),
    recordPayment: (c: string, id: number) => ep(BASE.CORE, `/${c}/receipts/${id}/payments`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/receipts/${id}/update-document-attachment`),
  },

  // === CASH INVOICES (business-api) ===
  cashInvoices: {
    list:          (c: string)             => ep(BASE.BIZ, `/${c}/cash-invoices`),
    get:           (c: string, id: number) => ep(BASE.BIZ, `/${c}/cash-invoices/${id}`),
    create:        (c: string)             => ep(BASE.BIZ, `/${c}/cash-invoices/simple-document`),
    update:        (c: string, id: number) => ep(BASE.BIZ, `/${c}/cash-invoices/simple-document/${id}`),
    delete:        (c: string, id: number) => ep(BASE.BIZ, `/${c}/cash-invoices/${id}`),
    recordPayment: (c: string, id: number) => ep(BASE.BIZ, `/${c}/cash-invoices/${id}/payments`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/cash-invoices/${id}/update-document-attachment`),
  },

  // === BUY DOCUMENTS (api-core-canary) ===
  purchaseOrders: {
    list:   (c: string)             => ep(BASE.CORE, `/${c}/purchase-orders`),
    get:    (c: string, id: number) => ep(BASE.CORE, `/${c}/purchase-orders/${id}`),
    create: (c: string)             => ep(BASE.CORE, `/${c}/purchase-orders`),
    update: (c: string, id: number) => ep(BASE.CORE, `/${c}/purchase-orders/${id}`),
    delete: (c: string, id: number) => ep(BASE.CORE, `/${c}/purchase-orders/${id}`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/purchase-orders/${id}/update-document-attachment`),
  },

  // === EXPENSES (api-core-canary) ===
  expenses: {
    list:          (c: string)             => ep(BASE.CORE, `/${c}/expenses`),
    get:           (c: string, id: number) => ep(BASE.CORE, `/${c}/expenses/${id}`),
    create:        (c: string)             => ep(BASE.CORE, `/${c}/expenses`),
    update:        (c: string, id: number) => ep(BASE.CORE, `/${c}/expenses/${id}`),
    delete:        (c: string, id: number) => ep(BASE.CORE, `/${c}/expenses/${id}`),
    recordPayment: (c: string, id: number) => ep(BASE.CORE, `/${c}/expenses/${id}/payments`),
    uploadAttachment: (c: string, id: number) => ep(BASE.CORE, `/${c}/expenses/${id}/update-document-attachment`),
  },

  // === CONTACTS (api-core-canary) ===
  contacts: {
    list:   (c: string)             => ep(BASE.CORE, `/${c}/contacts`),
    search: (c: string)             => ep(BASE.CORE, `/${c}/contacts/search`),
    get:    (c: string, id: number) => ep(BASE.CORE, `/${c}/contacts/${id}`),
    create: (c: string)             => ep(BASE.CORE, `/${c}/contacts`),
    update: (c: string, id: number) => ep(BASE.CORE, `/${c}/contacts/${id}`),
    delete: (c: string, id: number) => ep(BASE.CORE, `/${c}/contacts/${id}`),
  },

  // === PRODUCTS (api-core-canary) ===
  products: {
    list:   (c: string)             => ep(BASE.CORE, `/${c}/products`),
    get:    (c: string, id: number) => ep(BASE.CORE, `/${c}/products/${id}`),
    create: (c: string)             => ep(BASE.CORE, `/${c}/products`),
    update: (c: string, id: number) => ep(BASE.CORE, `/${c}/products/${id}`),
    delete: (c: string, id: number) => ep(BASE.CORE, `/${c}/products/${id}`),
  },

  // === BUSINESS INFO (profile.flowaccount.com) ===
  businessInfo: {
    me:           () => ep(BASE.PROFILE, `/users/me`),
    bankAccounts: (c: string) => ep(BASE.CORE, `/${c}/banks`),
  },
};
