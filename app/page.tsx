export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <header className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight">
            AdSpark
          </h1>
          <p className="mt-2 text-lg text-gray-400">
            Creative Automation for Social Ad Campaigns
          </p>
        </header>

        {/* TODO: BriefForm, CreativeGallery, PipelineProgress, D3Charts */}
        <section className="rounded-xl border border-gray-800 bg-gray-900 p-8">
          <p className="text-gray-500">
            Pipeline dashboard coming soon. Upload a campaign brief to generate
            ad creatives across 3 aspect ratios.
          </p>
        </section>
      </div>
    </main>
  );
}
