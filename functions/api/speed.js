/**
 * functions/api/speed.js
 * 
 * Cloudflare Pages Function acting as a proxy to the Google PageSpeed Insights API.
 * This keeps the API key entirely on the server side.
 * 
 * Expected query parameters:
 * - url (required): The URL to test
 * - strategy (optional): "mobile" or "desktop" (defaults to mobile)
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  const targetUrl = url.searchParams.get("url");
  const strategy = url.searchParams.get("strategy") || "mobile";
  
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // The API Key should be set as an environment variable in Cloudflare Pages dashboard: PSI_API_KEY
  // If not set (like in local dev), it will still work for low volume requests without a key, 
  // but it's highly recommended to provide the key.
  const apiKey = env.PSI_API_KEY || ""; 
  
  // Forward category parameters if provided
  const categories = url.searchParams.getAll("category");
  let categoryString = "";
  if (categories.length > 0) {
    categoryString = categories.map(c => `&category=${c}`).join('');
  } else {
    // Default to just performance if none requested
    categoryString = "&category=performance";
  }

  let psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=${strategy}${categoryString}`;
  
  if (apiKey) {
    psiUrl += `&key=${apiKey}`;
  }

  try {
    const res = await fetch(psiUrl, {
      headers: {
        "Referer": "https://companiesbuilder.com/"
      }
    });
    
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `PageSpeed API Error: ${res.statusText}` }), {
        status: res.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const data = await res.json();
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        // Add cache control if you want to cache results at the edge
        "Cache-Control": "public, max-age=300"
      }
    });
    
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch from PageSpeed API", details: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
