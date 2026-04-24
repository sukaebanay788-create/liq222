// app.js
const BINANCE_WS_MARKET = 'wss://fstream.binance.com/market/ws';
const BINANCE_API = 'https://fapi.binance.com';

const { getTimeframeMs, calculateEMA } = window.AppUtils;
const {
    updateLiquidationFeed,
    renderCoinsList,
    updateCoinRow,
    updateHeader,
    updateCoinsCount,
    updateConnectionStatus,
} = window.AppUI;

let coins = new Map();
let filteredCoins = [];
let currentSymbol = 'BTCUSDT';
let ws = null;
let chart = null;
let candleSeries = null;
let ema65Series = null;
let ema125Series = null;
let ema450Series = null;
let sortField = 'change';
let sortDesc = true;
let currentTimeframe = '15m';
let lastSubscriptionSet = new Set();
let currentKlineSymbol = null;
let wsReady = false;

let currentCandles = [];
let oldestTime = null;
let isLoadingMore = false;

let liquidationWs = null;
let liquidationMarkers = [];
const MAX_MARKERS_PER_SYMBOL = 500;
const MIN_VOLUME_BTC = 100000;
const MIN_VOLUME_ETH = 50000;
const MIN_VOLUME_USD = 10000;
let liquidationCount = 0;

const allLiquidations = new Map();
const STORAGE_PREFIX = 'binance_liq_';

let recentLiquidations = [];
const MAX_RECENT = 20;

async function init() {
    await loadCoins();
    initChart();
    connectWebSocket();
    connectLiquidationWebSocket();
    setupEvents();
    loadChartData(currentSymbol);
}

