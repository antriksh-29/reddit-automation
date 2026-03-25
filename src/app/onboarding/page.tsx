export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-2xl space-y-8 text-center">
        <h1 className="font-[Satoshi] text-3xl font-bold text-text-primary">
          Welcome to RedditIntel
        </h1>
        <p className="text-text-secondary">
          Let&apos;s set up your business profile. This takes about 2 minutes.
        </p>
        {/* Full onboarding wizard built in Phase 2 */}
      </div>
    </div>
  );
}
