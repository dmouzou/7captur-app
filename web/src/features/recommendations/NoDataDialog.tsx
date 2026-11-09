/** Shown when a recommendation is requested with no records in the last 28 days. There is no "generate anyway". */
export function NoDataDialog({ onNavigate, onClose }: { onNavigate?: (route: string) => void; onClose: () => void }) {
  const go = (route: string) => { onClose(); onNavigate?.(route); };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="nodata-title"
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ maxWidth: 480, width: "100%", padding: "28px 24px", border: "1px solid var(--line-strong)", borderRadius: 16, background: "var(--surface)" }}>
        <h3 id="nodata-title" style={{ margin: "0 0 8px", fontSize: "1.2rem", color: "var(--ink)" }}>Add your data first</h3>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          There are no posts, promotions, enquiries or sales in the last 28 days, so there is nothing to base a recommendation on. Nothing was generated and no credit was used. Pick one way to add data:
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" className="btn-primary" onClick={() => go("/add/import")} style={{ padding: "10px 16px", borderRadius: 8 }}>Import a file (CSV or Excel)</button>
          <button type="button" className="btn-secondary" onClick={() => go("/add/connect")} style={{ padding: "10px 16px", borderRadius: 8 }}>Connect a source</button>
          <button type="button" className="btn-secondary" onClick={() => go("/add/manual")} style={{ padding: "10px 16px", borderRadius: 8 }}>Enter records manually</button>
        </div>
        <div style={{ marginTop: 14, textAlign: "right" }}>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ padding: "8px 14px", fontSize: 13, borderRadius: 8 }}>Close</button>
        </div>
      </div>
    </div>
  );
}
