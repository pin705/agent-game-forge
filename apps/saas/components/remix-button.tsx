"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Remix entry point (SAAS_ARCHITECTURE §8 P4). Clones a (published or owned)
 * project for the current user and opens the new copy in the editor. `srcRef` is
 * a project id or slug. Used both on the builder header and the public share
 * wrapper page ("Remix this game").
 */
export function RemixButton({
  srcRef,
  variant = "outline",
  label = "Remix",
}: {
  srcRef: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remix = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(srcRef)}/remix`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          toast.error("Log in to remix this game.");
          router.push("/login");
          return;
        }
        toast.error(data.error ?? "Couldn't remix.");
        return;
      }
      toast.success("Remixed — opening your copy.");
      router.push(`/build/${data.projectId}`);
    } catch {
      toast.error("Network error while remixing.");
    } finally {
      setBusy(false);
    }
  }, [srcRef, router]);

  return (
    <Button size="sm" variant={variant} onClick={remix} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <GitFork />}
      {label}
    </Button>
  );
}
