"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Table2, BarChart3, Package, ShieldCheck,
  FileText, Sparkles, Settings, Database, LogOut
} from "lucide-react";

import { useAppState } from "@/hooks/useAppState";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "explorer", label: "Data Explorer", icon: Table2 },
  { id: "products", label: "Products", icon: Package },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "quality", label: "Data Quality", icon: ShieldCheck },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "insights", label: "AI Insights", icon: Sparkles },
  { id: "library", label: "Dataset Library", icon: Database },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { page, setPage, analysis, fileName } = useAppState();

  const isActive = (id: string) => pathname === `/${id}` || pathname.startsWith(`/${id}/`);

  function navigate(id: string) {
    setPage(id as /* PageName */ string);
  }

  return (
    <aside
      className="fixed inset-y-0 left-0 w-[var(--sidebar-w)] z-30 border-r border-border transition-colors duration-200 bg-[var(--color-surface)]"
    >
      <nav className="flex flex-col h-full p-4 pt-2 space-y-0.5">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-xs font-medium uppercase tracking-wider">
          <span className="text-[var(--color-text-muted)]">Datalens</span>
        </div>

        {/* Dataset indicator */}
        {!!analysis && (
          <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)]">
            <p className="text-[0.7rem] text-[var(--color-text-muted)] uppercase tracking-wider font-semibold mb-0.5">Active dataset</p>
            <p className="text-[0.6rem] text-[var(--color-text-muted)] truncate">{fileName || 'Uploaded dataset'}</p>
          </div>
        )}

        <nav className="flex flex-col gap-1 pt-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.id);

            if (item.id === "ai" || item.id === "data" || item.id === "system") {
              return (
                <p key={item.id} className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  {item.label}
                </p>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className="w-full flex items-center gap-3 rounded-sm py-2.5 text-sm font-medium hover:bg-[var(--color-surface-2)] transition-colors"
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="flex-shrink-0 h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer with New Dataset button */}
        <div className="mt-4 pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={() => navigate("upload")}
            className="w-full flex items-center justify-center py-2 rounded-sm text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            title="Upload a new dataset"
          >
            <LogOut className="h-3 w-3 mr-2" /> + New Dataset
          </button>
        </div>
      </nav>
    </aside>
  );
}