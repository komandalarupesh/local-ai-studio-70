import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Loader2, LogOut, MessagesSquare, Plug, Settings } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/studio", label: "Studio", icon: MessagesSquare },
  { to: "/providers", label: "Providers", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AuthenticatedLayout() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      sessionStorage.setItem("rls:redirect", window.location.pathname);
      navigate({ to: "/auth" });
    }
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-surface/70 px-4 py-2.5 backdrop-blur">
        <Link to="/dashboard" className="mr-3 flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-primary shadow-glow" />
          <span className="font-display text-sm font-semibold">Rupesh LLM Studio</span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              )}
              activeProps={{ className: "bg-muted text-foreground" }}
            >
              <item.icon className="size-3.5" />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground md:inline">
            {session.user.email}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
