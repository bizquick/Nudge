// flagem.app website. Serves the pages in site/, and forwards the old
// nudgem.app address to the same page on flagem.app — except Apple's link file,
// which must be answered directly (Apple doesn't follow forwards for it).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isOldDomain = url.hostname === 'nudgem.app' || url.hostname === 'www.nudgem.app';
    if (isOldDomain && !url.pathname.startsWith('/.well-known/')) {
      return Response.redirect(`https://flagem.app${url.pathname}${url.search}`, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
