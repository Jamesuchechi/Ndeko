import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { HlcClock, uuidv7, type NdekoEvent, type EventType, ProjectionRunner } from '@ndeko/core';
import { DexieEventStore } from '@ndeko/store';
import {
  stockProjection,
  productsProjection,
  productView,
  negativeStock,
  type StockState,
  type ProductsState,
  type ProductView,
  type NegativeStock,
} from '@ndeko/projections';
import { LATEST_SCHEMA_V, type ProductUpsertedV1, type SaleRecordedV1 } from '@ndeko/schemas';
import { SyncClient, type SyncState } from '../sync/client';

export interface DeviceConfig {
  orgId: string;
  branchId: string;
  branchCode: string;
  deviceId: string;
  deviceCode: string;
  receiptCounter: number;
  serverUrl?: string;
  deviceToken?: string;
}

const DEFAULT_CONFIG: DeviceConfig = {
  orgId: 'org_ndeko_01',
  branchId: 'branch_abj_01',
  branchCode: 'ABJ1',
  deviceId: 'dev_' + Math.random().toString(36).slice(2, 8),
  deviceCode: 'D1',
  receiptCounter: 0,
  serverUrl: 'http://localhost:8787',
  deviceToken: '',
};

export interface CartLine {
  product: ProductView;
  qty: number; // milli-units (1000 = 1 unit)
  unitPriceKobo: number;
  lineTotalKobo: number;
}

export interface NdekoContextType {
  isReady: boolean;
  isLocked: boolean;
  config: DeviceConfig;
  stockState: StockState;
  productsState: ProductsState;
  products: ProductView[];
  negativeStockAlerts: NegativeStock[];
  pendingCount: number;
  totalEventCount: number;
  isOnline: boolean;
  syncState: SyncState;
  syncNow: () => Promise<void>;
  registerDeviceOnServer: (serverUrl: string) => Promise<void>;
  dismissDriftWarning: () => void;
  unlockTill: (pin: string) => boolean;
  lockTill: () => void;
  setTillPin: (newPin: string) => void;
  // Commands
  createOrUpdateProduct: (fields: {
    productId?: string | undefined;
    name: string;
    barcode?: string | null | undefined;
    priceKobo: number;
    costKobo?: number | undefined;
    unit?: ProductUpsertedV1['unit'] | undefined;
    archived?: boolean | undefined;
  }) => Promise<string>;
  receiveStock: (
    productId: string,
    qty: number,
    unitCostKobo?: number | undefined,
    supplierId?: string | undefined,
    note?: string | undefined,
  ) => Promise<void>;
  adjustStock: (
    productId: string,
    qtyDelta: number,
    reason: 'COUNT' | 'DAMAGE' | 'EXPIRY' | 'THEFT' | 'OTHER',
    note?: string | undefined,
  ) => Promise<void>;
  recordSale: (params: {
    lines: { productId: string; qty: number; unitPriceKobo: number; lineTotalKobo: number }[];
    tenders: { method: 'CASH' | 'TRANSFER' | 'CARD' | 'CREDIT'; amountKobo: number }[];
    totalKobo: number;
    customerId?: string | undefined;
  }) => Promise<NdekoEvent<SaleRecordedV1>>;
  voidSale: (saleId: string, reason: string) => Promise<void>;
  closeDay: (
    businessDate: string,
    expectedCashKobo: number,
    countedCashKobo: number,
    note?: string | undefined,
  ) => Promise<void>;
  exportBackup: () => Promise<string>;
  importBackup: (backupJson: string) => Promise<{ imported: number }>;
  getProductLedger: (productId: string) => Promise<NdekoEvent[]>;
  getAllSales: () => Promise<NdekoEvent<SaleRecordedV1>[]>;
}

const NdekoContext = createContext<NdekoContextType | null>(null);

