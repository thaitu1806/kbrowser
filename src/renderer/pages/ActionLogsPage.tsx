import { useState } from 'react';
import type { ActionLogEntry, LogFilter } from '@shared/types';

const DEMO_LOGS: ActionLogEntry[] = [
  {
    id: 'log-1',
    userId: 'u-1',
    username: 'admin',
    action: 'profile.create',
    profileId: 'p-1',
    details: { name: 'Facebook Account 1', browserType: 'chromium' },
    timestamp: '2024-01-15T10:00:00Z',
  },
  {
    id: 'log-2',
    userId: 'u-1',
    username: 'admin',
    action: 'profile.open',
    profileId: 'p-1',
    details: {},
    timestamp: '2024-01-15T10:30:00Z',
  },
  {
    id: 'log-3',
    userId: 'u-2',
    username: 'manager1',
    action: 'profile.edit',
    profileId: 'p-2',
    details: { field: 'name', oldValue: 'Old Name', newValue: 'Amazon Seller' },
    timestamp: '2024-01-16T08:00:00Z',
  },
  {
    id: 'log-4',
    userId: 'u-3',
    username: 'user1',
    action: 'profile.close',
    profileId: 'p-1',
    details: {},
    timestamp: '2024-01-16T09:00:00Z',
  },
  {
    id: 'log-5',
    userId: 'u-1',
    username: 'admin',
    action: 'user.create',
    details: { newUsername: 'user2', role: 'user' },
    timestamp: '2024-01-16T11:00:00Z',
  },
];

const ACTION_OPTIONS = ['', 'profile.create', 'profile.open', 'profile.close', 'profile.edit', 'profile.delete', 'user.create', 'user.updateRole'];

export default function ActionLogsPage() {
  const [logs] = useState<ActionLogEntry[]>(DEMO_LOGS);
  const [filter, setFilter] = useState<LogFilter>({});

  const filteredLogs = logs.filter((log) => {
    if (filter.userId && log.userId !== filter.userId) return false;
    if (filter.action && log.action !== filter.action) return false;
    if (filter.startDate && log.timestamp < filter.startDate) return false;
    if (filter.endDate && log.timestamp > filter.endDate) return false;
    return true;
  });

  const handleApplyFilter = () => {
    // TODO: IPC call — window.electronAPI.queryActionLogs(filter)
    // Currently filtering is done client-side with demo data
  };

  const handleClearFilter = () => {
    setFilter({});
  };

  return (
    <div className="page">
      <h2>Nhật ký Hành động</h2>

      {/* Filters */}
      <div className="filters">
        <div className="form-group">
          <label htmlFor="filter-user">Người dùng</label>
          <input
            id="filter-user"
            value={filter.userId ?? ''}
            onChange={(e) => setFilter({ ...filter, userId: e.target.value || undefined })}
            placeholder="User ID..."
            style={{ width: '150px' }}
          />
        </div>
        <div className="form-group">
          <label htmlFor="filter-action">Loại hành động</label>
          <select
            id="filter-action"
            value={filter.action ?? ''}
            onChange={(e) => setFilter({ ...filter, action: e.target.value || undefined })}
            style={{ width: '180px' }}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt || 'Tất cả'}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="filter-start">Từ ngày</label>
          <input
            id="filter-start"
            type="date"
            value={filter.startDate?.split('T')[0] ?? ''}
            onChange={(e) => setFilter({ ...filter, startDate: e.target.value ? `${e.target.value}T00:00:00Z` : undefined })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="filter-end">Đến ngày</label>
          <input
            id="filter-end"
            type="date"
            value={filter.endDate?.split('T')[0] ?? ''}
            onChange={(e) => setFilter({ ...filter, endDate: e.target.value ? `${e.target.value}T23:59:59Z` : undefined })}
          />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" onClick={handleApplyFilter}>Lọc</button>
          <button className="btn btn-sm" onClick={handleClearFilter}>Xóa bộ lọc</button>
        </div>
      </div>

      {/* Results */}
      <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.5rem' }}>
        Hiển thị {filteredLogs.length} / {logs.length} bản ghi
      </p>

      {filteredLogs.length === 0 ? (
        <div className="empty-state">
          <p>Không có bản ghi nào phù hợp.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người dùng</th>
                <th>Hành động</th>
                <th>Hồ sơ</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                  <td>{log.username}</td>
                  <td>
                    <span className="badge" style={{ background: '#e8f0fe', color: '#1a73e8' }}>
                      {log.action}
                    </span>
                  </td>
                  <td>{log.profileId ?? '—'}</td>
                  <td style={{ fontSize: '0.8rem', color: '#666', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {Object.keys(log.details).length > 0 ? JSON.stringify(log.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
