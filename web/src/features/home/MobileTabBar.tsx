import type { ReactNode } from "react";

export interface TabBarItem { id: string; label: string; icon: ReactNode; badge?: number | string }

/**
 * Bottom tab bar for phones. Four main screens plus "More", which opens the full menu.
 * Hidden on wider screens by CSS. 44px+ touch targets, safe-area aware.
 */
export function MobileTabBar({ items, active, moreActive, onSelect, onMore }: {
  items: TabBarItem[]; active: string; moreActive: boolean; onSelect: (id: string) => void; onMore: () => void;
}) {
  const inMain = items.some((i) => i.id === active);
  return (
    <nav className="mobile-tabbar" aria-label="Main">
      {items.map((i) => (
        <button key={i.id} type="button" className="mobile-tab" aria-current={active === i.id && !moreActive ? "page" : undefined} onClick={() => onSelect(i.id)}>
          <span className="mobile-tab-icon" aria-hidden="true">
            {i.icon}
            {i.badge ? <span className="mobile-tab-badge">{i.badge}</span> : null}
          </span>
          <span className="mobile-tab-label">{i.label}</span>
        </button>
      ))}
      <button type="button" className="mobile-tab" aria-expanded={moreActive} aria-current={!inMain && !moreActive ? "page" : undefined} onClick={onMore}>
        <span className="mobile-tab-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" />
          </svg>
        </span>
        <span className="mobile-tab-label">More</span>
      </button>
    </nav>
  );
}
