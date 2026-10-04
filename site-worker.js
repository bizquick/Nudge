// addlyapp.com website. Serves the pages in site/, and forwards the old
// flagem.app and nudgem.app addresses to the same page on addlyapp.com — except
// Apple's link file, which must be answered directly (Apple doesn't follow forwards for it).
const OLD_DOMAINS = ['flagem.app', 'www.flagem.app', 'nudgem.app', 'www.nudgem.app'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isOldDomain = OLD_DOMAINS.includes(url.hostname) || url.hostname === 'www.addlyapp.com';
    if (isOldDomain && !url.pathname.startsWith('/.well-known/')) {
      return Response.redirect(`https://addlyapp.com${url.pathname}${url.search}`, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
