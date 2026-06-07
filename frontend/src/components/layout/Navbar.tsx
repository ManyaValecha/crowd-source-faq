import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAuthModal, useAuthGate } from '../../context/AuthModalContext';
import { buildTransformedUrl } from '../../hooks/useCloudinaryUpload';
import NotificationBell from '../../components/ui/NotificationBell';
import ThemeToggle from '../../components/ui/ThemeToggle';

const navItems = [
  { label: 'Home', to: '/' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Community', to: '/community' },
  { label: 'Saved', to: '/saved' },
  { label: 'Leaderboard', to: '/leaderboard' },
];

function getAvatarColor(name?: string): string {
  if (!name) return '#6b92e0';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#6b92e0', '#5a9a6b', '#c4943a', '#e07c6b', '#7c6be0', '#e06ba8'];
  return colors[Math.abs(hash) % colors.length];
}

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const { openModal } = useAuthModal();
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const gate = useAuthGate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close profile dropdown on outside click — ref-based to avoid stale closure
  useEffect(() => {
    if (!profileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    // Small delay so the click that opened the menu doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [profileOpen]);

  const handleLogout = () => {
    setProfileOpen(false);
    logout();
    // Stay on current page — the user is just logged out, not navigated.
  };

  const initials = user?.name ? user.name.charAt(0).toUpperCase() : '?';
  const avatarColor = getAvatarColor(user?.name);
  // Thumbnail transform — cap the navbar avatar at 64×64 so we're not
  // downloading the full-size upload on every page. Cloudinary returns
  // a transformed URL, no extra round-trip.
  const avatarSrc = user?.avatar?.url
    ? buildTransformedUrl(user.avatar.url, 'w_64,h_64,c_fill,g_auto,q_auto,f_auto')
    : undefined;
  const isCommunityActive = location.pathname === '/community';

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-[400ms] ease-smooth
        ${scrolled
          ? 'bg-bg/82 backdrop-blur-[20px] saturate-[1.8] border-b border-black/[0.04] shadow-subtle'
          : 'bg-transparent border-b border-transparent'
        }`}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between relative">

        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-9 h-9 rounded-[10px] border-2 border-ink text-ink flex items-center justify-center transition-transform duration-300 group-hover:rotate-[-6deg]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <span className="font-serif text-xl tracking-tight text-ink">
            Yaksha FAQ
          </span>
        </NavLink>

        {/* Center Pill Group (Desktop) */}
        <div className="hidden lg:flex items-center gap-1.5 px-1.5 py-[5px] rounded-full border-[1.5px] border-border bg-card/50 backdrop-blur-[12px] absolute left-1/2 -translate-x-1/2">
          {navItems.map(({ label, to }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `nav-pill ${isActive ? 'active' : ''}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2 flex-shrink-0">

        {/* Theme toggle — always visible, to the left of the auth/notif block */}
        <ThemeToggle />

        {/* Unauthenticated — Sign in (text) + Get started (filled) */}
        {!isAuthenticated && (
          <div className="hidden lg:flex items-center gap-2">
            <button
              onClick={() => openModal('signin')}
              className="px-3 py-1.5 text-sm font-medium text-ink-soft hover:text-ink transition-colors"
            >
              Sign in
            </button>
            <button
              onClick={() => openModal('register')}
              className="btn-primary-gradient px-4 py-1.5 text-sm font-semibold rounded-full transition-colors"
            >
              Get started
            </button>
          </div>
        )}

        {/* Authenticated */}
        {isAuthenticated && (
          <>
            {/* Ask Question button — green pill */}
            <button
              onClick={() => navigate('/community?ask=true')}
              className="hidden lg:inline-flex items-center gap-1.5 px-4 py-2 rounded-full btn-primary-gradient text-xs font-semibold transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Ask Question
            </button>

            <div className="hidden lg:block w-px h-6 bg-border mx-1" />

            <NotificationBell />

            {/* User Avatar + Dropdown */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setProfileOpen(!profileOpen); }}
                className="flex items-center gap-1.5 cursor-pointer group"
              >
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt={user?.name ? `${user.name} avatar` : 'avatar'}
                    className="w-9 h-9 rounded-full object-cover ring-2 ring-card transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                    />
                    ) : (
                    <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-accent-text text-sm font-semibold ring-2 ring-card transition-transform duration-200 group-hover:scale-105"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {initials}
                  </div>
                )}
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  className={`hidden md:block text-ink-soft transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-12 w-48 bg-card rounded-xl border border-border shadow-float py-2 animate-fade-in z-50">
                  <div className="px-4 py-2 border-b border-border/50">
                    <p className="text-sm font-medium text-ink">{user?.name || 'User'}</p>
                    <p className="text-xs text-ink-faint">{user?.email || ''}</p>
                  </div>
                  {(user?.role === 'admin' || user?.role === 'moderator') && (
                    <button
                      onClick={() => { navigate('/admin'); setProfileOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:bg-bg hover:text-ink transition-colors border-b border-border/30"
                    >
                      Admin Dashboard
                    </button>
                  )}
                  <button
                    onClick={() => { navigate('/account'); setProfileOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:bg-bg hover:text-ink transition-colors border-b border-border/30"
                  >
                    Account
                  </button>
                  <button
                    onClick={() => { navigate('/saved'); setProfileOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:bg-bg hover:text-ink transition-colors border-b border-border/30"
                  >
                    Saved
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm text-ink-soft hover:bg-bg hover:text-ink transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Mobile hamburger */}
        <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden flex w-9 h-9 items-center justify-center rounded-[10px] hover:bg-black/[0.04] transition-colors"
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7"/>
                  <line x1="4" y1="12" x2="20" y2="12"/>
                  <line x1="4" y1="17" x2="20" y2="17"/>
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      <div
        className={`lg:hidden overflow-hidden transition-all duration-[350ms] ease-smooth border-t border-border ${
          mobileOpen ? 'max-h-[28rem] opacity-100' : 'max-h-0 opacity-0'
        }`}
        style={{
          backgroundColor: 'rgb(var(--bg-card-rgb) / 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <div className="px-6 py-4 flex flex-col gap-1">
          {navItems.map(({ label, to }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-accent-light text-accent'
                    : 'text-ink-soft hover:text-ink hover:bg-black/[0.03]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}

          {/* Mobile: Sign-in / Get started */}
          {!isAuthenticated && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { openModal('signin'); setMobileOpen(false); }}
                className="flex-1 py-2.5 px-4 text-sm font-semibold text-ink-soft border border-border rounded-full hover:bg-mist transition-colors"
              >
                Sign in
              </button>
              <button
                onClick={() => { openModal('register'); setMobileOpen(false); }}
                className="btn-primary-gradient flex-1 py-2.5 px-4 text-sm font-semibold rounded-full transition-colors"
              >
                Get started
              </button>
            </div>
          )}
          {isAuthenticated && (
            <>
              <NavLink
                to="/saved"
                end
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `block px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive ? 'bg-accent-light text-accent' : 'text-ink-soft hover:text-ink hover:bg-black/[0.03]'
                  }`
                }
              >
                Saved
              </NavLink>
              <div className="mt-2 px-4 py-2 text-xs text-ink-faint border-t border-border/40">
                Signed in as <span className="font-medium text-ink">{user?.name}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
