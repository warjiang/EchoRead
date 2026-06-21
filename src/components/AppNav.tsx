"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, History, Library, Newspaper, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Articles", icon: Newspaper },
  { href: "/vocabulary", label: "Vocabulary", icon: Library },
  { href: "/history", label: "History", icon: History },
  { href: "/admin", label: "Admin", icon: ShieldCheck },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/articles");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container-page flex min-h-14 items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-primary text-primary-foreground shadow-xs">
            <BookOpenCheck className="size-4" aria-hidden="true" />
          </span>
          <span className="hidden truncate text-sm font-semibold tracking-normal sm:inline">
            EchoRead
          </span>
        </Link>

        <nav
          className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
          aria-label="Main"
        >
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto sm:px-2.5",
                  active && "bg-background text-foreground shadow-xs"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
