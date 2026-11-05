'use client';

import { useEffect, useRef } from 'react';

export function useDashboardLayout(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    let frame = 0;
    const height = (element: Element) => element.getBoundingClientRect().height;
    const naturalPanel = (panel: Element) => {
      let total = 2;
      for (const child of Array.from(panel.children)) {
        const table = child.classList.contains('fc-table-wrap') ? child.querySelector('table') : null;
        total += table ? Math.min(height(table), panel.classList.contains('fc-dash-stocks') ? 330 : Infinity) : height(child);
      }
      if (panel.classList.contains('fc-dash-watchlist')) {
        const head = panel.querySelector('.fc-panel-head');
        const body = panel.querySelector('.fc-watchlist-scroll');
        const table = body?.querySelector('table');
        total = 2 + (head ? height(head) : 0) + (table ? height(table) : body?.scrollHeight || 0);
        total = Math.min(220, total);
      }
      return total;
    };
    const panels = (column: Element) => Array.from(column.children).filter(child => child.classList.contains('fc-panel'));
    const stack = (column: Element) => {
      const children = panels(column);
      return children.reduce((sum, panel) => sum + naturalPanel(panel), 0) + Math.max(0, children.length - 1) * 4;
    };
    const measure = () => {
      frame = 0;
      if (window.matchMedia('(max-width: 760px)').matches) {
        root.style.removeProperty('--fc-dashboard-height');
        return;
      }
      const market = root.querySelector('.fc-dashboard-market-column');
      const focus = root.querySelector('.fc-dashboard-focus-column');
      const references = Array.from(root.querySelectorAll('.fc-dashboard-reference-column'));
      if (!market || !focus || references.length !== 2) return;
      const chart = focus.querySelector('.fc-dash-chart');
      const minimum = Math.max(720, (chart ? naturalPanel(chart) : 0) + 270, ...references.map(column => {
        const children = panels(column);
        return children.slice(0, -1).reduce((sum, panel) => sum + naturalPanel(panel) + 4, 0) + 80;
      }));
      const target = Math.ceil(Math.max(minimum, Math.min(stack(market), ...references.map(stack))));
      const value = `${target}px`;
      if (root.style.getPropertyValue('--fc-dashboard-height') !== value) root.style.setProperty('--fc-dashboard-height', value);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    const observed = new WeakSet<Element>();
    const observeContent = () => {
      for (const element of [root, ...Array.from(root.querySelectorAll('.fc-panel-head, table, .fc-economic-list, .fc-detail, .fc-brief-body, .fc-empty'))]) {
        if (!observed.has(element)) { observer.observe(element); observed.add(element); }
      }
      schedule();
    };
    const mutations = new MutationObserver(observeContent);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    observeContent();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [enabled]);
  return ref;
}
