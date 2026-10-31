import { TopBar } from './dashboard/components/app-shell';
import { Approvals } from './approvals';

export const metadata = { title: 'Approvals' };

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar active="approvals" />
      <Approvals />
    </div>
  );
}
