/**
 * functions/api/sitemap.js
 * 
 * Cloudflare Pages Function for Sitemap Generator.
 * Crawls up to 40 pages (due to CF Worker 50 subrequest limit).
 */

export async function onRequestGet(context) {
  const { request } = context;
  const urlParams = new URL(request.url).searchParams;
  let targetUrlStr = urlParams.get('url');

  if (!targetUrlStr) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    if (!targetUrlStr.startsWith('http://') && !targetUrlStr.startsWith('https://')) {
      targetUrlStr = 'https://' + targetUrlStr;
    }
    
    const startUrl = new URL(targetUrlStr);
    const domain = startUrl.hostname;
    
    const MAX_PAGES = 40; // CF worker subrequest limit is 50
    const MAX_DEPTH = 2;
    
    const visited = new Set();
    const queue = [{ url: startUrl.href, depth: 0 }];
    const sitemapUrls = new Set();
    
    let subrequests = 0;

    while (queue.length > 0 && visited.size < MAX_PAGES && subrequests < MAX_PAGES) {
      // Take up to 5 URLs to process concurrently
      const batch = queue.splice(0, 5);
      const fetchPromises = [];
      
      for (const item of batch) {
        if (visited.has(item.url)) continue;
        visited.add(item.url);
        
        if (subrequests >= MAX_PAGES) break;
        subrequests++;
        
        const promise = (async () => {
          try {
            const res = await fetch(item.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CB-SitemapBot/1.0',
                'Accept': 'text/html'
              }
            });
            
            if (!res.ok) return null;
            
            // Only parse HTML
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('text/html')) {
                sitemapUrls.add(item.url);
                return null;
            }

            sitemapUrls.add(item.url);
            
            const newLinks = [];
            
            if (item.depth < MAX_DEPTH) {
              const rewriter = new HTMLRewriter().on('a', {
                element(element) {
                  const href = element.getAttribute('href');
                  if (!href) return;
                  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('#')) return;
                  
                  try {
                    // Resolve relative URLs
                    const resolved = new URL(href, item.url);
                    // Strip fragments
                    resolved.hash = '';
                    
                    if (resolved.hostname === domain) {
                      newLinks.push(resolved.href);
                    }
                  } catch (e) {
                    // Invalid URL format
                  }
                }
              });
              
              await rewriter.transform(res).arrayBuffer();
            }
            return { depth: item.depth, links: newLinks };
          } catch (e) {
            return null;
          }
        })();
        
        fetchPromises.push(promise);
      }
      
      const results = await Promise.all(fetchPromises);
      
      for (const result of results) {
        if (result && result.links) {
          for (const link of result.links) {
            if (!visited.has(link) && !queue.find(q => q.url === link)) {
              queue.push({ url: link, depth: result.depth + 1 });
            }
          }
        }
      }
    }
    
    // Generate XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    for (const url of sitemapUrls) {
      xml += '  <url>\n';
      xml += `    <loc>${escapeXml(url)}</loc>\n`;
      xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      // Prioritize homepage
      const priority = url === startUrl.href ? '1.0' : '0.8';
      xml += `    <priority>${priority}</priority>\n`;
      xml += '  </url>\n';
    }
    xml += '</urlset>';

    return new Response(JSON.stringify({
      success: true,
      pagesFound: sitemapUrls.size,
      xml: xml
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
        }
    });
}
