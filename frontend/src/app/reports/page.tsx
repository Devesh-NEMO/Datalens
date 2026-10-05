/* Datalens Reports Page */

"use client";

import { useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui";
import { useTheme } from "@/hooks/useTheme";

export default function ReportsPage() {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);

  const handleGenerate = () => {
    setVisible(false);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">Reports</h2>
      <Button variant="outline" onClick={() => setVisible(true)}>
        Generate Report
      </Button>
      {visible && (
        <Dialog open={visible} onOpenChange={(v) => setVisible(!v)}>
          <DialogContent className="p-4">
            <DialogHeader>
              <DialogTitle>Report Generation</DialogTitle>
            </DialogHeader>
            <p>Select report type and generate</p>
            <Button onClick={handleGenerate}>Close</Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
