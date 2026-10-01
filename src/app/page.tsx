import { Suspense } from "react";
import { Dashboard, DashboardFallback } from "@/components/dashboard";

export default function Page() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <Dashboard />
    </Suspense>
  );
}
