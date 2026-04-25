export const BINANCE_WS_MARKET = 'wss://fstream.binance.com/market/ws';
export const BINANCE_API = 'https://fapi.binance.com';

export const MAX_MARKERS_PER_SYMBOL = 500;
export const MIN_VOLUME_BTC = 100000;
export const MIN_VOLUME_ETH = 50000;
export const MIN_VOLUME_USD = 10000;
export const STORAGE_PREFIX = 'binance_liq_';
export const MAX_RECENT = 20;

export const state = {
  coins: new Map(),
  filteredCoins: [],
  currentSymbol: 'BTCUSDT',
  ws: null,
  wsReady: false,
  liquidationWs: null,
  chart: null,
  candleSeries: null,
  candleMarkersApi: null,
  ema65Series: null,
  ema125Series: null,
  ema450Series: null,
  sortField: 'change',
  sortDesc: true,
  currentTimeframe: '15m',
  lastSubscriptionSet: new Set(),
  currentKlineSymbol: null,
  currentCandles: [],
  oldestTime: null,
  isLoadingMore: false,
  liquidationMarkers: [],
  liquidationCount: 0,
  allLiquidations: new Map(),
  recentLiquidations: [],
};
