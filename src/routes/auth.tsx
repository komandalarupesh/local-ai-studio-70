import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Rupesh LLM Studio" },
      {
        name: "description",
        content:
          "Sign in to Rupesh LLM Studio to run your own assistant on open-source and local language models.",
      },
      { property: "og:title", content: "Sign in — Rupesh LLM Studio" },
      {
        property: "og:description",
        content: "Access your private AI studio, model providers and saved conversations.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      const stored = sessionStorage.getItem("rls:redirect");
      sessionStorage.removeItem("rls:redirect");
      navigate({ to: stored && stored.startsWith("/") ? stored : "/dashboard" });
    }
  }, [loading, session, navigate]);

  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  }

  async function signUp() {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created. You can start building right away.");
  }

  async function signInWithGoogle() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    setBusy(false);
    if (result.error) {
      toast.error(result.error.message ?? "Google sign-in failed.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <main className="bg-hero flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" />
          <span className="font-display font-semibold">Rupesh LLM Studio</span>
        </Link>

        <div className="glass-panel p-6">
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5 space-y-4">
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="Password" value={password} onChange={setPassword} type="password" />
              <Button className="w-full" onClick={signIn} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Sign in
              </Button>
            </TabsContent>

            <TabsContent value="signup" className="mt-5 space-y-4">
              <Field label="Display name" value={displayName} onChange={setDisplayName} />
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field
                label="Password"
                value={password}
                onChange={setPassword}
                type="password"
                hint="At least 6 characters."
              />
              <Button className="w-full" onClick={signUp} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Create account
              </Button>
            </TabsContent>
          </Tabs>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="secondary" className="w-full" onClick={signInWithGoogle} disabled={busy}>
            Continue with Google
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Your API keys stay server-side and your conversations stay private to your account.
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
