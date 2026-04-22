import { useState } from 'react';
import type { User, Role, Permission, CreateUserRequest } from '@shared/types';

const DEMO_USERS: User[] = [
  {
    id: 'u-1',
    username: 'admin',
    role: 'admin',
    profileAccess: [],
  },
  {
    id: 'u-2',
    username: 'manager1',
    role: 'manager',
    profileAccess: [{ profileId: 'p-1', permissions: ['use', 'edit', 'share'] }],
  },
  {
    id: 'u-3',
    username: 'user1',
    role: 'user',
    profileAccess: [{ profileId: 'p-1', permissions: ['use'] }],
  },
];

const ALL_PERMISSIONS: Permission[] = ['use', 'edit', 'delete', 'share'];

export default function RBACPage() {
  const [users, setUsers] = useState<User[]>(DEMO_USERS);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showShareForm, setShowShareForm] = useState(false);
  const [shareUserId, setShareUserId] = useState('');
  const [shareProfileId, setShareProfileId] = useState('');
  const [sharePermissions, setSharePermissions] = useState<Permission[]>(['use']);
  const [newUser, setNewUser] = useState<CreateUserRequest>({ username: '', password: '', role: 'user' });

  const handleCreateUser = () => {
    if (!newUser.username.trim() || !newUser.password.trim()) return;
    // TODO: IPC call — window.electronAPI.createUser(newUser)
    const created: User = {
      id: `u-${Date.now()}`,
      username: newUser.username,
      role: newUser.role,
      profileAccess: [],
    };
    setUsers((prev) => [...prev, created]);
    setNewUser({ username: '', password: '', role: 'user' });
    setShowCreateForm(false);
  };

  const handleUpdateRole = (userId: string, role: Role) => {
    // TODO: IPC call — window.electronAPI.updateRole(userId, role)
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
  };

  const handleShareProfile = () => {
    if (!shareUserId || !shareProfileId.trim()) return;
    // TODO: IPC call — window.electronAPI.shareProfile(shareProfileId, shareUserId, sharePermissions)
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== shareUserId) return u;
        const existing = u.profileAccess.find((pa) => pa.profileId === shareProfileId);
        if (existing) {
          return {
            ...u,
            profileAccess: u.profileAccess.map((pa) =>
              pa.profileId === shareProfileId ? { ...pa, permissions: sharePermissions } : pa,
            ),
          };
        }
        return {
          ...u,
          profileAccess: [...u.profileAccess, { profileId: shareProfileId, permissions: sharePermissions }],
        };
      }),
    );
    setShowShareForm(false);
    setShareProfileId('');
    setSharePermissions(['use']);
  };

  const handleRevokeAccess = (userId: string, profileId: string) => {
    // TODO: IPC call — window.electronAPI.revokeAccess(profileId, userId)
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, profileAccess: u.profileAccess.filter((pa) => pa.profileId !== profileId) } : u,
      ),
    );
  };

  const togglePermission = (perm: Permission) => {
    setSharePermissions((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  };

  return (
    <div className="page">
      <div className="section-header">
        <h2>Quản lý Phân quyền (RBAC)</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>+ Tạo người dùng</button>
      </div>

      {/* Users table */}
      <div className="section">
        <h3>Danh sách người dùng</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Vai trò</th>
                <th>Quyền truy cập hồ sơ</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(e) => handleUpdateRole(user.id, e.target.value as Role)}
                      style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #ccc' }}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="user">User</option>
                    </select>
                  </td>
                  <td>
                    {user.profileAccess.length === 0 ? (
                      <span style={{ color: '#999' }}>{user.role === 'admin' ? 'Toàn quyền' : 'Không có'}</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {user.profileAccess.map((pa) => (
                          <div key={pa.profileId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                            <span>{pa.profileId}</span>
                            <span style={{ color: '#666' }}>[{pa.permissions.join(', ')}]</span>
                            <button className="btn btn-danger btn-sm" onClick={() => handleRevokeAccess(user.id, pa.profileId)}>
                              Thu hồi
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        setShareUserId(user.id);
                        setShowShareForm(true);
                      }}
                    >
                      Chia sẻ hồ sơ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateForm && (
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tạo người dùng mới</h3>
            <div className="form-group">
              <label htmlFor="new-username">Username</label>
              <input
                id="new-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="Nhập username..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">Mật khẩu</label>
              <input
                id="new-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Nhập mật khẩu..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-role">Vai trò</label>
              <select
                id="new-role"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role })}
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="user">User</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleCreateUser}>Tạo</button>
              <button className="btn" onClick={() => setShowCreateForm(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Share Profile Modal */}
      {showShareForm && (
        <div className="modal-overlay" onClick={() => setShowShareForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Chia sẻ hồ sơ cho {users.find((u) => u.id === shareUserId)?.username}</h3>
            <div className="form-group">
              <label htmlFor="share-profile-id">Profile ID</label>
              <input
                id="share-profile-id"
                value={shareProfileId}
                onChange={(e) => setShareProfileId(e.target.value)}
                placeholder="Nhập ID hồ sơ..."
              />
            </div>
            <div className="form-group">
              <label>Quyền</label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                {ALL_PERMISSIONS.map((perm) => (
                  <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={sharePermissions.includes(perm)}
                      onChange={() => togglePermission(perm)}
                    />
                    {perm}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={handleShareProfile}>Chia sẻ</button>
              <button className="btn" onClick={() => setShowShareForm(false)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
