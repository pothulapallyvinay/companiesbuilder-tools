/**
 * functions/api/local-seo.js
 * 
 * Cloudflare Pages Function for Local SEO Checker.
 * Performs an on-page scan for LocalBusiness schema, phone numbers, and addresses.
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
    
    const res = await fetch(targetUrlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CB-LocalBot/1.0',
        'Accept': 'text/html'
      }
    });
    
    if (!res.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch target URL. Status: ${res.status}` }), { status: res.status });
    }

    const data = {
      hasSchema: false,
      schemaDetails: null,
      hasPhone: false,
      hasAddress: false,
      mapEmbeds: 0,
      gmbLinks: 0
    };

    let bodyText = "";

    const rewriter = new HTMLRewriter()
      .on('script[type="application/ld+json"]', {
        text(text) {
          try {
            const json = JSON.parse(text.text);
            const checkSchema = (obj) => {
              if (!obj) return;
              if (Array.isArray(obj)) {
                obj.forEach(checkSchema);
              } else if (typeof obj === 'object') {
                if (obj['@type'] && (obj['@type'] === 'LocalBusiness' || obj['@type'].includes('LocalBusiness') || obj['@type'] === 'Organization')) {
                  data.hasSchema = true;
                  data.schemaDetails = obj['@type'];
                }
                Object.values(obj).forEach(checkSchema);
              }
            };
            checkSchema(json);
          } catch (e) {
            // Ignore parse errors from partial text chunks
          }
        }
      })
      .on('a', {
        element(element) {
          const href = (element.getAttribute('href') || '').toLowerCase();
          if (href.startsWith('tel:')) data.hasPhone = true;
          if (href.includes('google.com/maps') || href.includes('maps.app.goo.gl')) data.gmbLinks++;
        }
      })
      .on('iframe', {
        element(element) {
          const src = (element.getAttribute('src') || '').toLowerCase();
          if (src.includes('google.com/maps/embed')) data.mapEmbeds++;
        }
      })
      .on('body', {
        text(text) {
          bodyText += text.text + " ";
        }
      });

    await rewriter.transform(res).arrayBuffer();

    // Fallback regex checks on body text
    if (!data.hasPhone) {
      // Basic check for phone numbers like (123) 456-7890 or +1-234-567-8900
      const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
      if (phoneRegex.test(bodyText)) data.hasPhone = true;
    }

    // Basic check for addresses (looking for zip codes and common street terms)
    const addressRegex = /\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln)\b/i;
    if (addressRegex.test(bodyText)) data.hasAddress = true;

    let score = 100;
    const actionPlan = [];

    if (!data.hasSchema) {
      score -= 30;
      actionPlan.push({ title: 'Missing LocalBusiness Schema', description: 'No LocalBusiness or Organization structured data found.', aiFix: 'Add JSON-LD schema markup so Google clearly understands your business name, address, and phone number.' });
    }

    if (!data.hasPhone) {
      score -= 20;
      actionPlan.push({ title: 'No Phone Number Detected', description: 'Could not find a clickable tel: link or formatted phone number.', aiFix: 'Add your business phone number to the header/footer and make it a clickable tel: link for mobile users.' });
    }

    if (data.mapEmbeds === 0 && data.gmbLinks === 0) {
      score -= 20;
      actionPlan.push({ title: 'No Google Maps Integration', description: 'No embedded Google Map or link to a Google My Business profile found.', aiFix: 'Embed a Google Map of your physical location in your footer or contact page to boost local relevance.' });
    }

    if (!data.hasAddress) {
      score -= 10;
      actionPlan.push({ title: 'No Physical Address Detected', description: 'Could not confidently detect a street address.', aiFix: 'Ensure your full physical address (matching your GMB profile) is plainly visible in your footer.' });
    }
    
    if (actionPlan.length === 0) {
        actionPlan.push({ title: 'Excellent Local Signals', description: 'Your on-page local SEO looks great.', aiFix: 'Keep your Google My Business profile updated with fresh photos and reviews.' });
    }

    data.score = Math.max(0, score);
    data.actionPlan = actionPlan;

    return new Response(JSON.stringify(data), {
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
