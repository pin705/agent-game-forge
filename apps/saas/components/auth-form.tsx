"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Github, Loader2 } from "lucide-react";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithMagicLink,
  type AuthState,
} from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const initialState: AuthState = {};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

function MagicLinkButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      Email me a magic link
    </Button>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const passwordAction = mode === "login" ? signInWithPassword : signUpWithPassword;
  const [pwState, pwFormAction] = useActionState(passwordAction, initialState);
  const [magicState, magicFormAction] = useActionState(signInWithMagicLink, initialState);

  const error = pwState.error ?? magicState.error;
  const message = pwState.message ?? magicState.message;

  return (
    <div className="space-y-5">
      {/* Email + password */}
      <form action={pwFormAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="••••••••"
            required
          />
        </div>
        <SubmitButton>{mode === "login" ? "Log in" : "Create account"}</SubmitButton>
      </form>

      {/* Magic link — shares the email field above via its own form */}
      <form action={magicFormAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="magic-email" className="text-muted-foreground">
            Or sign in without a password
          </Label>
          <Input
            id="magic-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <MagicLinkButton />
      </form>

      {(error || message) && (
        <p
          className={`text-center text-sm ${error ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {error ?? message}
        </p>
      )}

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
          OR
        </span>
      </div>

      {/* OAuth — stubbed for P0. Wire providers in Supabase dashboard, then
          replace these with supabase.auth.signInWithOAuth({ provider }). */}
      <div className="space-y-2">
        <Button variant="outline" className="w-full" disabled title="Coming soon — configure provider in Supabase">
          {/* TODO(P0+): enable Google OAuth once the provider is configured. */}
          <GoogleGlyph />
          Continue with Google
        </Button>
        <Button variant="outline" className="w-full" disabled title="Coming soon — configure provider in Supabase">
          {/* TODO(P0+): enable GitHub OAuth once the provider is configured. */}
          <Github />
          Continue with GitHub
        </Button>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.8h5.35c-.23 1.5-1.6 4.4-5.35 4.4a6.3 6.3 0 1 1 0-12.6 5.7 5.7 0 0 1 4.04 1.58l1.9-1.9A8.9 8.9 0 1 0 12 21c5.13 0 8.5-3.6 8.5-8.66 0-.58-.06-1.02-.15-1.24Z"
      />
    </svg>
  );
}
