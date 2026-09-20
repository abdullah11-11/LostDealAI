import Link from "next/link";
import Image from "next/image";

export function BrandLogo({
  compact = false,
  size = "md",
}: {
  compact?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const fullSizes = size === "lg" ? "h-12 w-[242px] sm:h-14 sm:w-[282px]" : size === "sm" ? "h-7 w-[141px]" : "h-9 w-[181px]";
  const iconSizes = size === "lg" ? "size-12" : size === "sm" ? "size-8" : "size-9";

  return (
    <Link
      href="/"
      aria-label="LostDeal AI home"
      className="inline-flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {compact ? (
        <Image src="/lostdeal-icon.png" width={512} height={512} alt="" aria-hidden="true" sizes="48px" className={`${iconSizes} object-contain`} />
      ) : (
        <span className={`relative block shrink-0 ${fullSizes}`}>
          <Image src="/lostdeal-wordmark-light.webp" fill alt="LostDeal AI" sizes="282px" className="theme-logo-light object-contain object-left" priority={size === "lg"} />
          <Image src="/lostdeal-wordmark-dark.webp" fill alt="" aria-hidden="true" sizes="282px" className="theme-logo-dark object-contain object-left" priority={size === "lg"} />
        </span>
      )}
    </Link>
  );
}
