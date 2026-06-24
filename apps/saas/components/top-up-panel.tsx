"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Loader2,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CreditPack } from "@/lib/billing/packs";

/** Format an integer VND amount, e.g. 55000 → "55.000 ₫". */
function vnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n) + " ₫";
}

type Order = {
  orderId: string;
  transferCode: string;
  amountVnd: number;
  credits: number;
  qrUrl: string;
  bank: { account: string; code: string; name: string };
  simulated?: boolean;
};

type Status = "idle" | "creating" | "awaiting" | "paid" | "error";

/**
 * Top-up surface (§5 top-up via SePay/VietQR). VN-first copy with English in
 * parentheses. Three states:
 *   • pick a pack  → POST /api/credits/topup
 *   • awaiting     → show VietQR + bank + transfer code + amount, POLL the order
 *   • paid         → success + refresh the balance (router.refresh)
 *
 * On-brand: reuses Card/Button + the warm/mono theme. `packs` is passed from the
 * server page so the catalogue lives in ONE place (lib/billing/packs.ts).
 */
export function TopUpPanel({ packs }: { packs: CreditPack[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "account" | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Clean up the poll timer on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  const pick = useCallback(
    async (packId: string) => {
      setStatus("creating");
      setError(null);
      try {
        const res = await fetch("/api/credits/topup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Không tạo được đơn (could not create order).");
          setStatus("error");
          return;
        }
        setOrder(data as Order);
        setStatus("awaiting");
      } catch {
        setError("Lỗi mạng (network error).");
        setStatus("error");
      }
    },
    [],
  );

  // Poll order status while awaiting payment.
  useEffect(() => {
    if (status !== "awaiting" || !order) return;
    stopPolling();
    let stopped = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/credits/orders/${order.orderId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!stopped && data.status === "paid") {
          stopPolling();
          setStatus("paid");
          // Refresh server components (TopNav credits chip + layout balance).
          router.refresh();
        }
      } catch {
        /* transient — keep polling */
      }
    };

    pollRef.current = setInterval(tick, 4000);
    void tick(); // immediate first check
    return () => {
      stopped = true;
      stopPolling();
    };
  }, [status, order, router, stopPolling]);

  const copy = useCallback((text: string, which: "code" | "account") => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setOrder(null);
    setError(null);
    setStatus("idle");
  }, [stopPolling]);

  // ── Success ───────────────────────────────────────────────────────────────
  if (status === "paid" && order) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="size-6" />
          </div>
          <div>
            <p className="font-medium">Thanh toán thành công! (Payment received)</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Đã cộng <span className="font-medium text-foreground tabular-nums">{order.credits}</span>{" "}
              credits vào tài khoản. (Credits added.)
            </p>
          </div>
          <Button variant="outline" onClick={reset} className="mt-2">
            Nạp thêm (Top up again)
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Awaiting payment: QR + bank details + transfer code + poll ──────────────
  if (status === "awaiting" && order) {
    return (
      <Card>
        <CardContent className="p-6">
          <button
            onClick={reset}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Chọn gói khác (Choose another pack)
          </button>

          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
            {/* VietQR image */}
            <div className="mx-auto flex flex-col items-center gap-2">
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={order.qrUrl}
                  alt="VietQR — quét để thanh toán"
                  width={208}
                  height={208}
                  className="size-52 object-contain"
                />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <QrCode className="size-3.5" />
                Quét bằng app ngân hàng (scan in any banking app)
              </p>
            </div>

            {/* Transfer details */}
            <div className="flex flex-col gap-3">
              <Detail label="Số tiền (Amount)">
                <span className="text-lg font-semibold tabular-nums">{vnd(order.amountVnd)}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  → {order.credits} credits
                </span>
              </Detail>

              <Detail label="Nội dung CK (Transfer memo) — bắt buộc / required">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-sm font-medium">
                    {order.transferCode}
                  </code>
                  <CopyBtn onClick={() => copy(order.transferCode, "code")} done={copied === "code"} />
                </div>
              </Detail>

              {order.bank.account && (
                <Detail label="Số tài khoản (Account)">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm">{order.bank.account}</code>
                    <CopyBtn
                      onClick={() => copy(order.bank.account, "account")}
                      done={copied === "account"}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {order.bank.code}
                    {order.bank.name ? ` · ${order.bank.name}` : ""}
                  </p>
                </Detail>
              )}

              <div className="mt-1 flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Chờ thanh toán… (Waiting for payment)
              </div>

              {order.simulated && (
                <p className="text-xs text-muted-foreground">
                  Chế độ dev: chưa kết nối ngân hàng nên đơn sẽ không tự chuyển sang “đã thanh toán”.
                  (Dev mode — no bank connected, so this won&apos;t flip to paid.)
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Pick a pack ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {packs.map((p) => (
          <li key={p.id}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex h-full flex-col items-start gap-3 p-5">
                <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Coins className="size-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{p.label}</p>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums">{p.credits}</p>
                  <p className="text-xs text-muted-foreground">credits</p>
                </div>
                <p className="text-base font-medium tabular-nums">{vnd(p.amountVnd)}</p>
                <Button
                  className="mt-auto w-full"
                  onClick={() => pick(p.id)}
                  disabled={status === "creating"}
                >
                  {status === "creating" ? <Loader2 className="animate-spin" /> : null}
                  Nạp (Top up)
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Thanh toán bằng chuyển khoản ngân hàng qua VietQR — không cần thẻ. (Pay by VietQR bank
        transfer — no card needed.) Credits sẽ được cộng tự động sau khi nhận được chuyển khoản.
      </p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CopyBtn({ onClick, done }: { onClick: () => void; done: boolean }) {
  return (
    <Button size="icon" variant="ghost" className="size-7" onClick={onClick} aria-label="Copy">
      {done ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}
