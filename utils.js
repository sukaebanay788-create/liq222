export function getTimeframeMs(tf) {
  const unit = tf.slice(-1);
  const value = parseInt(tf, 10);
  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

export function calculateEMA(data, period) {
  if (data.length < period) return [];
  const ema = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;

  for (let i = 0; i < period; i++) sum += data[i].close;

  let prevEma = sum / period;
  ema.push({ time: data[period - 1].time, value: prevEma });

  for (let i = period; i < data.length; i++) {
    prevEma = (data[i].close - prevEma) * multiplier + prevEma;
    ema.push({ time: data[i].time, value: prevEma });
  }

  return ema;
}

export function formatPrice(price) {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}
