/**
 * shared.js
 * Contains shared logic for the SEO Tools Suite including the usage limitation
 * business logic (5 free attempts for backend tools) and cross-promotion.
 */

const MAX_FREE_ATTEMPTS = 5;

// List of premium tools that are subject to the usage limit
const LIMITED_TOOLS = [
  'seo-auditor',
  'sitemap-generator',
  'speed-checker',
  'local-seo-checker'
];

/**
 * Gets the current usage count for a specific tool
 */
function getUsageCount(toolName) {
  if (!LIMITED_TOOLS.includes(toolName)) return 0; // Free tools don't have limits
  
  const usageData = JSON.parse(localStorage.getItem('companiesbuilder_tools_usage') || '{}');
  return usageData[toolName] || 0;
}

/**
 * Increments the usage count for a specific tool
 */
function incrementUsage(toolName) {
  if (!LIMITED_TOOLS.includes(toolName)) return;

  const usageData = JSON.parse(localStorage.getItem('companiesbuilder_tools_usage') || '{}');
  usageData[toolName] = (usageData[toolName] || 0) + 1;
  localStorage.setItem('companiesbuilder_tools_usage', JSON.stringify(usageData));
}

/**
 * Checks if the user is allowed to run the tool.
 * Automatically updates the UI if the limit is reached.
 * 
 * @param {string} toolName - The identifier of the tool
 * @param {string} runButtonId - The DOM ID of the primary run button
 * @param {string} bannerContainerId - The DOM ID where the limit banner should be injected
 * @returns {boolean} - True if allowed, false if limit reached
 */
function checkLimitAndUpdateUI(toolName, runButtonId, bannerContainerId) {
  if (!LIMITED_TOOLS.includes(toolName)) return true;

  const currentCount = getUsageCount(toolName);
  
  // Show remaining attempts UI if not yet reached
  const bannerContainer = document.getElementById(bannerContainerId);
  
  if (currentCount >= MAX_FREE_ATTEMPTS) {
    const runBtn = document.getElementById(runButtonId);
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerHTML = 'Limit Reached (5/5)';
    }

    if (bannerContainer) {
      bannerContainer.innerHTML = `
        <div class="limit-banner active">
          <div>
            <div class="limit-text">Free Limit Reached!</div>
            <div style="font-size: 0.85rem; color: #d1d5db; margin-top: 4px;">
              You have used your 5 free attempts for this premium tool. Contact us for full access to our entire SEO suite.
            </div>
          </div>
          <a href="https://companiesbuilder.com/contact/" target="_blank" class="btn">Get Full Access</a>
        </div>
      `;
    }
    return false;
  } else {
    // Show remaining attempts
    const remaining = MAX_FREE_ATTEMPTS - currentCount;
    if (bannerContainer && (toolName === 'seo-auditor' || toolName === 'local-seo-checker')) {
      bannerContainer.innerHTML = `
        <div style="background: rgba(var(--accent-primary-rgb), 0.1); border: 1px solid var(--accent-primary); border-radius: 8px; padding: 0.75rem; text-align: center; margin-bottom: 1.5rem;">
          <span style="color: var(--accent-primary); font-weight: 600;"><i class="bi bi-info-circle me-2"></i> ${remaining} free attempt${remaining !== 1 ? 's' : ''} remaining</span>
        </div>
      `;
    }
  }
  return true;
}

/**
 * Increments and immediately updates UI
 */
function incrementAndCheckLimit(toolName, runButtonId, bannerContainerId) {
    incrementUsage(toolName);
    return checkLimitAndUpdateUI(toolName, runButtonId, bannerContainerId);
}

/**
 * Displays a cross-promotion alert when an issue is found.
 * 
 * @param {string} issueType - The type of issue (e.g., 'speed', 'meta')
 * @param {string} containerId - The DOM ID to inject the alert into
 * @param {string} currentToolId - The ID of the tool currently being used
 */
function showCrossPromotion(issueType, containerId, currentToolId = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let content = '';
  
  switch(issueType) {
    case 'speed':
      if (currentToolId === 'speed-checker') {
        content = `
          <div style="font-weight: 600; margin-bottom: 0.25rem;">We detected slow loading times.</div>
          <div style="font-size: 0.9rem; margin-bottom: 0.75rem;">A slow site kills rankings and user experience. Let our technical SEO experts optimize it for you.</div>
          <div style="display: flex; gap: 1rem;">
            <a href="/seo-auditor/" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Run Full SEO Audit</a>
            <a href="https://companiesbuilder.com/services/" class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">View SEO Services</a>
          </div>
        `;
      } else {
        content = `
          <div style="font-weight: 600; margin-bottom: 0.25rem;">We detected slow loading times.</div>
          <div style="font-size: 0.9rem; margin-bottom: 0.75rem;">A slow site kills rankings. Use our dedicated Speed Checker for a deep dive, or let our experts fix it.</div>
          <div style="display: flex; gap: 1rem;">
            <a href="/speed-checker/" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Run Speed Check</a>
            <a href="https://companiesbuilder.com/services/" class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">View SEO Services</a>
          </div>
        `;
      }
      break;
    case 'meta':
      content = `
        <div style="font-weight: 600; margin-bottom: 0.25rem;">Missing or unoptimized Meta Tags.</div>
        <div style="font-size: 0.9rem; margin-bottom: 0.75rem;">Fix your snippets to improve CTR. Use our free Meta Tag Generator to craft perfect tags.</div>
        <a href="/tools/meta-tag-generator/" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Go to Generator</a>
      `;
      break;
    // Add more cases as needed
    default:
      content = `
        <div style="font-weight: 600; margin-bottom: 0.25rem;">Need help fixing these issues?</div>
        <div style="font-size: 0.9rem; margin-bottom: 0.75rem;">Our SEO experts at Companies Builder can resolve these errors and boost your rankings.</div>
        <a href="https://companiesbuilder.com/services/" class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">View Our Services</a>
      `;
  }

  container.innerHTML = `
    <div class="cross-promo-alert" style="display: block;">
      ${content}
    </div>
  `;
}

// Export for module usage or attach to window for plain script tags
window.CompaniesBuilderTools = {
  checkLimitAndUpdateUI,
  incrementUsage,
  getUsageCount,
  getAttempts: getUsageCount,
  incrementAndCheckLimit,
  showCrossPromotion,
  MAX_FREE_ATTEMPTS
};
