// Adjust only recognizable invoice layouts in the rendered DOM, never stored HTML.
(() => {
  function fitInvoices() {
    // Restore the approved tax template's original header QR, including stored copies.
    const headers = document.querySelectorAll('.header-wrap:has(> .center-header)');
    const misplacedQR = document.querySelectorAll('.bottom-content-wrap > .qr-frame');
    if (headers.length && misplacedQR.length === 1 && Array.from(headers).every(header => !header.querySelector('.qr-frame'))) {
      for (const header of headers) header.appendChild(misplacedQR[0].cloneNode(true));
      misplacedQR[0].remove();
    }
    const tables = Array.from(document.querySelectorAll('table')).filter(table => {
      if (table.closest('.totals,.totals-table,.totals-box-table')) return false;
      if (table.matches('.items-main-table,.items-table') || table.parentElement.matches('.items-table-wrapper,.items-table-container')) return true;
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
      return headers.length >= 4 && headers.some(h => /الكمية|quantity|qty/.test(h)) && headers.some(h => /السعر|price/.test(h));
    });
    for (const table of tables) {
      for (const oldFiller of table.querySelectorAll('tr[data-invoice-filler]')) oldFiller.remove();
      const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
      if (!rows.length || rows.length > 15) continue;
      const page = table.closest('[data-invoice-page],.invoice-container,.invoice-frame,.sheet');
      if (!page || tables.filter(t => page.contains(t)).length !== 1) continue;
      const candidates = Array.from(page.querySelectorAll('.bottom-content-wrap,.bottom-wrap,.bottom-grid,.bottom-summary-grid,.bottom-layout,.bottom-layout-table,.summary-section,.summary,.totals-table,.totals-box-table,.invoice-page-label'));
      const bottom = candidates.find(el => !el.contains(table) && !table.contains(el) && (table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      // Unknown structures are intentionally left untouched.
      if (!bottom) continue;
      let layout = table.parentElement;
      while (layout && layout !== page && !layout.contains(bottom)) layout = layout.parentElement;
      if (!layout || !layout.contains(bottom)) continue;
      const set = (el, key, value) => el.style.setProperty(key, value, 'important');
      for (const row of rows) {
        set(row, 'height', 'auto');
        for (const cell of row.cells) {
          set(cell, 'vertical-align', 'top');
          set(cell, 'height', 'auto');
        }
      }
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
        if (branch !== table) set(branch, 'margin-bottom', '0');
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
      set(table, 'margin-bottom', '0');
      if (table.tHead) set(table.tHead, 'height', 'auto');
      const tableRect = table.getBoundingClientRect();
      const bottomRect = bottomBranch.getBoundingClientRect();
      const gap = Math.floor(bottomRect.top - tableRect.bottom);
      if (gap > 1) {
        const lastRow = rows[rows.length - 1];
        const tbody = lastRow.parentElement;
        const colCount = lastRow.cells.length || (table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells.length : 1);
        const filler = document.createElement('tr');
        filler.setAttribute('data-invoice-filler', '1');
        set(filler, 'height', gap + 'px');
        set(filler, 'background', 'transparent');
        for (let i = 0; i < colCount; i++) {
          const td = document.createElement('td');
          const refCell = lastRow.cells[i];
          if (refCell) {
            const cs = getComputedStyle(refCell);
            if (cs.borderLeftWidth !== '0px' && cs.borderLeftStyle !== 'none') {
              set(td, 'border-left', `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`);
            }
            if (cs.borderRightWidth !== '0px' && cs.borderRightStyle !== 'none') {
              set(td, 'border-right', `${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`);
            }
          }
          set(td, 'border-top', 'none');
          set(td, 'padding-top', '0');
          set(td, 'padding-bottom', '0');
          set(td, 'height', gap + 'px');
          set(td, 'background', 'transparent');
          filler.appendChild(td);
        }
        tbody.appendChild(filler);
      }
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
