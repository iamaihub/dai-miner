/**
 * "Buy DAI" widget — price + buy link from the SICI/COMPEX Sepolia testnet
 * DAI/USDT pool. DAI has no mainnet pool yet (nothing here invents an
 * address), so this reads the same cluster.json the sici apps publish and
 * mirrors their own BuyDai screen's logic (apps/landing/src/screens/BuyDai.tsx
 * in /home/bo/Desktop/COMPEX), including that screen's read of
 * `twap.daiPerUsdt` as USDT-per-DAI, not DAI-per-USDT despite the field name.
 * Any element with [data-buy-dai] becomes one instance; it needs
 * [data-buy-dai-price], [data-buy-dai-sub] and [data-buy-dai-cta] children.
 */
(() => {
  const CLUSTER_URL = '/sici/web/cluster.json';

  const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

  const buildBuyHref = (dai, usdt) => {
    const params = new URLSearchParams({ chain: 'sepolia', inputCurrency: usdt, outputCurrency: dai });
    return `https://app.uniswap.org/swap?${params.toString()}`;
  };

  const paint = (el, state) => {
    el.querySelectorAll('[data-buy-dai-price]').forEach((n) => {
      n.textContent = state.kind === 'ready' ? `$${state.usdtPerDai}` : (state.kind === 'loading' ? '…' : '—');
    });
    el.querySelectorAll('[data-buy-dai-sub]').forEach((n) => {
      n.textContent = state.kind === 'ready'
        ? `1 DAI ≈ ${state.usdtPerDai} USDT · Sepolia testnet`
        : (state.kind === 'loading' ? 'Reading the testnet pool…' : 'The testnet pool is not reachable right now.');
    });
    el.querySelectorAll('[data-buy-dai-cta]').forEach((cta) => {
      if (state.kind === 'ready') {
        cta.href = state.buyHref;
        cta.classList.remove('opacity-50', 'pointer-events-none');
      } else {
        cta.removeAttribute('href');
        cta.classList.add('opacity-50', 'pointer-events-none');
      }
    });
  };

  const init = () => {
    const sections = document.querySelectorAll('[data-buy-dai]');
    if (!sections.length) return;
    sections.forEach((el) => paint(el, { kind: 'loading' }));

    fetch(CLUSTER_URL)
      .then((res) => { if (!res.ok) throw new Error('cluster.json not ok'); return res.json(); })
      .then((cluster) => {
        const dai = cluster.dai;
        const usdt = cluster.usdt;
        // cluster.json's `twap.daiPerUsdt` field name is misleading: its value is
        // actually USDT per whole DAI (see BuyDai.tsx in COMPEX for the two-way
        // confirmation against pool reserves and the price oracle).
        const usdtPerDai = Number(cluster.twap && cluster.twap.daiPerUsdt);
        if (!isAddress(dai) || !isAddress(usdt) || !Number.isFinite(usdtPerDai) || usdtPerDai <= 0) {
          throw new Error('cluster.json missing testnet pool data');
        }
        const state = {
          kind: 'ready',
          usdtPerDai: usdtPerDai.toFixed(2),
          buyHref: buildBuyHref(dai, usdt),
        };
        sections.forEach((el) => paint(el, state));
      })
      .catch(() => {
        sections.forEach((el) => paint(el, { kind: 'unavailable' }));
      });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
