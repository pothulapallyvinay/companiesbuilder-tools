/**
 * functions/api/audit.js
 * 
 * Cloudflare Pages Function for SEO Auditor.
 * Uses HTMLRewriter to fetch and parse external websites safely.
 */

export async function onRequestGet(context) {
  const { request } = context;
  const urlParams = new URL(request.url).searchParams;
  const targetUrl = urlParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    let fetchUrl = targetUrl;
    if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
      fetchUrl = 'https://' + fetchUrl;
    }

    const res = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CB-Auditor/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch target URL. Status: ${res.status}` }), { 
        status: res.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const auditData = {
      title: null,
      metaDescription: null,
      canonical: null,
      h1Count: 0,
      h2Count: 0,
      h3Count: 0,
      imagesTotal: 0,
      imagesMissingAlt: 0,
      linksTotal: 0,
      linksInternal: 0,
      linksExternal: 0,
      linksBroken: 0,
      ogTags: 0,
      twitterTags: 0,
      wordCount: 0
    };

    let wordCount = 0;

    const rewriter = new HTMLRewriter()
      .on('title', {
        text(text) {
          if (!auditData.title) auditData.title = "";
          auditData.title += text.text;
        }
      })
      .on('meta', {
        element(element) {
          const name = (element.getAttribute('name') || '').toLowerCase();
          const property = (element.getAttribute('property') || '').toLowerCase();
          const content = element.getAttribute('content') || '';
          
          if (name === 'description') {
            auditData.metaDescription = content;
          }
          if (property.startsWith('og:')) {
            auditData.ogTags++;
          }
          if (name.startsWith('twitter:')) {
            auditData.twitterTags++;
          }
        }
      })
      .on('link', {
        element(element) {
          if ((element.getAttribute('rel') || '').toLowerCase() === 'canonical') {
            auditData.canonical = element.getAttribute('href');
          }
        }
      })
      .on('h1', { element() { auditData.h1Count++; } })
      .on('h2', { element() { auditData.h2Count++; } })
      .on('h3', { element() { auditData.h3Count++; } })
      .on('img', {
        element(element) {
          auditData.imagesTotal++;
          const alt = element.getAttribute('alt');
          if (alt === null || alt.trim() === '') {
            auditData.imagesMissingAlt++;
          }
        }
      })
      .on('a', {
        element(element) {
          auditData.linksTotal++;
          const href = element.getAttribute('href') || '';
          if (href === '#' || href.startsWith('javascript:')) {
            auditData.linksBroken++;
          } else if (href.startsWith('http')) {
            try {
              const linkUrl = new URL(href);
              const tUrl = new URL(fetchUrl);
              if (linkUrl.hostname === tUrl.hostname) {
                auditData.linksInternal++;
              } else {
                auditData.linksExternal++;
              }
            } catch (e) {
              auditData.linksBroken++;
            }
          } else {
            auditData.linksInternal++; 
          }
        }
      })
      .on('p, span, div, h1, h2, h3, h4, h5, h6, li, a', {
        text(text) {
          // A very rough word count estimation
          if (text.text && text.text.trim().length > 0) {
            const words = text.text.trim().split(/\s+/);
            if (words[0] !== '') {
               wordCount += words.length;
            }
          }
        }
      });

    // Pass the response through the rewriter
    const transformedResponse = rewriter.transform(res);
    await transformedResponse.arrayBuffer(); // consume the stream to execute handlers

    if (auditData.title) auditData.title = auditData.title.trim();
    auditData.wordCount = wordCount;

    // Calculate an On-Page SEO Score
    let score = 100;
    const actionPlan = [];

    if (!auditData.title) {
      score -= 20;
      actionPlan.push({ id: 'missing-title', icon: 'bi-search', title: 'Missing Title Tag', description: 'Your page does not have a <title> tag.', aiFix: 'Add a title tag that includes your primary keyword.' });
    } else if (auditData.title.length < 10 || auditData.title.length > 60) {
      score -= 10;
      actionPlan.push({ id: 'title-length', icon: 'bi-search', title: 'Non-optimal Title Length', description: `Title is ${auditData.title.length} chars (aim for 50-60).`, aiFix: 'Rewrite your title to be concise and click-worthy.' });
    }

    if (!auditData.metaDescription) {
      score -= 20;
      actionPlan.push({ id: 'missing-desc', icon: 'bi-card-text', title: 'Missing Meta Description', description: 'No meta description found.', aiFix: 'Add a compelling description (150-160 characters).' });
    } else if (auditData.metaDescription.length < 50 || auditData.metaDescription.length > 160) {
      score -= 10;
      actionPlan.push({ id: 'desc-length', icon: 'bi-card-text', title: 'Non-optimal Description Length', description: `Description is ${auditData.metaDescription.length} chars (aim for 150-160).`, aiFix: 'Expand or trim your description so it doesn\'t get cut off in Google.' });
    }

    if (auditData.h1Count === 0) {
      score -= 15;
      actionPlan.push({ id: 'missing-h1', icon: 'bi-type-h1', title: 'Missing H1 Tag', description: 'No H1 tag found on the page.', aiFix: 'Ensure your main headline is wrapped in an H1 tag.' });
    } else if (auditData.h1Count > 1) {
      score -= 5;
      actionPlan.push({ id: 'multiple-h1', icon: 'bi-type-h1', title: 'Multiple H1 Tags', description: `Found ${auditData.h1Count} H1 tags.`, aiFix: 'Use only one H1 tag per page for the best SEO clarity.' });
    }

    if (auditData.imagesMissingAlt > 0) {
      const penalty = Math.min(15, auditData.imagesMissingAlt * 2);
      score -= penalty;
      actionPlan.push({ id: 'missing-alt', icon: 'bi-image', title: 'Missing Image Alt Text', description: `${auditData.imagesMissingAlt} images lack alt text.`, aiFix: 'Add descriptive alt text to all images for accessibility and image search SEO.' });
    }

    if (!auditData.canonical) {
      score -= 5;
      actionPlan.push({ id: 'missing-canonical', icon: 'bi-link-45deg', title: 'Missing Canonical Tag', description: 'No canonical URL defined.', aiFix: 'Add a canonical tag to prevent duplicate content issues.' });
    }
    
    if (auditData.ogTags === 0) {
      score -= 5;
      actionPlan.push({ id: 'missing-og', icon: 'bi-share', title: 'Missing Open Graph Tags', description: 'No social media sharing tags found.', aiFix: 'Add OG tags to control how your link looks on Facebook and LinkedIn.' });
    }

    if (auditData.wordCount < 300) {
      score -= 10;
      actionPlan.push({ id: 'thin-content', icon: 'bi-file-text', title: 'Thin Content', description: `Only ~${auditData.wordCount} words detected.`, aiFix: 'Search engines prefer in-depth content. Aim for at least 500-1000 words.' });
    }

    auditData.seoScore = Math.max(0, score);
    auditData.actionPlan = actionPlan;

    return new Response(JSON.stringify(auditData), {
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
