import {
  BINANCE_API,
  BINANCE_WS_MARKET,
  MAX_MARKERS_PER_SYMBOL,
  MIN_VOLUME_BTC,
  MIN_VOLUME_ETH,
  MIN_VOLUME_USD,
  STORAGE_PREFIX,
  MAX_RECENT,
  state,
} from './state.js';
import { calculateEMA, getTimeframeMs } from './utils.js';
import {
  renderCoinsList,
  sortCoins,
  updateCoinRow,
  updateCoinsCount,
  updateConnectionStatus,
  updateHeader,
  updateLiquidationFeed,
  updateStatusWithCount,
} from './ui.js';

async function init() {
  await loadCoins();
  initChart();
  connectWebSocket();
  connectLiquidationWebSocket();
  setupEvents();
  loadChartData(state.currentSymbol);
}

async function loadCoins() {
  try {
    const exchangeInfoRes = await fetch(`${BINANCE_API}/fapi/v1/exchangeInfo`);
    const exchangeData = await exchangeInfoRes.json();

    const usdtPairs = exchangeData.symbols.filter((s) =>
      s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL'
    );

    const tickersRes = await fetch(`${BINANCE_API}/fapi/v1/ticker/24hr`);
    const tickers = await tickersRes.json();
    const tickersMap = new Map(tickers.map((t) => [t.symbol, t]));

    const promises = usdtPairs.map(async (pair) => {
      const symbol = pair.symbol;
      const ticker = tickersMap.get(symbol);
      if (!ticker) return null;

      try {
        const klines30m = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=30m&limit=2`).then((r) => {
          if (!r.ok) throw new Error('No data');
          return r.json();
        });

        let change30m = 0;
        if (klines30m.length >= 1) {
          const lastCandle = klines30m[klines30m.length - 1];
          const open = parseFloat(lastCandle[1]);
          const close = parseFloat(lastCandle[4]);
          change30m = ((close - open) / open) * 100;
        }

        return {
          symbol,
          price: parseFloat(ticker.lastPrice),
          change: parseFloat(ticker.priceChangePercent),
          change30m,
        };
      } catch (_error) {
        return {
          symbol,
          price: parseFloat(ticker.lastPrice),
          change: parseFloat(ticker.priceChangePercent),
          change30m: 0,
        };
      }
    });

    const results = await Promise.all(promises);
    results.forEach((coinData) => {
      if (coinData) state.coins.set(coinData.symbol, coinData);
    });

    state.filteredCoins = Array.from(state.coins.values());
    sortCoins(state);
    renderCoinsList(state, selectCoin);
    updateCoinsCount(state);
  } catch (error) {
    console.error('Ошибка загрузки монет:', error);
    document.getElementById('coinsList').innerHTML = '<div class="loading">Ошибка загрузки</div>';
  }
}

function initChart() {
  const container = document.getElementById('chart');
  state.chart = LightweightCharts.createChart(container, {
    layout: { background: { color: '#0b0e11' }, textColor: '#d1d4dc' },
    grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#1e2329', autoScale: true, scaleMargins: { top: 0.02, bottom: 0.02 } },
    timeScale: { borderColor: '#1e2329', timeVisible: true },
  });

  state.candleSeries = state.chart.addCandlestickSeries({
    upColor: '#0ecb81', downColor: '#f6465d',
    borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
    wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
  });

  state.candleSeries.markers = () => ({ autoscaleInfo: () => null, markers: () => [] });
  state.candleSeries.priceScale().applyOptions({ autoScale: true, mode: 0 });

  state.ema65Series = state.chart.addLineSeries({ color: '#a0a4ab', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
  state.ema125Series = state.chart.addLineSeries({ color: '#a0a4ab', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
  state.ema450Series = state.chart.addLineSeries({ color: '#e0e3e8', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });

  window.addEventListener('resize', () => {
    state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
}

function connectLiquidationWebSocket() {
  state.liquidationWs = new WebSocket(`${BINANCE_WS_MARKET}/!forceOrder@arr`);

  state.liquidationWs.onopen = () => console.log('Liquidation WebSocket connected');
  state.liquidationWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.e === 'forceOrder') processLiquidation(msg.o);
  };
  state.liquidationWs.onclose = () => {
    console.log('Liquidation WebSocket closed, reconnecting...');
    setTimeout(connectLiquidationWebSocket, 5000);
  };
  state.liquidationWs.onerror = (e) => console.error('Liquidation WS error:', e);
}

function loadSavedMarkers(symbol) {
  const saved = localStorage.getItem(STORAGE_PREFIX + symbol);
  if (!saved) return [];

  try {
    return JSON.parse(saved);
  } catch (e) {
    console.error('Ошибка парсинга сохранённых маркеров:', e);
    return [];
  }
}

function saveMarkers(symbol, markers) {
  const key = STORAGE_PREFIX + symbol;
  try {
    localStorage.setItem(key, JSON.stringify(markers));
  } catch (e) {
    console.error('Ошибка сохранения маркеров в localStorage:', e);
    if (e.name === 'QuotaExceededError') {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX));
      keys.sort((a, b) => (localStorage.getItem(a)?.length || 0) - (localStorage.getItem(b)?.length || 0));
      for (let i = 0; i < Math.min(5, keys.length); i++) localStorage.removeItem(keys[i]);
      try {
        localStorage.setItem(key, JSON.stringify(markers));
      } catch (_e2) {
        console.error('Повторная ошибка сохранения');
      }
    }
  }
}

function processLiquidation(order) {
  const symbol = order.s;
  const price = parseFloat(order.p);
  const quantity = parseFloat(order.q);
  const volumeUSD = price * quantity;

  let minVol = MIN_VOLUME_USD;
  if (symbol === 'BTCUSDT') minVol = MIN_VOLUME_BTC;
  else if (symbol === 'ETHUSDT') minVol = MIN_VOLUME_ETH;
  if (volumeUSD < minVol) return;

  const timeframeMs = getTimeframeMs(state.currentTimeframe);
  const candleOpenTimeMs = Math.floor(order.T / timeframeMs) * timeframeMs;
  const isLongLiquidation = order.S === 'SELL';

  const marker = {
    time: Math.floor(candleOpenTimeMs / 1000),
    position: isLongLiquidation ? 'belowBar' : 'aboveBar',
    color: order.S === 'SELL' ? '#f6465d' : '#0ecb81',
    shape: 'circle',
    text: `${(volumeUSD / 1000).toFixed(0)}K`,
    size: 1,
  };

  state.recentLiquidations.unshift({ symbol, side: order.S, volume: volumeUSD, price, time: order.T });
  if (state.recentLiquidations.length > MAX_RECENT) state.recentLiquidations.pop();
  updateLiquidationFeed(state, selectCoin);

  if (!state.allLiquidations.has(symbol)) state.allLiquidations.set(symbol, loadSavedMarkers(symbol));
  const symbolMarkers = state.allLiquidations.get(symbol);

  const exists = symbolMarkers.some((m) => m.time === marker.time && m.text === marker.text);
  if (!exists) {
    symbolMarkers.push(marker);
    if (symbolMarkers.length > MAX_MARKERS_PER_SYMBOL) symbolMarkers.shift();
    saveMarkers(symbol, symbolMarkers);
  }

  if (symbol === state.currentSymbol) {
    state.liquidationMarkers = symbolMarkers;
    updateMarkersOnChart();
    state.liquidationCount = state.liquidationMarkers.length;
    updateStatusWithCount(state);
  }
}

function updateMarkersOnChart() {
  if (state.candleSeries) state.candleSeries.setMarkers(state.liquidationMarkers);
}

function updateEmaLines(candles) {
  if (!candles.length) return;
  state.ema65Series.setData(calculateEMA(candles, 65));
  state.ema125Series.setData(calculateEMA(candles, 125));
  state.ema450Series.setData(calculateEMA(candles, 450));
}

async function loadChartData(symbol) {
  try {
    const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${state.currentTimeframe}&limit=1400`);
    const klines = await res.json();

    state.currentCandles = klines.map((k) => ({
      time: k[0] / 1000,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    state.oldestTime = klines.length > 0 ? klines[0][0] : null;

    state.candleSeries.setData(state.currentCandles);
    updateEmaLines(state.currentCandles);
    state.chart.timeScale().fitContent();
    state.candleSeries.priceScale().applyOptions({ autoScale: true });

    if (!state.allLiquidations.has(symbol)) state.allLiquidations.set(symbol, loadSavedMarkers(symbol));
    state.liquidationMarkers = state.allLiquidations.get(symbol) || [];
    updateMarkersOnChart();
    state.liquidationCount = state.liquidationMarkers.length;
    updateStatusWithCount(state);

    if (state.wsReady) subscribeToKlineStream(symbol);
    updateHeader(state);
  } catch (e) {
    console.error('Ошибка загрузки графика:', e);
  }
}

async function loadMoreHistory() {
  if (state.isLoadingMore || !state.oldestTime) return;
  state.isLoadingMore = true;

  const btn = document.getElementById('loadMoreBtn');
  btn.textContent = '⏳';
  btn.disabled = true;

  try {
    const endTime = state.oldestTime - 1;
    const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${state.currentSymbol}&interval=${state.currentTimeframe}&limit=1000&endTime=${endTime}`);
    const klines = await res.json();
    if (klines.length === 0) return;

    const newCandles = klines.map((k) => ({
      time: k[0] / 1000,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    state.oldestTime = klines[0][0];
    state.currentCandles = [...newCandles, ...state.currentCandles];
    state.candleSeries.setData(state.currentCandles);
    updateEmaLines(state.currentCandles);
    updateMarkersOnChart();
  } catch (e) {
    console.error('Ошибка подгрузки истории:', e);
  } finally {
    btn.textContent = '📜';
    btn.disabled = false;
    state.isLoadingMore = false;
  }
}

function connectWebSocket() {
  state.ws = new WebSocket(BINANCE_WS_MARKET);

  state.ws.onopen = () => {
    state.wsReady = true;
    updateConnectionStatus(state, true);
    updateSubscriptions();
    if (state.currentSymbol) subscribeToKlineStream(state.currentSymbol);
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) return;
    if (msg.e === '24hrTicker') updateTicker(msg);
    else if (msg.e === 'kline') updateChartWithKline(msg);
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    updateConnectionStatus(state, false);
    state.lastSubscriptionSet.clear();
    state.currentKlineSymbol = null;
    setTimeout(connectWebSocket, 5000);
  };

  state.ws.onerror = (e) => console.error('WS error:', e);
}

function updateSubscriptions() {
  if (!state.wsReady || state.ws.readyState !== WebSocket.OPEN) return;

  const target = new Set(state.filteredCoins.slice(0, 50).map((c) => c.symbol.toLowerCase()));
  const toUnsub = [];
  const toSub = [];

  state.lastSubscriptionSet.forEach((sym) => { if (!target.has(sym)) toUnsub.push(`${sym}@ticker`); });
  target.forEach((sym) => { if (!state.lastSubscriptionSet.has(sym)) toSub.push(`${sym}@ticker`); });

  if (toUnsub.length) state.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: toUnsub, id: Date.now() }));
  if (toSub.length) state.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: toSub, id: Date.now() + 1 }));
  state.lastSubscriptionSet = target;
}

function subscribeToKlineStream(symbol) {
  if (!state.wsReady || state.ws.readyState !== WebSocket.OPEN) return;

  if (state.currentKlineSymbol && state.currentKlineSymbol !== symbol) {
    state.ws.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: [`${state.currentKlineSymbol.toLowerCase()}@kline_${state.currentTimeframe}`],
      id: Date.now(),
    }));
  }

  state.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${symbol.toLowerCase()}@kline_${state.currentTimeframe}`], id: Date.now() + 1 }));
  state.currentKlineSymbol = symbol;
}

function updateTicker(data) {
  const symbol = data.s.toUpperCase();
  const coin = state.coins.get(symbol);
  if (!coin) return;

  coin.price = parseFloat(data.c);
  coin.change = parseFloat(data.P);

  if (symbol === state.currentSymbol) updateHeader(state);
  const idx = state.filteredCoins.findIndex((c) => c.symbol === symbol);
  if (idx !== -1) updateCoinRow(coin);
}

function updateChartWithKline(data) {
  const k = data.k;
  const candleTime = k.t / 1000;
  const newCandle = {
    time: candleTime,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
  };

  const lastCandle = state.currentCandles.length > 0 ? state.currentCandles[state.currentCandles.length - 1] : null;

  if (!lastCandle) {
    state.currentCandles = [newCandle];
    state.candleSeries.setData(state.currentCandles);
  } else if (candleTime === lastCandle.time) {
    if (newCandle.high > lastCandle.high * 1.5 || newCandle.low < lastCandle.low * 0.5) return;
    Object.assign(lastCandle, newCandle);
    state.candleSeries.update(newCandle);
  } else if (candleTime > lastCandle.time) {
    state.currentCandles.push(newCandle);
    if (state.currentCandles.length > 1000) state.currentCandles.shift();
    state.candleSeries.update(newCandle);
  }

  updateEmaLines(state.currentCandles);
}

async function refresh30mChanges() {
  const headerSpan = document.querySelector('#listHeader span[data-sort="change30m"]');
  const originalText = headerSpan.textContent;
  headerSpan.textContent = '⏳ 30м';

  const promises = state.filteredCoins.map(async (coin) => {
    try {
      const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${coin.symbol}&interval=30m&limit=2`);
      if (!res.ok) return coin;
      const klines = await res.json();
      if (klines.length >= 1) {
        const lastCandle = klines[klines.length - 1];
        const open = parseFloat(lastCandle[1]);
        const close = parseFloat(lastCandle[4]);
        coin.change30m = ((close - open) / open) * 100;
      }
    } catch (_e) {}
    return coin;
  });

  await Promise.all(promises);
  headerSpan.textContent = originalText;
}

function setupEvents() {
  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTimeframe(btn.dataset.tf));
  });

  document.querySelectorAll('#listHeader span').forEach((span) => {
    span.addEventListener('click', async () => {
      const field = span.dataset.sort;
      if (field === 'change30m') await refresh30mChanges();
      sortBy(field);
    });
  });

  document.getElementById('loadMoreBtn').addEventListener('click', loadMoreHistory);
}

function sortBy(field) {
  if (state.sortField === field) state.sortDesc = !state.sortDesc;
  else {
    state.sortField = field;
    state.sortDesc = true;
  }

  sortCoins(state);
  renderCoinsList(state, selectCoin);
}

function selectCoin(symbol) {
  state.currentSymbol = symbol;
  document.getElementById('currentSymbol').textContent = `${symbol} (${state.currentTimeframe})`;

  document.querySelectorAll('.coin-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.symbol === symbol);
  });

  loadChartData(symbol);
  updateHeader(state);
}

function setTimeframe(tf) {
  state.currentTimeframe = tf;
  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tf === tf);
  });

  document.getElementById('currentSymbol').textContent = `${state.currentSymbol} (${tf})`;
  loadChartData(state.currentSymbol);
}

init();