async function loadCoins() {
    try {
        const exchangeInfoRes = await fetch(`${BINANCE_API}/fapi/v1/exchangeInfo`);
        const exchangeData = await exchangeInfoRes.json();

        const usdtPairs = exchangeData.symbols.filter(s =>
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING' &&
            s.contractType === 'PERPETUAL'
        );

        const tickersRes = await fetch(`${BINANCE_API}/fapi/v1/ticker/24hr`);
        const tickers = await tickersRes.json();
        const tickersMap = new Map(tickers.map(t => [t.symbol, t]));

        const promises = usdtPairs.map(async (pair) => {
            const symbol = pair.symbol;
            const ticker = tickersMap.get(symbol);
            if (!ticker) return null;

            try {
                const klines30m = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=30m&limit=2`).then(r => {
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
            } catch (e) {
                return {
                    symbol,
                    price: parseFloat(ticker.lastPrice),
                    change: parseFloat(ticker.priceChangePercent),
                    change30m: 0,
                };
            }
        });

        const results = await Promise.all(promises);
        results.forEach(coinData => {
            if (coinData) coins.set(coinData.symbol, coinData);
        });

        filteredCoins = Array.from(coins.values());
        sortCoins();
        renderCoinsList(filteredCoins, currentSymbol, selectCoin);
        updateCoinsCount(filteredCoins.length);
    } catch (error) {
        console.error('Ошибка загрузки монет:', error);
        document.getElementById('coinsList').innerHTML = '<div class="loading">Ошибка загрузки</div>';
    }
}

function initChart() {
    const container = document.getElementById('chart');
    chart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#0b0e11' }, textColor: '#d1d4dc' },
        grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#1e2329', autoScale: true, scaleMargins: { top: 0.02, bottom: 0.02 } },
        timeScale: { borderColor: '#1e2329', timeVisible: true },
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#0ecb81', downColor: '#f6465d',
        borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    });

    candleSeries.markers = () => ({
        autoscaleInfo: () => null,
        markers: () => [],
    });

    candleSeries.priceScale().applyOptions({ autoScale: true, mode: 0 });

    ema65Series = chart.addLineSeries({
        color: '#a0a4ab', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
    });
    ema125Series = chart.addLineSeries({
        color: '#a0a4ab', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
    });
    ema450Series = chart.addLineSeries({
        color: '#e0e3e8', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
    });

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
}

function connectLiquidationWebSocket() {
    liquidationWs = new WebSocket(`${BINANCE_WS_MARKET}/!forceOrder@arr`);

    liquidationWs.onopen = () => console.log('Liquidation WebSocket connected');

    liquidationWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.e === 'forceOrder') processLiquidation(msg.o);
    };

    liquidationWs.onclose = () => {
        console.log('Liquidation WebSocket closed, reconnecting...');
        setTimeout(connectLiquidationWebSocket, 5000);
    };

    liquidationWs.onerror = (e) => console.error('Liquidation WS error:', e);
}

function loadSavedMarkers(symbol) {
    const key = STORAGE_PREFIX + symbol;
    const saved = localStorage.getItem(key);
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
            const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX));
            keys.sort((a, b) => (localStorage.getItem(a)?.length || 0) - (localStorage.getItem(b)?.length || 0));
            for (let i = 0; i < Math.min(5, keys.length); i++) localStorage.removeItem(keys[i]);
            try {
                localStorage.setItem(key, JSON.stringify(markers));
            } catch (e2) {
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

    const side = order.S;
    const timeMs = order.T;
    const timeframeMs = getTimeframeMs(currentTimeframe);
    const candleOpenTimeMs = Math.floor(timeMs / timeframeMs) * timeframeMs;
    const timeSec = Math.floor(candleOpenTimeMs / 1000);

    const marker = {
        time: timeSec,
        position: side === 'SELL' ? 'belowBar' : 'aboveBar',
        color: side === 'SELL' ? '#f6465d' : '#0ecb81',
        shape: 'circle',
        text: `${(volumeUSD / 1000).toFixed(0)}K`,
        size: 1,
    };

    recentLiquidations.unshift({ symbol, side, volume: volumeUSD, price, time: timeMs });
    if (recentLiquidations.length > MAX_RECENT) recentLiquidations.pop();
    updateLiquidationFeed(recentLiquidations, selectCoin);

    if (!allLiquidations.has(symbol)) allLiquidations.set(symbol, loadSavedMarkers(symbol));
    const symbolMarkers = allLiquidations.get(symbol);

    const exists = symbolMarkers.some(m => m.time === marker.time && m.text === marker.text);
    if (!exists) {
        symbolMarkers.push(marker);
        if (symbolMarkers.length > MAX_MARKERS_PER_SYMBOL) symbolMarkers.shift();
        saveMarkers(symbol, symbolMarkers);
    }

    if (symbol === currentSymbol) {
        liquidationMarkers = symbolMarkers;
        updateMarkersOnChart();
        liquidationCount = liquidationMarkers.length;
        updateStatusWithCount();
    }
}

function updateMarkersOnChart() {
    if (!candleSeries) return;
    candleSeries.setMarkers(liquidationMarkers);
}

function updateStatusWithCount() {
    const el = document.getElementById('connStatus');
    if (el) el.textContent = `Connected (${liquidationCount} liq)`;
}

async function loadChartData(symbol) {
    try {
        const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${currentTimeframe}&limit=1400`);
        const klines = await res.json();

        currentCandles = klines.map(k => ({
            time: k[0] / 1000,
            open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
        }));

        oldestTime = klines.length > 0 ? klines[0][0] : null;

        candleSeries.setData(currentCandles);
        updateEmaLines(currentCandles);
        chart.timeScale().fitContent();
        candleSeries.priceScale().applyOptions({ autoScale: true });

        if (!allLiquidations.has(symbol)) allLiquidations.set(symbol, loadSavedMarkers(symbol));
        liquidationMarkers = allLiquidations.get(symbol) || [];
        updateMarkersOnChart();
        liquidationCount = liquidationMarkers.length;
        updateStatusWithCount();

        if (wsReady) subscribeToKlineStream(symbol);
        updateHeader(coins.get(symbol), symbol, currentTimeframe);
    } catch (e) {
        console.error('Ошибка загрузки графика:', e);
    }
}

function updateEmaLines(candles) {
    if (candles.length === 0) return;
    ema65Series.setData(calculateEMA(candles, 65));
    ema125Series.setData(calculateEMA(candles, 125));
    ema450Series.setData(calculateEMA(candles, 450));
}

async function loadMoreHistory() {
    if (isLoadingMore || !oldestTime) return;
    isLoadingMore = true;
    const btn = document.getElementById('loadMoreBtn');
    btn.textContent = '⏳';
    btn.disabled = true;
    try {
        const endTime = oldestTime - 1;
        const res = await fetch(`${BINANCE_API}/fapi/v1/klines?symbol=${currentSymbol}&interval=${currentTimeframe}&limit=1000&endTime=${endTime}`);
        const klines = await res.json();
        if (klines.length === 0) return;

        const newCandles = klines.map(k => ({
            time: k[0] / 1000,
            open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
        }));

        oldestTime = klines[0][0];
        currentCandles = [...newCandles, ...currentCandles];
        candleSeries.setData(currentCandles);
        updateEmaLines(currentCandles);
        updateMarkersOnChart();
    } catch (e) {
        console.error('Ошибка подгрузки истории:', e);
    } finally {
        btn.textContent = '📜';
        btn.disabled = false;
        isLoadingMore = false;
    }
}

function connectWebSocket() {
    ws = new WebSocket(BINANCE_WS_MARKET);
    ws.onopen = () => {
        wsReady = true;
        updateConnectionStatus(true, liquidationCount);
        updateSubscriptions();
        if (currentSymbol) subscribeToKlineStream(currentSymbol);
    };
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id) return;
        if (msg.e === '24hrTicker') updateTicker(msg);
        else if (msg.e === 'kline') updateChartWithKline(msg);
    };
    ws.onclose = () => {
        wsReady = false;
        updateConnectionStatus(false, liquidationCount);
        lastSubscriptionSet.clear();
        currentKlineSymbol = null;
        setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = (e) => console.error('WS error:', e);
}

function updateSubscriptions() {
    if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
    const target = new Set(filteredCoins.slice(0, 50).map(c => c.symbol.toLowerCase()));
    const toUnsub = [];
    const toSub = [];

    lastSubscriptionSet.forEach(sym => { if (!target.has(sym)) toUnsub.push(`${sym}@ticker`); });
    target.forEach(sym => { if (!lastSubscriptionSet.has(sym)) toSub.push(`${sym}@ticker`); });

    if (toUnsub.length) ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: toUnsub, id: Date.now() }));
    if (toSub.length) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: toSub, id: Date.now() + 1 }));
    lastSubscriptionSet = target;
}

