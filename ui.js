import { formatPrice } from './utils.js';

export function updateHeader(state) {
  const coin = state.coins.get(state.currentSymbol);
  if (!coin) return;

  document.getElementById('currentSymbol').textContent = `${state.currentSymbol} (${state.currentTimeframe})`;
  document.getElementById('currentPrice').textContent = formatPrice(coin.price);

  const ch = document.getElementById('currentChange');
  const change = coin.change;
  ch.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  ch.className = `symbol-change ${change >= 0 ? 'positive' : 'negative'}`;
}

export function sortCoins(state) {
  state.filteredCoins.sort((a, b) => {
    let va = a[state.sortField];
    let vb = b[state.sortField];

    if (typeof va === 'string') {
      va = va.toLowerCase();
      vb = vb.toLowerCase();
    }

    if (va < vb) return state.sortDesc ? 1 : -1;
    if (va > vb) return state.sortDesc ? -1 : 1;
    return 0;
  });
}

function createCoinRow(coin, state, onSelectCoin) {
  const div = document.createElement('div');
  div.className = `coin-item${coin.symbol === state.currentSymbol ? ' active' : ''}`;
  div.dataset.symbol = coin.symbol;
  div.onclick = () => onSelectCoin(coin.symbol);

  const c24 = coin.change >= 0 ? 'positive' : 'negative';
  const c30 = coin.change30m >= 0 ? 'positive' : 'negative';

  div.innerHTML = `
    <span class="coin-symbol">${coin.symbol.replace('USDT', '')}</span>
    <span class="coin-price">${formatPrice(coin.price)}</span>
    <span class="coin-change ${c24}">${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%</span>
    <span class="coin-change ${c30}">${coin.change30m >= 0 ? '+' : ''}${coin.change30m.toFixed(2)}%</span>
  `;

  return div;
}

export function renderCoinsList(state, onSelectCoin) {
  const container = document.getElementById('coinsList');
  container.innerHTML = '';
  state.filteredCoins.forEach((coin) => container.appendChild(createCoinRow(coin, state, onSelectCoin)));
}

export function updateCoinRow(coin) {
  const row = document.querySelector(`.coin-item[data-symbol="${coin.symbol}"]`);
  if (!row) return;

  row.children[1].textContent = formatPrice(coin.price);
  row.children[2].textContent = `${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%`;
  row.children[2].className = `coin-change ${coin.change >= 0 ? 'positive' : 'negative'}`;
}

export function updateCoinsCount(state) {
  document.getElementById('coinsCount').textContent = state.filteredCoins.length;
}

export function updateConnectionStatus(state, ok) {
  const el = document.getElementById('connStatus');
  el.textContent = ok ? `Connected (${state.liquidationCount} liq)` : 'Disconnected';
  el.className = `connection-status ${ok ? 'status-connected' : 'status-disconnected'}`;
}

export function updateStatusWithCount(state) {
  const el = document.getElementById('connStatus');
  if (el) el.textContent = `Connected (${state.liquidationCount} liq)`;
}

export function updateLiquidationFeed(state, onSelectCoin) {
  const feedEl = document.getElementById('liquidationFeed');
  if (!feedEl) return;

  if (state.recentLiquidations.length === 0) {
    feedEl.innerHTML = '<div style="color:#848e9c;text-align:center;">Ожидание ликвидаций...</div>';
    return;
  }

  feedEl.innerHTML = state.recentLiquidations.map((liq, idx) => {
    const sideClass = liq.side === 'SELL' ? 'liq-side-sell' : 'liq-side-buy';
    const sideText = liq.side === 'SELL' ? 'LONG LIQ' : 'SHORT LIQ';
    return `
      <div class="liquidation-feed-item" data-liq-index="${idx}" title="Открыть график ${liq.symbol.replace('USDT', '')}">
        <span class="liq-symbol">${liq.symbol.replace('USDT', '')}</span>
        <span class="${sideClass}">${sideText}</span>
        <span class="liq-volume">${(liq.volume / 1000).toFixed(0)}K</span>
        <span>${liq.price.toFixed(2)}</span>
      </div>
    `;
  }).join('');

  feedEl.querySelectorAll('.liquidation-feed-item').forEach((el) => {
    el.addEventListener('click', () => {
      const item = state.recentLiquidations[Number(el.dataset.liqIndex)];
      if (item) onSelectCoin(item.symbol);
    });
  });
}
