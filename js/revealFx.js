export function makeRevealController(component, opts = {}) {
  const seen = new Set();
  const observer = new IntersectionObserver((entries) => {
    let changed = false;
    entries.forEach((entry) => {
      const key = entry.target.getAttribute('data-reveal-key');
      if (entry.isIntersecting && key && !seen.has(key)) {
        seen.add(key);
        changed = true;
        observer.unobserve(entry.target);
        if (opts.onReveal) opts.onReveal(key);
      }
    });
    if (changed) component.forceUpdate();
  }, { threshold: opts.threshold ?? 0.15, rootMargin: opts.rootMargin ?? '0px 0px -80px 0px' });

  function ref(key) {
    return (el) => {
      if (el && !seen.has(key)) {
        el.setAttribute('data-reveal-key', key);
        observer.observe(el);
      }
    };
  }
  return { ref, visible: (key) => seen.has(key), destroy: () => observer.disconnect() };
}

export function animateValue(component, stateKey, to, duration = 1300) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    component.setState({ [stateKey]: to * eased });
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function makeScrollTracker(onUpdate) {
  let ticking = false;
  const handler = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const max = (doc.scrollHeight - doc.clientHeight) || 1;
      onUpdate(scrollTop, Math.min(1, Math.max(0, scrollTop / max)));
      ticking = false;
    });
  };
  window.addEventListener('scroll', handler, { passive: true });
  handler();
  return () => window.removeEventListener('scroll', handler);
}
