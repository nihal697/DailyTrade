export interface CurrencyFormat {
  prefix: string;
  suffix: string;
  decimals: number;
}

/** True when an asset's native quotes are in rupees (engine converts to USD). */
export function isINRAsset(symbol: string): boolean {
  return symbol.endsWith('.NS')
      || symbol.startsWith('^NSE')
      || symbol.startsWith('^BSE')
      || symbol === 'OPT'
      || /\b(CE|PE)\b/.test(symbol);
}

export function getAssetCurrencyFormat(symbol: string): CurrencyFormat {
  if (isINRAsset(symbol)) {
    return { prefix: '₹', suffix: '', decimals: 2 }; // NSE/BSE equities, indices, options
  }
  if (symbol.includes('^TNX') || symbol.includes('^TYX') || symbol.includes('^IRX')) {
    return { prefix: '', suffix: '%', decimals: 2 };
  }
  if (symbol.includes('DX-Y')) {
    return { prefix: '', suffix: '', decimals: 2 };
  }
  if (symbol.endsWith('=X')) {
    if (symbol.startsWith('USDINR')) return { prefix: '₹', suffix: '', decimals: 2 };
    return { prefix: '', suffix: '', decimals: 4 }; // e.g. 1.1364 for EUR/USD
  }
  return { prefix: '$', suffix: '', decimals: 2 };
}

export function formatAssetPrice(price: number, symbol: string): string {
  if (price == null || isNaN(price)) return '—';
  const { prefix, suffix, decimals } = getAssetCurrencyFormat(symbol);

  let formattedNum: string;
  if (price < 0.001) {
    formattedNum = price.toFixed(6);
  } else if (price < 1) {
    formattedNum = price.toFixed(decimals >= 4 ? decimals : 4);
  } else if (price < 100) {
    formattedNum = price.toFixed(decimals);
  } else {
    formattedNum = price.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return `${prefix}${formattedNum}${suffix}`;
}
