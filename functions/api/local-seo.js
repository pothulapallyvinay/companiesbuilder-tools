const MAX_RESPONSE_BYTES = 1500000;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 10000;
const LOCAL_BUSINESS_TYPES = new Set([
  'localbusiness', 'animalhospital', 'animalShelter', 'automotivebusiness',
  'childcare', 'dentist', 'drycleaningorlaundry', 'emergencyservice',
  'employmentagency', 'entertainmentbusiness', 'financialservice',
  'foodestablishment', 'governmentoffice', 'healthandbeautybusiness',
  'homeandconstructionbusiness', 'internetcafe', 'legalservice', 'library',
  'lodgingbusiness', 'medicalbusiness', 'professionalservice',
  'radioStation', 'realestateagent', 'recyclingcenter', 'selfstorage',
  'shoppingcenter', 'sportsactivitylocation', 'store', 'touristinformationcenter',
  'travelagency', 'restaurant', 'medicalclinic'
].map((type) => type.toLowerCase()));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function isBlockedIPv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 203 && second === 0);
}

function parsePublicUrl(value) {
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter a public HTTP or HTTPS webpage URL.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const isIPv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  if (hostname.startsWith('[') || isIPv4 || !hostname.includes('.') ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname.endsWith('.test') || isBlockedIPv4(hostname)) {
    throw new Error('Enter a public website hostname, not a local or private address.');
  }
  if (url.port) throw new Error('Use a website on its standard HTTP or HTTPS port.');
  return url;
}

async function fetchPublicPage(initialUrl, requestUrl, signal) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (currentUrl.origin === requestUrl.origin && currentUrl.pathname.startsWith('/tools/api/')) {
      throw new Error('The checker API cannot be audited as a target page.');
    }

    const response = await fetch(currentUrl.toString(), {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CompaniesBuilderLocalChecker/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('The webpage redirected too many times or returned an invalid redirect.');
      }
      currentUrl = parsePublicUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) throw new Error('The webpage could not be retrieved. Check that it is public and available.');
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error('The URL did not return an HTML webpage.');
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('The webpage is too large to check. Try a smaller public page.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('The webpage returned an empty response.');
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('The webpage is too large to check. Try a smaller public page.');
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { response, html: new TextDecoder().decode(bytes), url: currentUrl };
  }

  throw new Error('The webpage could not be retrieved.');
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function hasAddressValue(address) {
  if (typeof address === 'string') return address.trim().length > 0;
  if (!address || typeof address !== 'object') return false;
  return ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry']
    .some((key) => hasValue(address[key]));
}

