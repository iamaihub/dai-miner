/**
 * "Buy DAI" widget — price readout from the SICI/COMPEX Sepolia testnet
 * DAI/USDT pool. DAI has no mainnet pool yet (nothing here invents an
 * address), so this reads the same cluster.json the sici apps publish and
 * mirrors their own BuyDai screen's logic (apps/landing/src/screens/BuyDai.tsx
 * in /home/bo/Desktop/COMPEX), including that screen's read of
 * `twap.daiPerUsdt` as USDT-per-DAI, not DAI-per-USDT despite the field name.
 * The CTA no longer links out to Uniswap — there's no mainnet pool to send
 * anyone to — it opens a popup pointing at the SICI testnet app instead.
 * Any element with [data-buy-dai] becomes one instance; it needs
 * [data-buy-dai-price], [data-buy-dai-sub] and [data-buy-dai-cta] children.
 */
(() => {
  const CLUSTER_URL = '/sici/web/cluster.json';
  const SICI_WEB_URL = 'https://iamai.kg/sici/web';

  const paint = (el, state) => {
    el.querySelectorAll('[data-buy-dai-price]').forEach((n) => {
      n.textContent = state.kind === 'ready' ? `$${state.usdtPerDai}` : (state.kind === 'loading' ? '…' : '—');
    });
    el.querySelectorAll('[data-buy-dai-sub]').forEach((n) => {
      n.textContent = state.kind === 'ready'
        ? `1 DAI ≈ ${state.usdtPerDai} USDT · Sepolia testnet`
        : (state.kind === 'loading' ? 'Reading the testnet pool…' : 'The testnet pool is not reachable right now.');
    });
  };

  let modalEl = null;

  const closeModal = () => { if (modalEl) modalEl.classList.add('hidden'); };

  const openModal = () => {
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'fixed inset-0 z-[999] flex items-center justify-center p-4';
      modalEl.innerHTML = `
        <div data-buy-dai-modal-backdrop class="absolute inset-0 bg-black/60"></div>
        <div class="relative bg-white rounded-[6px] max-w-sm w-full p-8 sm:p-10 text-center shadow-2xl">
          <button type="button" data-buy-dai-modal-close aria-label="Close"
             class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-[#525252] hover:text-black text-[22px] leading-none">&times;</button>
          <div class="uppercase tracking-[3px] text-xs text-[#16a34a] mb-4">Currently on Sepolia Testnet</div>
          <p class="text-[22px] sm:text-[26px] leading-tight mb-8">Try it for free.</p>
          <a href="${SICI_WEB_URL}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center justify-center px-8 py-3 bg-[#16a34a] text-white text-[18px] sm:text-[22px] rounded-[4px] hover:bg-black transition">
            Try now!
          </a>
        </div>`;
      document.body.appendChild(modalEl);
      modalEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-buy-dai-modal-close]') || e.target.hasAttribute('data-buy-dai-modal-backdrop')) {
          closeModal();
        }
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    }
    modalEl.classList.remove('hidden');
  };

  const init = () => {
    const sections = document.querySelectorAll('[data-buy-dai]');
    if (!sections.length) return;
    sections.forEach((el) => paint(el, { kind: 'loading' }));
    sections.forEach((el) => {
      el.querySelectorAll('[data-buy-dai-cta]').forEach((cta) => {
        cta.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
      });
    });

    fetch(CLUSTER_URL)
      .then((res) => { if (!res.ok) throw new Error('cluster.json not ok'); return res.json(); })
      .then((cluster) => {
        // cluster.json's `twap.daiPerUsdt` field name is misleading: its value is
        // actually USDT per whole DAI (see BuyDai.tsx in COMPEX for the two-way
        // confirmation against pool reserves and the price oracle).
        const usdtPerDai = Number(cluster.twap && cluster.twap.daiPerUsdt);
        if (!Number.isFinite(usdtPerDai) || usdtPerDai <= 0) {
          throw new Error('cluster.json missing testnet pool data');
        }
        sections.forEach((el) => paint(el, { kind: 'ready', usdtPerDai: usdtPerDai.toFixed(2) }));
      })
      .catch(() => {
        sections.forEach((el) => paint(el, { kind: 'unavailable' }));
      });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
