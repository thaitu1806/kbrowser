import { useState, useEffect } from 'react';
import ProfilesPage from './pages/ProfilesPage';
import GroupsPage from './pages/GroupsPage';
import NewProfileForm from './pages/NewProfileForm';
import FingerprintConfigForm from './pages/FingerprintConfigForm';
import ProxiesPage from './pages/ProxiesPage';
import RPAEditorPage from './pages/RPAEditorPage';
import RBACPage from './pages/RBACPage';
import ActionLogsPage from './pages/ActionLogsPage';
import ExtensionsPage from './pages/ExtensionsPage';
import CloudSyncPage from './pages/CloudSyncPage';
import IPRotationPage from './pages/IPRotationPage';
import TrashPage from './pages/TrashPage';

type PageId =
  | 'profiles'
  | 'new-profile'
  | 'groups'
  | 'proxies'
  | 'extensions'
  | 'trash'
  | 'cloud-sync'
  | 'fingerprint'
  | 'rpa'
  | 'rpa-plus'
  | 'rbac'
  | 'logs'
  | 'api'
  | 'ip-rotation';

interface NavItem {
  id: PageId;
  label: string;
  icon: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'profiles', label: 'Profiles', icon: '👤' },
  { id: 'groups', label: 'Groups', icon: '📁' },
  { id: 'proxies', label: 'Proxies', icon: '🌐' },
  { id: 'extensions', label: 'Extensions', icon: '🧩' },
  { id: 'trash', label: 'Trash', icon: '🗑️' },
  { id: 'cloud-sync', label: 'Cloud Number', icon: '☁️' },
  { id: 'fingerprint', label: 'Synchronizer', icon: '🔄', section: 'Automation' },
  { id: 'rpa', label: 'RPA', icon: '🤖' },
  { id: 'rpa-plus', label: 'RPA Plus', icon: '🚀' },
  { id: 'api', label: 'API & MCP', icon: '🔌' },
];

function App() {
  const [activePage, setActivePage] = useState<PageId>('profiles');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [editProfileId, setEditProfileId] = useState<string | null>(null);
  const [initialGroupFilter, setInitialGroupFilter] = useState<string | null>(null);
  const [profileCount, setProfileCount] = useState(0);

  // Load profile count
  useEffect(() => {
    const loadCount = async () => {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api?.listProfiles) {
        try {
          const list = await api.listProfiles();
          setProfileCount(list.length);
        } catch { /* ignore */ }
      }
    };
    loadCount();
    const interval = setInterval(loadCount, 15000);
    return () => clearInterval(interval);
  }, []);

  const renderPage = () => {
    switch (activePage) {
      case 'profiles':
        return <ProfilesPage
          onNewProfile={() => { setEditProfileId(null); setActivePage('new-profile'); }}
          onEditProfile={(id: string) => { setEditProfileId(id); setActivePage('new-profile'); }}
          initialGroupFilter={initialGroupFilter}
        />;
      case 'new-profile':
        return <NewProfileForm
          editProfileId={editProfileId}
          onSave={() => { setEditProfileId(null); setActivePage('profiles'); }}
          onCancel={() => { setEditProfileId(null); setActivePage('profiles'); }}
        />;
      case 'groups':
        return <GroupsPage onNavigateToGroup={(name: string) => {
          setInitialGroupFilter(name);
          setActivePage('profiles');
        }} />;
      case 'fingerprint':
        return <FingerprintConfigForm />;
      case 'proxies':
        return <ProxiesPage />;
      case 'trash':
        return <TrashPage />;
      case 'rpa':
      case 'rpa-plus':
        return <RPAEditorPage />;
      case 'rbac':
        return <RBACPage />;
      case 'logs':
        return <ActionLogsPage />;
      case 'extensions':
        return <ExtensionsPage />;
      case 'cloud-sync':
        return <CloudSyncPage />;
      case 'ip-rotation':
        return <IPRotationPage />;
      case 'api':
        return <IPRotationPage />;
      default:
        return <ProfilesPage />;
    }
  };

  let lastSection = '';

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-icon">🛡️</span>
            {!sidebarCollapsed && <span className="logo-text">Ken's Browser IM</span>}
          </div>
          <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        {/* New Profile Button */}
        <div className="sidebar-action">
          <button className="btn-new-profile" onClick={() => { setEditProfileId(null); setActivePage('new-profile'); }}>
            {sidebarCollapsed ? '+' : '+ New Profile'}
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const showSection = item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;
            return (
              <div key={item.id}>
                {showSection && !sidebarCollapsed && (
                  <div className="nav-section-label">{item.section}</div>
                )}
                <button
                  className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                  onClick={() => setActivePage(item.id)}
                  title={item.label}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
                  {item.id === 'rpa-plus' && !sidebarCollapsed && (
                    <span className="nav-badge-new">NEW</span>
                  )}
                </button>
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        {!sidebarCollapsed && (
          <div className="sidebar-footer">
            <div className="sidebar-footer-row">
              <button className="nav-item" onClick={() => setActivePage('rbac')}>
                <span className="nav-icon">👥</span>
                <span className="nav-label">Team</span>
              </button>
              <button className="nav-item" onClick={() => setActivePage('logs')}>
                <span className="nav-icon">📋</span>
                <span className="nav-label">Logs</span>
              </button>
            </div>
            <div className="sidebar-stats">
              <div className="stat-row">
                <span>Profiles</span>
                <span className="stat-value">{profileCount} / ∞</span>
              </div>
              <div className="stat-row">
                <span>Members</span>
                <span className="stat-value">1 / 1</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
