export default function AuthLoading() {
  return (
    <main className="min-h-screen animate-pulse bg-background px-5 py-6">
      <div className="mx-auto h-12 w-52 rounded-lg bg-panel-hover" />
      <div className="mx-auto mt-24 w-full max-w-md rounded-2xl border border-line bg-panel p-8">
        <div className="h-5 w-36 rounded bg-panel-hover" />
        <div className="mt-7 h-9 w-72 max-w-full rounded bg-panel-hover" />
        <div className="mt-4 h-4 w-full rounded bg-panel-raised" />
        {[1, 2, 3].map((item) => <div key={item} className="mt-6 h-11 rounded-lg bg-panel-raised" />)}
      </div>
    </main>
  );
}
