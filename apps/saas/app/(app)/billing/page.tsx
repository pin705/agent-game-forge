import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCreditSummary } from "@/lib/billing/account";
import { CREDIT_PACKS } from "@/lib/billing/packs";
import { TopUpPanel } from "@/components/top-up-panel";

// Per-request: balance is user-scoped.
export const dynamic = "force-dynamic";

/**
 * /billing — buy credits via SePay/VietQR (§5 top-up). Lists the credit packs
 * and drives the pick → QR → poll → success flow (TopUpPanel). Lives under the
 * (app) group so it inherits the protected layout + TopNav (and its auth guard).
 */
export default async function BillingPage() {
  const { balance } = await getCreditSummary();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Quay lại (Back)
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nạp credits (Top up)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Chọn một gói và thanh toán bằng VietQR. (Pick a pack and pay via VietQR.)
          </p>
        </div>
        {balance !== null && (
          <p className="text-sm text-muted-foreground">
            Số dư hiện tại (Balance):{" "}
            <span className="font-medium text-foreground tabular-nums">{balance}</span> credits
          </p>
        )}
      </div>

      <TopUpPanel packs={[...CREDIT_PACKS]} />
    </main>
  );
}
