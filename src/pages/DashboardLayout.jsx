import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import UserAvatar from "../components/UserAvatar";
import API_URL from "../api";
import "./Dashboard.css";

const sections = [
  ["", "Overview", "Your Karviam activity at a glance.", "◫"],
  ["posted", "My Posted Work", "Manage your work posts and review applicants.", "▤"],
  ["applications", "My Applications", "Track the opportunities you have applied for.", "↗"],
  ["accepted", "Accepted Work", "Your accepted work and conversations with hirers.", "✓"],
  ["completed", "Completed Work", "Your work history and reviews.", "☑"],
  ["profile", "Profile", "Manage your details, skills and profile photo.", "○"],
  ["blocked", "Blocked Users", "Manage who you have blocked on Karviam.", "⊘"],
];

function readUser() {
  try { return JSON.parse(localStorage.getItem("kaamonCurrentUser")); }
  catch { return null; }
}

export default function DashboardLayout() {
  const [user, setUser] = useState(readUser);
  const [adminProfile, setAdminProfile] = useState(null);
  const token = localStorage.getItem("kaamonToken");
  const userId = user?.id;
  // Only use the profile fetched for this session, never a cached local role.
  const isAdmin = adminProfile?.token === token && adminProfile?.userId === userId && adminProfile?.is_admin === true;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef(null);
  const menuButton = useRef(null);
  const location = useLocation();
  const section = sections.find(([path]) => location.pathname.replace(/\/$/, "") === `/dashboard${path ? `/${path}` : ""}`) || sections[0];

  useEffect(() => {
    const update = () => setUser(readUser());
    window.addEventListener("kaamonAuthChanged", update);
    return () => window.removeEventListener("kaamonAuthChanged", update);
  }, []);

  useEffect(() => {
    if (!token || userId == null) return;
    const controller = new AbortController();
    async function loadAdminStatus() {
      try {
        const response = await fetch(`${API_URL}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not load profile');
        const profile = await response.json();
        if (controller.signal.aborted) return;
        setAdminProfile({ token, userId, is_admin: String(profile.id) === String(userId) && profile.is_admin === true });
      } catch {
        // Discovery failure must not reveal admin navigation or disrupt the dashboard.
        if (!controller.signal.aborted) setAdminProfile(null);
      }
    }
    loadAdminStatus();
    return () => controller.abort();
  }, [token, userId]);

  useEffect(() => {
    const element = drawer.current;
    if (!element) return;
    if (drawerOpen) element.showModal();
    else element.close();
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", closeOnDesktop);
      element.close();
    };
  }, [drawerOpen]);

  // Also close on browser back/forward, not only on sidebar clicks.
  useEffect(() => { drawer.current?.close(); }, [location.key]);

  if (!user || !localStorage.getItem("kaamonToken")) return <Navigate to="/login" replace />;

  function navigation() {
    return <>
      <div className="workspace-identity">
        <UserAvatar name={user.name} src={user.profile_picture_url} size={38} />
        <div><strong>{user.name}</strong><span>MY WORKSPACE</span></div>
      </div>
      <nav aria-label="Workspace">
        {sections.map(([path, title, , icon], index) => <div key={path}>
          {index === 5 && <p className="workspace-account">Account</p>}
          <NavLink end to={`/dashboard${path ? `/${path}` : ""}`} onClick={() => setDrawerOpen(false)}>
            <span aria-hidden="true">{icon}</span>{title}
          </NavLink>
        </div>)}
        {isAdmin && <div>
          <p className="workspace-account">Admin</p>
          <NavLink to="/admin" onClick={() => setDrawerOpen(false)}>
            <span aria-hidden="true">🛡</span>Admin Moderation
          </NavLink>
        </div>}
      </nav>
    </>;
  }

  return <div className="dashboard-workspace">
    <button ref={menuButton} type="button" className="workspace-menu" aria-haspopup="dialog" aria-expanded={drawerOpen} aria-controls="workspace-drawer" onClick={() => setDrawerOpen(true)}>☰ Workspace <span>{section[1]}</span></button>
    <div className="dashboard-shell">
      <aside className="workspace-sidebar">{navigation()}</aside>
      <dialog id="workspace-drawer" ref={drawer} className="workspace-drawer" aria-label="Workspace menu" onCancel={() => setDrawerOpen(false)} onClose={() => { setDrawerOpen(false); menuButton.current?.focus(); }} onClick={event => { if (event.target === drawer.current) setDrawerOpen(false); }}>
        <div className="workspace-drawer-body">
          <button type="button" className="workspace-close" aria-label="Close workspace menu" onClick={() => setDrawerOpen(false)}>×</button>
          {navigation()}
        </div>
      </dialog>
      <div className="workspace-content">
        <header className="workspace-heading">
          <div><p className="workspace-eyebrow">{section[1]}</p><h1>{section[0] ? section[1] : `Good to see you, ${user.name?.split(" ")[0] || "there"}`}</h1><p>{section[2]}</p></div>
          {["", "posted"].includes(section[0]) && <Link className="workspace-primary" to="/post-work">+ Post Work</Link>}
        </header>
        <Outlet />
      </div>
    </div>
  </div>;
}
