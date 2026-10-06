'use client';

import { useState } from 'react';
import {
  LayoutDashboard, Table2, BarChart3, Package, ShieldCheck,
  FileText, Sparkles, Settings, Database, GitCompare,
  Menu, X, ChevronRight, Zap
} from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { useTheme } from '@/hooks/useTheme';

const NAV_ITEMS = [
  { id: 'overview',  label: 'Overview',        icon: LayoutDashboard,  group: 'main' },
  { id: 'explorer',  label: 'Data Explorer',  icon: Table2,           group: 'main' },
  { id: 'products',  label: 'Products',       icon: Package,          group: 'main' },
  { id: 'analytics', label: 'Analytics',      icon: BarChart3,        group: 'main' },
  { id: 'quality',   label: 'Data Quality',   icon: ShieldCheck,      group: 'main' },
  { id: 'reports',   label: 'Reports',        icon: FileText,         group: 'main' },
  { id: 'insights',  label: 'AI Insights',    icon: Sparkles,         group: 'ai',   accent: true },
  { id: 'library',   label: 'Dataset Library',icon: Database,         group: 'data' },
  { id: 'settings',  label: 'Settings',       icon: Settings,         group: 'system'},
];

export default function Sidebar({ mobileOpen, onMobileClose }) {
  const { page, setPage, analysis, fileName } = useAppState();

  function navigate(id) {
    setPage(id);
    onMobileClose?.();
  }

  return (
    <aside
      className="w-24 flex-shrink-0 bg-white border-r border-gray-200 z-20"
      aria-label="Main navigation"
    >
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Logo area */}
      <div className="flex flex-col items-center gap-1 px-4 py-3 border-b border-gray-200">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">Datalens</span>
      </div>

      {/* Dataset indicator */}
      {analysis && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
          <p className="text-[0.75rem] text-gray-400 uppercase tracking-wider font-semibold mb-0.5">Active dataset</p>
          <p className="text-gray-500 text-xs font-medium truncate">{fileName || 'Uploaded dataset'}</p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {['main','ai','data','system'].map(group => {
          const items = NAV_ITEMS.filter(n => n.group === group);
          return (
            <div key={group} className={group !== 'main' ? 'pt-2' : ''}>
              {group === 'ai' && (
                <p className="px-1 mb-1 text-[0.65rem] uppercase font-bold text-gray-400 tracking-widest">AI</p>
              )}
              {group === 'data' && (
                <p className="px-1 mb-1 text-[0.65rem] uppercase font-bold text-gray-400 tracking-widest">Data</p>
              )}
              {group === 'system' && (
                <p className="px-1 mb-1 text-[0.65rem] uppercase font-bold text-gray-400 tracking-widest">System</p>
              )}
              {items.map(item => {
                const active = page === item.id;
                const Icon = item.icon;
                const disabled = !analysis && !['library','compare','settings','upload'].includes(item.id);

                return (
                  <button
                    key={item.id}
                    onClick={() => !disabled && navigate(item.id)}
                    className={`nav-link w-full flex items-center gap-2 rounded-sm py-1.5 text-[0.65rem] font-medium ${active ? 'text-gray-700' : 'text-gray-500'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={disabled ? 'Upload a dataset first' : item.label}
                  >
                    <Icon
                      size={15}
                      className="nav-icon flex-shrink-0 mr-2"
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Footer with New Dataset button */}
      <div className="pt-2 border-t border-gray-200">
        <button
          onClick={() => navigate('upload')}
          className="w-full text-[0.6rem] font-medium text-center py-2 rounded-sm text-gray-400 hover:text-gray-600"
          title="Upload a new dataset"
        >
          + New Dataset
        </button>
      </div>
    </aside>
  );
}