import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import {
  MessageSquare,
  ClipboardList,
  Shield,
  FileText,
  ChevronRight,
} from 'lucide-react';

import ChatPage from './pages/ChatPage';
import WorkspacePage from './pages/WorkspacePage';
import PolicyPage from './pages/PolicyPage';
import ContractsPage from './pages/ContractsPage';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const navItems: NavItem[] = [
  { to: '/', icon: <MessageSquare size={20} />, label: 'Chat' },
  { to: '/workspace', icon: <ClipboardList size={20} />, label: 'Workspace' },
  { to: '/policy', icon: <Shield size={20} />, label: 'Policy' },
  { to: '/contracts', icon: <FileText size={20} />, label: 'Contracts' },
];

export default function App() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ───────────────────────────────────── */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={`
          relative z-30 flex flex-col
          bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900
          text-white shadow-xl
          transition-all duration-300 ease-in-out
          ${sidebarExpanded ? 'w-60' : 'w-16'}
        `}
      >
        {/* Logo area */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-700/50 px-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500 font-bold text-white text-sm">
            C
          </div>
          <span
            className={`
              whitespace-nowrap font-semibold text-lg tracking-tight
              transition-opacity duration-200
              ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}
            `}
          >
            Cantill
          </span>
        </div>

        {/* Navigation */}
        <nav className="mt-4 flex flex-1 flex-col gap-1 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5
                 transition-all duration-200
                 ${
                   isActive
                     ? 'bg-primary-600/20 text-primary-300 shadow-sm'
                     : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
                 }`
              }
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span
                className={`
                  whitespace-nowrap text-sm font-medium
                  transition-opacity duration-200
                  ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}
                `}
              >
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* Expand indicator */}
        <div className="border-t border-slate-700/50 p-3">
          <div className="flex items-center justify-center">
            <ChevronRight
              size={16}
              className={`
                text-slate-500 transition-transform duration-300
                ${sidebarExpanded ? 'rotate-180' : 'rotate-0'}
              `}
            />
          </div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">
              Cantill
            </h1>
            <span className="hidden sm:inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
              PR → PO Assistant
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
              <span className="h-2 w-2 rounded-full bg-accent-500 animate-pulse-soft" />
              Online
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
          </Routes>
        </main>
      </div>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1e293b',
            color: '#f1f5f9',
            borderRadius: '0.75rem',
            fontSize: '0.875rem',
          },
          success: {
            iconTheme: { primary: '#22c55e', secondary: '#f0fdf4' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fef2f2' },
          },
        }}
      />
    </div>
  );
}
