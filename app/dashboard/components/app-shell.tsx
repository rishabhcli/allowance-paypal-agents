'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BellIcon, HelpIcon } from './ui/icons';
import { AgStudioLogo } from './ui/logo';

// The app frame: a white top bar with the Allowance wordmark and page links, a left sidebar and a light
// canvas. Shared by the dashboard, its loading skeleton and its error page.

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 text-pp-navy">
      <span className="flex size-8 items-center justify-center rounded-lg bg-pp-blue text-base font-bold text-white" aria-hidden>
        A
      </span>
      <span className="text-lg font-semibold tracking-tight">Allowance</span>
    </Link>
  );
}

const navClass = (on: boolean) => `rounded-full px-3 py-1.5 ${on ? 'bg-pp-highlight text-pp-navy' : 'text-pp-muted hover:bg-pp-highlight hover:text-pp-navy'}`;

function BrandLockup({ active }: { active: 'approvals' | 'dashboard' }) {
  return (
    <div className="flex items-center gap-4">
      <Wordmark />
      <span className="h-6 w-px bg-pp-border" aria-hidden />
      <nav className="flex items-center gap-1 text-sm font-semibold" aria-label="Pages">
        <Link href="/" className={navClass(active === 'approvals')}>Approvals</Link>
        <Link href="/dashboard" className={navClass(active === 'dashboard')}>Dashboard</Link>
      </nav>
      <span className="hidden items-center gap-1 text-xs text-pp-muted md:flex">
        reports by <AgStudioLogo className="h-9 w-auto" />
      </span>
    </div>
  );
}

export function TopBar({ active = 'dashboard' }: { active?: 'approvals' | 'dashboard' }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-pp-border bg-white px-6">
      <BrandLockup active={active} />
      <div className="ml-auto flex items-center gap-1 text-pp-navy">
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Help">
          <HelpIcon />
        </span>
        <span className="inline-flex size-9 items-center justify-center rounded-full" title="Notifications">
          <BellIcon />
        </span>
        <span className="ml-2 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-full bg-pp-navy text-sm font-semibold text-white">
            A
          </span>
          <span className="hidden text-sm font-semibold sm:inline">Sandbox account</span>
        </span>
      </div>
    </header>
  );
}

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-white" aria-label="Reports">
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