export const NdekoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [store] = useState(() => new DexieEventStore('ndeko_shop_db'));
  const [config, setConfig] = useState<DeviceConfig>(() => {
    const saved = localStorage.getItem('ndeko_device_config');
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  });
  const [clock] = useState<HlcClock>(() => new HlcClock({ deviceId: config.deviceId }));

  const [stockRunner] = useState(() => new ProjectionRunner(stockProjection));
  const [productsRunner] = useState(() => new ProjectionRunner(productsProjection));
  const [stockState, setStockState] = useState<StockState>(() => stockProjection.init());
  const [productsState, setProductsState] = useState<ProductsState>(() =>
    productsProjection.init(),
  );

  const [pendingCount, setPendingCount] = useState(0);
  const [totalEventCount, setTotalEventCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [isLocked, setIsLocked] = useState(() => {
    return localStorage.getItem('ndeko_lock_enabled') === 'true';
  });

  const saveConfig = (newCfg: DeviceConfig) => {
    setConfig(newCfg);
    localStorage.setItem('ndeko_device_config', JSON.stringify(newCfg));
  };

  const [syncClient] = useState(() => {
    return new SyncClient(
      {
        serverUrl: config.serverUrl || 'http://localhost:8787',
        deviceToken: config.deviceToken || '',
      },
      store,
      clock,
    );
  });
  const [syncState, setSyncState] = useState<SyncState>(syncClient.state);

  // Re-run catchUp to update state
  const refreshProjections = useCallback(async () => {
    await stockRunner.catchUp(store);
    await productsRunner.catchUp(store);
    setStockState(structuredClone(stockRunner.state));
    setProductsState(structuredClone(productsRunner.state));
    const pCount = await store.pendingCount();
    const tCount = await store.count();
    setPendingCount(pCount);
    setTotalEventCount(tCount);
  }, [store, stockRunner, productsRunner]);

  useEffect(() => {
    const unsub = syncClient.subscribe((s) => {
      setSyncState({ ...s });
      setPendingCount(s.pendingCount);
    });
    syncClient.start();
    return () => {
      unsub();
      syncClient.stop();
    };
  }, [syncClient]);

  useEffect(() => {
    const unsub = syncClient.onRemoteEvents(async () => {
      await refreshProjections();
    });
    return unsub;
  }, [syncClient, refreshProjections]);

  const syncNow = useCallback(async () => {
    await syncClient.syncNow();
  }, [syncClient]);

  const dismissDriftWarning = useCallback(() => {
    syncClient.state.driftWarning = false;
    setSyncState({ ...syncClient.state });
  }, [syncClient]);

  const registerDeviceOnServer = useCallback(
    async (serverUrl: string) => {
      const res = await fetch(`${serverUrl}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: config.orgId,
          branchCode: config.branchCode,
          deviceCode: config.deviceCode,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Device registration failed: ${err}`);
      }
      const data = await res.json();
      const updatedCfg: DeviceConfig = {
        ...config,
        serverUrl,
        deviceToken: data.deviceToken,
        deviceId: data.deviceId,
      };
      saveConfig(updatedCfg);
      syncClient.updateConfig({
        serverUrl,
        deviceToken: data.deviceToken,
      });
      await syncClient.syncNow();
    },
    [config, syncClient],
  );

  // Seed sample products if database is fresh
  const seedInitialDataIfNeeded = useCallback(
    async (currentClock: HlcClock, currentCfg: DeviceConfig) => {
      const count = await store.count();
      if (count > 0) return;

      const sampleProducts = [
        {
          id: 'prod_indomie_01',
          name: 'Indomie Onion Chicken 70g (Carton)',
          barcode: '089686010839',
          priceKobo: 950000,
          costKobo: 820000,
          unit: 'carton' as const,
          stockMilli: 25000,
        },
        {
          id: 'prod_sugar_02',
          name: 'Dangote Refined Sugar 50kg',
          barcode: '6151100010022',
          priceKobo: 8500000,
          costKobo: 7900000,
          unit: 'each' as const,
          stockMilli: 12000,
        },
        {
          id: 'prod_semo_03',
          name: 'Golden Penny Semovita 2kg',
          barcode: '6151100020045',
          priceKobo: 320000,
          costKobo: 280000,
          unit: 'each' as const,
          stockMilli: 40000,
        },
        {
          id: 'prod_milk_04',
          name: 'Peak Evaporated Milk 160g',
          barcode: '6151100030082',
          priceKobo: 75000,
          costKobo: 65000,
          unit: 'each' as const,
          stockMilli: 80000,
        },
        {
          id: 'prod_water_05',
          name: 'Eva Premium Water 75cl (Pack of 12)',
          barcode: '6151100040111',
          priceKobo: 220000,
          costKobo: 180000,
          unit: 'pack' as const,
          stockMilli: 30000,
        },
        {
          id: 'prod_rice_06',
          name: 'Mama Gold Rice 50kg',
          barcode: '6151100050222',
          priceKobo: 9200000,
          costKobo: 8600000,
          unit: 'each' as const,
          stockMilli: 8000,
        },
      ];

      let seq = currentCfg.receiptCounter;
      for (const p of sampleProducts) {
        const prodEvent: NdekoEvent = {
          id: uuidv7(),
          orgId: currentCfg.orgId,
          branchId: currentCfg.branchId,
          deviceId: currentCfg.deviceId,
          seq: seq++,
          hlc: currentClock.tick(),
          type: 'PRODUCT_UPSERTED',
          schemaV: 1,
          payload: {
            productId: p.id,
            name: p.name,
            barcode: p.barcode,
            priceKobo: p.priceKobo,
            costKobo: p.costKobo,
            unit: p.unit,
            archived: false,
          },
          createdAt: Date.now(),
        };
        await store.append(prodEvent);

        const stockEvent: NdekoEvent = {
          id: uuidv7(),
          orgId: currentCfg.orgId,
          branchId: currentCfg.branchId,
          deviceId: currentCfg.deviceId,
          seq: seq++,
          hlc: currentClock.tick(),
          type: 'STOCK_RECEIVED',
          schemaV: 1,
          payload: {
            productId: p.id,
            qty: p.stockMilli,
            unitCostKobo: p.costKobo,
            supplierId: 'sup_initial',
            note: 'Initial opening stock inventory',
          },
          createdAt: Date.now(),
        };
        await store.append(stockEvent);
      }
      saveConfig({ ...currentCfg, receiptCounter: seq });
    },
    [store],
  );

  // Init lifecycle
  useEffect(() => {
    let mounted = true;
    (async () => {
      await seedInitialDataIfNeeded(clock, config);
      if (mounted) {
        await refreshProjections();
        setIsReady(true);
      }
    })();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [clock, config, refreshProjections, seedInitialDataIfNeeded]);

  // Append helper
  const appendEvent = async (type: EventType, payload: unknown): Promise<NdekoEvent> => {
    const nextSeq = config.receiptCounter + 1;
    const event: NdekoEvent = {
      id: uuidv7(),
      orgId: config.orgId,
      branchId: config.branchId,
      deviceId: config.deviceId,
      seq: nextSeq,
      hlc: clock.tick(),
      type,
      schemaV: LATEST_SCHEMA_V[type],
      payload,
      createdAt: Date.now(),
    };
    await store.append(event);
    saveConfig({ ...config, receiptCounter: nextSeq });
    await refreshProjections();
    syncClient.syncNow().catch(() => {});
    return event;
  };

  const createOrUpdateProduct = async (fields: {
    productId?: string | undefined;
    name: string;
    barcode?: string | null | undefined;
    priceKobo: number;
    costKobo?: number | undefined;
    unit?: ProductUpsertedV1['unit'] | undefined;
    archived?: boolean | undefined;
  }) => {
    const productId = fields.productId || uuidv7();
    await appendEvent('PRODUCT_UPSERTED', {
      productId,
      name: fields.name.trim(),
      barcode: fields.barcode ? fields.barcode.trim() : null,
      priceKobo: fields.priceKobo,
      costKobo: fields.costKobo,
      unit: fields.unit || 'each',
      archived: fields.archived || false,
    });
    return productId;
  };

  const receiveStock = async (
    productId: string,
    qty: number,
    unitCostKobo?: number | undefined,
    supplierId?: string | undefined,
    note?: string | undefined,
  ) => {
    await appendEvent('STOCK_RECEIVED', {
      productId,
      qty,
      unitCostKobo,
      supplierId,
      note,
    });
  };

  const adjustStock = async (
    productId: string,
    qtyDelta: number,
    reason: 'COUNT' | 'DAMAGE' | 'EXPIRY' | 'THEFT' | 'OTHER',
    note?: string | undefined,
  ) => {
    await appendEvent('STOCK_ADJUSTED', {
      productId,
      qtyDelta,
      reason,
      note,
    });
  };

  const recordSale = async (params: {
    lines: { productId: string; qty: number; unitPriceKobo: number; lineTotalKobo: number }[];
    tenders: { method: 'CASH' | 'TRANSFER' | 'CARD' | 'CREDIT'; amountKobo: number }[];
    totalKobo: number;
    customerId?: string | undefined;
  }) => {
    const saleId = uuidv7();
    const nextReceiptNum = config.receiptCounter + 1;
    const receiptNo = `${config.branchCode}-${config.deviceCode}-${String(nextReceiptNum).padStart(6, '0')}`;
    const payload: SaleRecordedV1 = {
      saleId,
      receiptNo,
      lines: params.lines,
      tenders: params.tenders,
      totalKobo: params.totalKobo,
      ...(params.customerId ? { customerId: params.customerId } : {}),
    };
    const event = await appendEvent('SALE_RECORDED', payload);
    return event as NdekoEvent<SaleRecordedV1>;
  };

  const voidSale = async (saleId: string, reason: string) => {
    await appendEvent('SALE_VOIDED', {
      saleId,
      reason: reason.trim() || 'Voided by cashier',
    });
  };

  const closeDay = async (
    businessDate: string,
    expectedCashKobo: number,
    countedCashKobo: number,
    note?: string,
  ) => {
    await appendEvent('DAY_CLOSED', {
      businessDate,
      expectedCashKobo,
      countedCashKobo,
      note,
    });
  };

  const exportBackup = async (): Promise<string> => {
    const result = await store.readSince(0, 1000000);
    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config,
      events: result.events,
    };
    return JSON.stringify(backupData, null, 2);
  };

  const importBackup = async (backupJson: string): Promise<{ imported: number }> => {
    const data = JSON.parse(backupJson);
    if (!data.events || !Array.isArray(data.events)) {
      throw new Error('Invalid backup file: missing events array');
    }
    const inserted = await store.appendRemote(data.events);
    await refreshProjections();
    return { imported: inserted };
  };

  const getProductLedger = async (productId: string): Promise<NdekoEvent[]> => {
    const all = (await store.readSince(0, 1000000)).events;
    return all.filter((e) => {
      const p = e.payload as Record<string, unknown> | null | undefined;
      if (!p) return false;
      if (p.productId === productId) return true;
      if (Array.isArray(p.lines)) {
        return (p.lines as readonly { productId?: string }[]).some(
          (l) => l.productId === productId,
        );
      }
      return false;
    });
  };

  const getAllSales = async (): Promise<NdekoEvent<SaleRecordedV1>[]> => {
    const all = (await store.readSince(0, 1000000)).events;
    return all.filter((e) => e.type === 'SALE_RECORDED').reverse() as NdekoEvent<SaleRecordedV1>[];
  };

  const unlockTill = (pin: string): boolean => {
    const storedPin = localStorage.getItem('ndeko_till_pin') || '1234';
    if (pin === storedPin) {
      setIsLocked(false);
      return true;
    }
    return false;
  };

  const lockTill = () => {
    setIsLocked(true);
  };

  const setTillPin = (newPin: string) => {
    localStorage.setItem('ndeko_till_pin', newPin);
    localStorage.setItem('ndeko_lock_enabled', 'true');
  };

  const products = useMemo(() => {
    return Object.keys(productsState.products)
      .map((id) => productView(productsState, id)!)
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [productsState]);

  const negativeStockAlerts = useMemo(() => {
    return negativeStock(stockState);
  }, [stockState]);

  const value: NdekoContextType = {
    isReady,
    isLocked,
    config,
    stockState,
    productsState,
    products,
    negativeStockAlerts,
    pendingCount,
    totalEventCount,
    isOnline,
    syncState,
    syncNow,
    registerDeviceOnServer,
    dismissDriftWarning,
    unlockTill,
    lockTill,
    setTillPin,
    createOrUpdateProduct,
    receiveStock,
    adjustStock,
    recordSale,
    voidSale,
    closeDay,
    exportBackup,
    importBackup,
    getProductLedger,
    getAllSales,
  };

  return <NdekoContext.Provider value={value}>{children}</NdekoContext.Provider>;
};

export const useNdeko = () => {
  const ctx = useContext(NdekoContext);
  if (!ctx) throw new Error('useNdeko must be used within NdekoProvider');
  return ctx;
};
