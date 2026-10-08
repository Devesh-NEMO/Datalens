'use client';

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui';

/**
 * Stub reports page: the generate action currently only confirms. The four
 * report presets ship in the report lab on the dashboard — this screen owns
 * producing them on demand later.
 */
export default function ReportsPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-[var(--color-text)]">Reports</h1>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger className="rounded-[6px] border border-[var(--color-rule)] bg-transparent px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-rule)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
          Generate Report
        </DialogTrigger>
        <DialogContent titleId="report-dialog-title" className="p-6">
          <DialogHeader>
            <DialogTitle id="report-dialog-title">Report Generation</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            Select a report type and generate it. Full report presets arrive with the
            dataset library.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose />
            <Button variant="primary" onClick={() => setOpen(false)}>
              Generate
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}