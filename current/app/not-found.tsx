import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { buttonStyles } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="max-w-xl text-center">
        <div className="flex justify-center"><BrandLogo size="lg" /></div>
        <p className="mt-10 text-sm font-bold text-brand">404 · Page not found</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-content">This opportunity isn&apos;t here.</h1>
        <p className="mt-4 leading-7 text-secondary">The page may have moved, or the address may be incorrect.</p>
        <Link href="/" className={buttonStyles("primary", "mt-8")}>Back to Home</Link>
      </div>
    </main>
  );
}
