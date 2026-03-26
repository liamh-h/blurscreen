class SensitiveDetector {
  static PATTERNS = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(?<![\/\w])(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    money: /[$\u20AC\u00A3\u00A5]\s?\d{1,3}(,\d{3})*(\.\d{2})?/g,
    creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    apiKey: /(?:^|[\s"'`=:,({])(?:sk|pk|api[_-]?key|access[_-]?token|secret[_-]?key|password|bearer)[_-][a-zA-Z0-9]{20,}/gim,
    ipAddress: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  };

  // Luhn check for credit card false-positive reduction
  static isLuhn(num) {
    const digits = num.replace(/\D/g, '').split('').reverse().map(Number);
    if (digits.length !== 16) return false;
    const sum = digits.reduce((acc, d, i) => {
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      return acc + d;
    }, 0);
    return sum % 10 === 0;
  }

  static scan(root) {
    const results = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('.blurscreen-ui')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('.blurscreen-blurred')) return NodeFilter.FILTER_REJECT;
          if (node.textContent.trim().length < 3) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      const text = textNode.textContent;
      const matches = [];
      for (const [type, regex] of Object.entries(this.PATTERNS)) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const matchText = match[0].trim();
          // Post-filter: credit card Luhn check
          if (type === 'creditCard' && !this.isLuhn(matchText)) continue;
          // Post-filter: skip very short matches
          if (matchText.length < 4) continue;
          matches.push({ text: matchText, type, index: match.index });
        }
      }
      if (matches.length > 0) {
        // Deduplicate overlapping matches, keep longest
        const deduped = [];
        matches.sort((a, b) => a.index - b.index);
        for (const m of matches) {
          const last = deduped[deduped.length - 1];
          if (last && m.index < last.index + last.text.length) {
            // Overlapping — keep the longer one
            if (m.text.length > last.text.length) deduped[deduped.length - 1] = m;
          } else {
            deduped.push(m);
          }
        }
        // Sort descending by index for end-to-start processing
        deduped.sort((a, b) => b.index - a.index);
        results.push({ node: textNode, matches: deduped });
      }
    }
    return results;
  }
}