function subscribeToKlineStream(symbol) {
    if (!wsReady || ws.readyState !== WebSocket.OPEN) return;
    if (currentKlineSymbol && currentKlineSymbol !== symbol) {
        ws.send(JSON.stringify({
            method: 'UNSUBSCRIBE',
            params: [`${currentKlineSymbol.toLowerCase()}@kline_${currentTimeframe}`],
            id: Date.now(),
        }));
    }
    ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: [`${symbol.toLowerCase()}@kline_${currentTimeframe}`],
        id: Date.now() + 1,
    }));
    currentKlineSymbol = symbol;
}

function updateTicker(data) {
    const symbol = data.s.toUpperCase();
    const coin = coins.get(symbol);
    if (!coin) return;

    coin.price = parseFloat(data.c);
    coin.change = parseFloat(data.P);

    if (symbol === currentSymbol) updateHeader(coin, symbol, currentTimeframe);

    const idx = filteredCoins.findIndex(c => c.symbol === symbol);
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

    const lastCandle = currentCandles.length > 0 ? currentCandles[currentCandles.length - 1] : null;

    if (!lastCandle) {
        currentCandles = [newCandle];
        candleSeries.setData(currentCandles);
    } else if (candleTime === lastCandle.time) {
        if (newCandle.high > lastCandle.high * 1.5 || newCandle.low < lastCandle.low * 0.5) return;
        Object.assign(lastCandle, newCandle);
        candleSeries.update(newCandle);
    } else if (candleTime > lastCandle.time) {
        currentCandles.push(newCandle);
        if (currentCandles.length > 1000) currentCandles.shift();
        candleSeries.update(newCandle);
    }

    updateEmaLines(currentCandles);
}

async function refresh30mChanges() {
    const headerSpan = document.querySelector('#listHeader span[data-sort="change30m"]');
    const originalText = headerSpan.textContent;
    headerSpan.textContent = '⏳ 30м';

    const promises = filteredCoins.map(async (coin) => {
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
        } catch (e) {
            return coin;
        }
        return coin;
    });

    await Promise.all(promises);
    headerSpan.textContent = originalText;
}

function setupEvents() {
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', () => setTimeframe(btn.dataset.tf));
    });

    document.querySelectorAll('#listHeader span').forEach(span => {
        span.addEventListener('click', async () => {
            const field = span.dataset.sort;
            if (field === 'change30m') await refresh30mChanges();
            sortBy(field);
        });
    });

    document.getElementById('loadMoreBtn').addEventListener('click', loadMoreHistory);
}

function sortBy(field) {
    if (sortField === field) sortDesc = !sortDesc;
    else {
        sortField = field;
        sortDesc = true;
    }
    sortCoins();
    renderCoinsList(filteredCoins, currentSymbol, selectCoin);
}

function sortCoins() {
    filteredCoins.sort((a, b) => {
        let va = a[sortField];
        let vb = b[sortField];
        if (typeof va === 'string') {
            va = va.toLowerCase();
            vb = vb.toLowerCase();
        }
        if (va < vb) return sortDesc ? 1 : -1;
        if (va > vb) return sortDesc ? -1 : 1;
        return 0;
    });
}

function selectCoin(symbol) {
    currentSymbol = symbol;
    document.getElementById('currentSymbol').textContent = symbol + ' (' + currentTimeframe + ')';

    document.querySelectorAll('.coin-item').forEach(el => {
        el.classList.toggle('active', el.dataset.symbol === symbol);
    });

    loadChartData(symbol);
    updateHeader(coins.get(symbol), symbol, currentTimeframe);
}

function setTimeframe(tf) {
    currentTimeframe = tf;
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tf === tf);
    });
    document.getElementById('currentSymbol').textContent = currentSymbol + ' (' + tf + ')';
    loadChartData(currentSymbol);
}

window.selectCoin = selectCoin;

init();