function collectLocalBusinessData(value, output) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalBusinessData(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  const matchedTypes = types.filter((type) => {
    if (typeof type !== 'string') return false;
    const normalizedType = type.split(/[\/#]/).pop().toLowerCase();
    return LOCAL_BUSINESS_TYPES.has(normalizedType);
  });

  if (matchedTypes.length) {
    output.types.push(...matchedTypes);
    output.fields.name ||= hasValue(value.name);
    output.fields.address ||= hasAddressValue(value.address);
    output.fields.telephone ||= hasValue(value.telephone);
    output.fields.url ||= hasValue(value.url);
    output.fields.openingHours ||= hasValue(value.openingHours) || hasValue(value.openingHoursSpecification);
    output.fields.geo ||= hasValue(value.geo);
    output.fields.sameAs ||= hasValue(value.sameAs);
  }

  Object.values(value).forEach((item) => collectLocalBusinessData(item, output));
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const rawTarget = requestUrl.searchParams.get('url');
  if (!rawTarget || !rawTarget.trim()) return jsonResponse({ error: 'Enter a complete public webpage URL, such as https://example.com/.' }, 400);

  let targetUrl;
  try {
    targetUrl = parsePublicUrl(rawTarget);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { response, html, url: finalUrl } = await fetchPublicPage(targetUrl, requestUrl, controller.signal);
    const data = {
      checkedUrl: finalUrl.toString(),
      hasSchema: false,
      schemaTypes: [],
      schemaParseErrors: 0,
      schemaFields: { name: false, address: false, telephone: false, url: false, openingHours: false, geo: false, sameAs: false },
      hasPhone: false,
      phoneEvidence: null,
      hasAddress: false,
      addressEvidence: null,
      mapEmbeds: 0,
      mapsLinks: 0
    };
    const schemaData = { types: [], fields: data.schemaFields };
    let bodyText = '';
    let schemaBuffer = null;

    const transformed = new HTMLRewriter()
      .on('script[type="application/ld+json"]', {
        element(element) {
          schemaBuffer = '';
          element.onEndTag(() => {
            const source = schemaBuffer;
            schemaBuffer = null;
            if (!source || !source.trim()) return;
            try {
              collectLocalBusinessData(JSON.parse(source), schemaData);
            } catch {
              data.schemaParseErrors++;
            }
          });
        },
        text(text) {
          if (schemaBuffer !== null) schemaBuffer += text.text;
        }
      })
      .on('a', {
        element(element) {
          const href = (element.getAttribute('href') || '').trim();
          const normalizedHref = href.toLowerCase();
          if (normalizedHref.startsWith('tel:')) {
            data.hasPhone = true;
            data.phoneEvidence = 'telephone link';
          }
          if (/google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(normalizedHref)) data.mapsLinks++;
        }
      })
      .on('iframe', {
        element(element) {
          const src = (element.getAttribute('src') || '').toLowerCase();
          if (/google\.[^/]+\/maps\/embed|maps\.googleapis\.com\/maps/i.test(src)) data.mapEmbeds++;
        }
      })
      .on('body', {
        text(text) {
          bodyText += `${text.text} `;
        }
      });

    await transformed.transform(new Response(html, {
      headers: { 'Content-Type': response.headers.get('content-type') || 'text/html; charset=utf-8' }
    })).arrayBuffer();

    data.hasSchema = schemaData.types.length > 0;
    data.schemaTypes = [...new Set(schemaData.types)];
    if (!data.hasPhone && schemaData.fields.telephone) {
      data.hasPhone = true;
      data.phoneEvidence = 'LocalBusiness structured data';
    }
    if (!data.hasPhone) {
      const phonePattern = /(?:\+?\d{1,3}[\s().-]*)?(?:\(?\d{2,5}\)?[\s().-]*)?\d{3,5}[\s.-]?\d{4}/g;
      const phoneMatch = bodyText.match(phonePattern)?.find((match) => {
        const digitCount = match.replace(/\D/g, '').length;
        return digitCount >= 10 && digitCount <= 15;
      });
      if (phoneMatch) {
        data.hasPhone = true;
        data.phoneEvidence = 'number-like text';
      }
    }

    if (schemaData.fields.address) {
      data.hasAddress = true;
      data.addressEvidence = 'LocalBusiness structured data';
    } else {
      const streetPattern = /\b(?:street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|nagar|colony|layout|sector)\b/i;
      const postalPattern = /\b\d{6}\b/;
      if (streetPattern.test(bodyText) || postalPattern.test(bodyText)) {
        data.hasAddress = true;
        data.addressEvidence = 'address-like page text';
      }
    }

    const signalCount = [data.hasSchema, data.hasPhone, data.hasAddress, data.mapEmbeds > 0 || data.mapsLinks > 0]
      .filter(Boolean).length;
    data.score = signalCount * 25;
    data.scoreBreakdown = [
      { label: 'LocalBusiness structured data', points: data.hasSchema ? 25 : 0, possiblePoints: 25 },
      { label: 'Phone signal', points: data.hasPhone ? 25 : 0, possiblePoints: 25 },
      { label: 'Address signal', points: data.hasAddress ? 25 : 0, possiblePoints: 25 },
      { label: 'Google Maps link or embed', points: data.mapEmbeds > 0 || data.mapsLinks > 0 ? 25 : 0, possiblePoints: 25 }
    ];
    data.actionPlan = [];

    if (!data.hasSchema) {
      data.actionPlan.push({ priority: 'Recommended', title: data.schemaParseErrors ? 'Review structured data syntax' : 'Check for LocalBusiness structured data', description: data.schemaParseErrors ? 'At least one JSON-LD block could not be parsed. Validate it before relying on its business details.' : 'No supported LocalBusiness type was detected in the JSON-LD on this page.', recommendation: 'Where appropriate, add accurate LocalBusiness structured data to a page that describes the business. Use only details that are visible and correct.' });
    }
    if (!data.hasPhone) {
      data.actionPlan.push({ priority: 'Recommended', title: 'Review contact details', description: 'A phone number was not detected in a telephone link, supported business data, or number-like page text.', recommendation: 'If customers contact the business by phone, show its current number on a relevant contact or location page and make it easy to use on mobile.' });
    }
    if (!data.hasAddress) {
      data.actionPlan.push({ priority: 'Review', title: 'Review location information', description: 'No address was detected in supported business data or common address-like page text.', recommendation: 'If the business serves customers at a physical location, make its accurate address easy to find. Do not publish a residential or service-area address that should remain private.' });
    }
    if (!data.mapEmbeds && !data.mapsLinks) {
      data.actionPlan.push({ priority: 'Optional', title: 'Consider a useful map link', description: 'No Google Maps link or embedded map was detected on this page.', recommendation: 'If visitors need directions to a public business location, consider linking to a useful map. A map is a visitor aid, not proof of rankings.' });
    }
    if (!data.actionPlan.length) {
      data.actionPlan.push({ priority: 'Manual review', title: 'Confirm details beyond this page', description: 'All four website signals checked here were detected.', recommendation: 'Verify that the information is accurate and review your Google Business Profile and other local-search factors separately.' });
    }

    return jsonResponse(data);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'The webpage took too long to respond. Try again later.'
      : error.message || 'The webpage could not be checked.';
    return jsonResponse({ error: message }, error?.name === 'AbortError' ? 504 : 502);
  } finally {
    clearTimeout(timeout);
  }
}
