import { Link } from "@tanstack/react-router";
import { Activity, ClipboardList, ScrollText, Info } from "lucide-react";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Console", icon: Activity },
  { to: "/queue", label: "Review queue", icon: ClipboardList },
  { to: "/audit", label: "Audit & governance", icon: ScrollText },
  { to: "/about", label: "About", icon: Info },
] as const;

export function SocShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-ok animate-livedot" />
            <span className="text-sm font-bold tracking-[0.18em] text-foreground uppercase">
              Agentic Cybersecurity Incident Response System
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-xs">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-primary" }}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-[1500px] px-4 pb-10 pt-4 text-[11px] text-muted-foreground">
        Passive reconnaissance only — no exploitation payloads are sent to any target. Human oversight, kill switch
        and audit logging are always active.
      </footer>
    </div>
  );
}
