export interface Product {
  productId?: number;
  type?: number; // 1=Service, 3=NonInventory, 5=Inventory
  name: string;
  code?: string;
  description?: string;
  sellPrice?: number;
  buyPrice?: number;
  unitName?: string;
  barcode?: string;
  vatType?: number;
  category?: string;
}

export interface ProductListParams {
  offset?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
}
