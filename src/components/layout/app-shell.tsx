"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * App Shell — top nav + main content area.
 * Ref: PRODUCT-SPEC.md §5.2 (navigation), DESIGN-SYSTEM.md (colors, spacing)
 *
 * Nav items: Dashboard | Thread Analysis | Settings
 * Credit badge always visible in top-right.
 */

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Thread Analysis", href: "/threads" },
  { label: "Settings", href: "/settings" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 border-b border-border-default bg-bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          {/* Logo + Nav */}
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
              className="font-[Satoshi] text-lg font-bold text-text-primary"
            >
              RedditIntel
            </Link>

            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-short)] ${
                      isActive
                        ? "bg-bg-elevated text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side: Credits + User */}
          <div className="flex items-center gap-4">
            {/* Credit balance badge — placeholder, wired up in Phase 4 */}
            <div className="flex items-center gap-1.5 rounded-full bg-bg-elevated px-3 py-1 text-sm">
              <span className="text-text-muted">Credits:</span>
              <span className="font-medium text-accent">--</span>
            </div>

            {/* User avatar placeholder */}
            <div className="h-8 w-8 rounded-full bg-bg-elevated" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
