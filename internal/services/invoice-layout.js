// Adjust only recognizable invoice layouts in the rendered DOM, never stored HTML.
(() => {
  function fitInvoices() {
    const tables = Array.from(document.querySelectorAll('table')).filter(table => {
      if (table.closest('.totals,.totals-table,.totals-box-table')) return false;
      if (table.matches('.items-main-table,.items-table') || table.parentElement.matches('.items-table-wrapper,.items-table-container')) return true;
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
      return headers.length >= 4 && headers.some(h => /الكمية|quantity|qty/.test(h)) && headers.some(h => /السعر|price/.test(h));
    });
    for (const table of tables) {
      const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
      if (!rows.length || rows.length > 15) continue;
      const page = table.closest('[data-invoice-page],.invoice-container,.invoice-frame');
      if (!page || tables.filter(t => page.contains(t)).length !== 1) continue;
      const candidates = Array.from(page.querySelectorAll('.bottom-content-wrap,.bottom-wrap,.bottom-grid,.bottom-summary-grid,.bottom-layout,.bottom-layout-table,.summary-section,.summary,.totals-table,.totals-box-table'));
      const bottom = candidates.find(el => !el.contains(table) && !table.contains(el) && (table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      // Unknown structures are intentionally left untouched.
      if (!bottom) continue;
      let layout = table.parentElement;
      while (layout && layout !== page && !layout.contains(bottom)) layout = layout.parentElement;
      if (!layout || !layout.contains(bottom)) continue;
      const set = (el, key, value) => el.style.setProperty(key, value, 'important');
      set(page, 'display', 'flex');
      set(page, 'flex-direction', 'column');
      set(page, 'justify-content', 'flex-start');
      set(page, 'flex', '0 0 auto');
      set(page, 'box-sizing', 'border-box');
      set(page, 'width', '210mm');
      set(page, 'min-height', '297mm');
      set(page, 'height', '297mm');
      set(page, 'max-height', '297mm');
      let branch = table;
      while (branch !== page) {
        const parent = branch.parentElement;
        if (!parent || /^(TABLE|TBODY|TR|TD|TH)$/.test(parent.tagName)) break;
        set(parent, 'display', 'flex');
        set(parent, 'flex-direction', 'column');
        set(parent, 'min-height', '0');
        set(branch, 'flex', '1 1 auto');
        for (const sibling of parent.children) {
          if (sibling !== branch) set(sibling, 'flex-shrink', '0');
        }
        branch = parent;
      }
      let bottomBranch = bottom;
      while (bottomBranch.parentElement !== layout) bottomBranch = bottomBranch.parentElement;
      set(bottomBranch, 'margin-top', 'auto');
      set(bottomBranch, 'flex-shrink', '0');
      set(table, 'height', 'auto');
      set(table, 'flex', '0 0 auto');
      const tableRect = table.getBoundingClientRect();
      const bottomRect = bottomBranch.getBoundingClientRect();
      const gap = bottomRect.top - tableRect.bottom;
      if (rows.length < 15 && gap > 1) set(table, 'height', (tableRect.height + gap) + 'px');
      if (table.tHead) set(table.tHead, 'height', '1px');
      page.dataset.invoiceLayout = 'fitted';
    }
  }
  const run = () => {
    fitInvoices();
    if (document.fonts) document.fonts.ready.then(fitInvoices);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  window.addEventListener('beforeprint', fitInvoices);
})();
