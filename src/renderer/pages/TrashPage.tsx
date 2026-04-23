export default function TrashPage() {
  return (
    <div className="page" style={{ padding: 20 }}>
      <div className="section-header">
        <h2>Trash</h2>
      </div>
      <div className="empty-state">
        <p style={{ fontSize: 32, marginBottom: 12 }}>🗑️</p>
        <p>Trash is empty</p>
        <p style={{ fontSize: 12, color: '#a0aec0', marginTop: 8 }}>
          Deleted profiles will appear here for recovery.
        </p>
      </div>
    </div>
  );
}
