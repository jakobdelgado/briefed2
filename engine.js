/**
 * BRIEFED — LOCAL LEGAL EXTRACTION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure Node.js. Zero external AI dependencies. Zero API keys.
 * Deterministic rule-based NLP tuned to common law judgment structure.
 *
 * Pipeline:
 *   raw text → clean → segment → metadata → 7-section extract → normalise → JSON
 */

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const JUDICIAL_TITLES = [
  'CJ','ACJ','JA','JJA','JJ','FCJ','NPJ','DPFJ',
  'J','LJ','LJJ','MR','VP','P','Baron','Baroness',
  'Lord','Lady','Sir','Dame','Justice','Judge',
];

// Regex: match "Surname J" or "Lord Surname" etc.
const JUDGE_LINE_RX = new RegExp(
  '(?:^|\\n)\\s*(' +
  '(?:Lord(?:s)?|Lady|Sir|Dame|Chief Justice|Justice|Judge)?\\s*' +
  '[A-Z][a-zA-Z\'\\-]+(?: [A-Z][a-zA-Z\'\\-]+)*' +
  '(?:\\s+(?:' + JUDICIAL_TITLES.join('|') + '))+' +
  ')\\s*[:\\-—]?\\s*(?=\\n|$)',
  'gm'
);

// Coram / panel line patterns
const CORAM_RX = [
  /(?:Coram|Before|CORAM|BEFORE)[:\s]+([^\n]{5,250})/i,
  /(?:Presided? by|Heard by|Panel)[:\s]+([^\n]{5,250})/i,
  /(?:^|\n)((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:CJ|ACJ|JA|JJA|JJ|FCJ|J|LJ|LJJ|MR|VP|P)(?:,\s*)?)+)/m,
];

// Court name patterns — ordered most-specific first
const COURT_PATTERNS = [
  /High Court of Australia/i,
  /Federal Court of Australia/i,
  /Full (?:Federal )?Court/i,
  /Supreme Court of (?:New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|the Northern Territory|the Australian Capital Territory)/i,
  /Court of Appeal(?:\s+of\s+[A-Z][a-z]+)?/i,
  /Court of Criminal Appeal/i,
  /Family Court of Australia/i,
  /District Court/i,
  /County Court/i,
  /Magistrates(?:\'|s)? Court/i,
  /House of Lords/i,
  /Supreme Court of the United Kingdom/i,
  /Privy Council/i,
  /Court of Appeal(?:\s+\(England and Wales\))?/i,
  /Queen\'?s? Bench Division/i,
  /King\'?s? Bench Division/i,
  /Chancery Division/i,
  /(?:IN THE |BEFORE THE )?([A-Z][A-Z\s]+ COURT OF [A-Z][A-Z\s]+)/m,
  /(?:IN THE |BEFORE THE )([A-Z][A-Za-z\s]+ COURT)/m,
];

// Citation patterns
const CITATION_PATTERNS = [
  /\[\d{4}\]\s+(?:HCA|FCAFC|FCA|NSWCA|NSWSC|VCA|VSC|QCA|QSC|WASC|SASC|TASSC|ACTCA|NTCA)\s+\d+/,
  /\(\d{4}\)\s+\d+\s+(?:CLR|ALR|ALJR|FCR|NSWLR|VR|QdR|SASR|WAR|TASRP|ACTR|NTR|HCA)\s+\d+/,
  /\[\d{4}\]\s+(?:AC|QB|KB|Ch|WLR|All ER|UKSC|UKHL|EWCA|EWHC)\s+\d+/,
  /\(\d{4}\)\s+\d+\s+(?:AC|QB|KB|All ER|WLR)\s+\d+/,
];

// Heading patterns for section detection
const SECTION_HEADINGS = {
  facts: [
    /^(?:THE\s+)?(?:RELEVANT\s+)?FACTS?(?:\s+AND\s+BACKGROUND)?$/im,
    /^BACKGROUND(?:\s+FACTS?)?$/im,
    /^STATEMENT\s+OF\s+(?:RELEVANT\s+)?FACTS?$/im,
    /^FACTUAL\s+BACKGROUND$/im,
    /^THE\s+FACTS?$/im,
    /^FACTS?$/im,
  ],
  issue: [
    /^(?:THE\s+)?(?:LEGAL\s+)?ISSUES?$/im,
    /^(?:THE\s+)?QUESTIONS?\s+(?:FOR|AT\s+ISSUE|ON\s+APPEAL)?$/im,
    /^GROUNDS?\s+OF\s+APPEAL$/im,
    /^ISSUES?\s+FOR\s+DETERMINATION$/im,
    /^QUESTION\s+OF\s+LAW$/im,
  ],
  holding: [
    /^(?:THE\s+)?(?:COURT\'?S?\s+)?(?:FINAL\s+)?(?:DECISION|ORDERS?|RESULT|CONCLUSION|DISPOSITION|ORDERS?\s+MADE)$/im,
    /^(?:HELD|FINDING|JUDGMENT)$/im,
    /^(?:ORDERS?\s+OF\s+THE\s+COURT)$/im,
    /^(?:ALLOWING|DISMISSING)\s+THE\s+APPEAL$/im,
  ],
  ratio: [
    /^RATIO\s+DECIDENDI$/im,
    /^RATIO$/im,
    /^REASON\s+FOR\s+(?:THE\s+)?DECISION$/im,
    /^(?:THE\s+)?(?:APPLICABLE\s+)?(?:LEGAL\s+)?PRINCIPLES?$/im,
    /^(?:THE\s+)?LAW$/im,
  ],
  reasoning: [
    /^REASONING$/im,
    /^ANALYSIS$/im,
    /^DISCUSSION$/im,
    /^CONSIDERATION$/im,
    /^GROUNDS?\s+(?:OF\s+)?DECISION$/im,
    /^REASONS?\s+(?:FOR\s+)?(?:JUDGMENT|DECISION)$/im,
  ],
  dissent: [
    /^DISSENT(?:ING\s+JUDGMENT)?$/im,
    /^MINORITY\s+(?:JUDGMENT|OPINION)?$/im,
    /^DISSENTING\s+REASONS?$/im,
    /^(?:[A-Z][a-z]+\s+)?J?\s*(?:DISSENTING|DISSENT)$/im,
  ],
  notes: [
    /^NOTES?$/im,
    /^OBITER(?:\s+DICTA)?$/im,
    /^COMMENTARY$/im,
    /^(?:FURTHER\s+)?OBSERVATIONS?$/im,
    /^SIGNIFICANCE$/im,
  ],
};

// Holding signal phrases
const HOLDING_SIGNALS = [
  /\b(?:I|We)\s+would\s+(?:allow|dismiss|uphold|quash|affirm)\s+the\s+appeal\b/i,
  /\bappeal\s+(?:is\s+)?(?:allowed|dismissed|upheld|quashed|affirmed)\b/i,
  /\bapplication\s+(?:is\s+)?(?:granted|refused|dismissed)\b/i,
  /\bthe\s+(?:plaintiff|appellant|applicant|respondent|defendant)\s+(?:succeeds?|fails?|prevails?)\b/i,
  /\bjudgment\s+(?:for|against|in\s+favour\s+of)\s+the\b/i,
  /\border(?:ed|s)?\s+that\b/i,
  /\bheld\s+(?:unanimously\s+)?(?:that|by)\b/i,
  /\bthe\s+(?:court|majority)\s+held\b/i,
  /\bfind(?:s|ing)?\s+(?:in\s+favour|for|against)\b/i,
  /\bverdict\s+(?:of|for)\b/i,
];

// Ratio signal phrases
const RATIO_SIGNALS = [
  /\bthe\s+(?:general\s+)?(?:principle|rule|test|standard)\s+(?:is|that|applied)\b/i,
  /\bit\s+(?:follows|is\s+established)\s+that\b/i,
  /\bthe\s+law\s+(?:is|requires|provides)\b/i,
  /\bthe\s+(?:legal\s+)?(?:duty|obligation|liability|right)\s+(?:is|arises|exists)\b/i,
  /\bwe\s+(?:hold|conclude|find)\s+that\s+the\s+(?:rule|principle|law|test)\b/i,
  /\bthe\s+ratio\s+(?:decidendi|of\s+this\s+case)\b/i,
];

// Dissent signal phrases
const DISSENT_SIGNALS = [
  /\bI\s+(?:respectfully\s+)?dissent\b/i,
  /\bI\s+(?:would|must)\s+(?:respectfully\s+)?disagree\b/i,
  /\bwith\s+(?:great\s+)?respect,?\s+I\s+(?:cannot|disagree|dissent)\b/i,
  /\bthe\s+(?:majority|other\s+members)\s+(?:of\s+the\s+court\s+)?(?:take|hold)\s+a\s+different\s+view\b/i,
  /\bI\s+am\s+unable\s+to\s+agree\b/i,
  /\b(?:in\s+)?dissent(?:ing)?\b/i,
  /\bminority\s+(?:view|judgment|opinion)\b/i,
];


// ── TEXT CLEANING ─────────────────────────────────────────────────────────────

function cleanText(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x00/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\f/g, '\n\n')                      // form feeds → paragraph breaks
    .replace(/[ \t]{3,}/g, '  ')                 // collapse wide spaces
    .replace(/\n{5,}/g, '\n\n\n')                // max 3 consecutive newlines
    .replace(/^\s+|\s+$/g, '')                   // trim
    .substring(0, 80000);                        // safety cap
}

// Remove PDF artifacts: "Page 1 of 12", running headers, line numbers
function removePDFArtifacts(text) {
  return text
    .replace(/^Page\s+\d+\s+of\s+\d+\s*$/gim, '')
    .replace(/^\d+\s*$/gm, '')                   // standalone line numbers
    .replace(/^[-–—]{3,}\s*$/gm, '')             // horizontal rules
    .replace(/\[?\d+\]?\s*$/gm, '');             // trailing paragraph numbers
}


// ── METADATA EXTRACTION ───────────────────────────────────────────────────────

function extractCaseName(text) {
  const top = text.substring(0, 4000);

  // All-caps "X v Y" at start of line (typical judgment header)
  const allCaps = top.match(/^([A-Z][A-Z\s,().&''-]+\s+v\.?\s+[A-Z][A-Z\s,().&''-]+?)(?:\s*\n|\s{3,})/m);
  if (allCaps) return titleCase(allCaps[1].trim());

  // Title case "X v Y"
  const titleCaseMatch = top.match(/([A-Z][a-zA-Z\s,().&''-]+\s+v\.?\s+[A-Z][a-zA-Z\s,().&''-]+?)(?:\n|,\s*\(|\s{3,}|\[)/m);
  if (titleCaseMatch) return titleCaseMatch[1].trim().replace(/\s+/g, ' ');

  return '';
}

function titleCase(str) {
  const lowers = new Set(['a','an','the','and','but','or','for','nor','on','at','to','by','in','of','v','vs']);
  return str.toLowerCase().replace(/\b\w+/g, (w, i) =>
    i === 0 || !lowers.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  );
}

function extractCitation(text) {
  const top = text.substring(0, 5000);
  for (const rx of CITATION_PATTERNS) {
    const m = top.match(rx);
    if (m) return m[0].trim();
  }
  return '';
}

function extractYear(text, citation) {
  // Prefer year from citation
  if (citation) {
    const m = citation.match(/(\d{4})/);
    if (m) return m[1];
  }
  const m = text.substring(0, 3000).match(/((?:19|20)\d{2})/);
  return m ? m[1] : '';
}

function extractCourt(text) {
  const top = text.substring(0, 4000);

  // Named court patterns
  for (const rx of COURT_PATTERNS) {
    const m = top.match(rx);
    if (m) return (m[1] || m[0]).trim().replace(/\s+/g, ' ');
  }

  // "Court:" label
  const labelled = top.match(/Court:\s*([^\n]{4,80})/i);
  if (labelled) return labelled[1].trim();

  return '';
}

function extractJudges(text) {
  const top = text.substring(0, 5000);

  // Try coram/before lines first
  for (const rx of CORAM_RX) {
    const m = top.match(rx);
    if (m && m[1] && !hasBinaryChars(m[1])) {
      const cleaned = m[1].trim().replace(/\s+/g, ' ').replace(/\.$/, '');
      if (cleaned.length > 4 && cleaned.length < 300) return cleaned;
    }
  }

  // Scan for lines that ARE judge designations
  const judgeLines = [];
  const lines = top.split('\n');
  for (const line of lines) {
    const l = line.trim();
    if (!l || hasBinaryChars(l)) continue;
    if (/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:CJ|ACJ|JA|JJA|JJ|FCJ|J|LJ|LJJ|MR|VP|P)(?:,\s*)?)+$/.test(l)) {
      judgeLines.push(l);
    }
  }
  if (judgeLines.length) return judgeLines.join(', ').replace(/,\s*,/g, ',').trim();

  return '';
}

function hasBinaryChars(str) {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(str) ||
    (str.match(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g) || []).length > str.length * 0.05;
}


// ── DOCUMENT SEGMENTATION ─────────────────────────────────────────────────────

/**
 * Split text into named segments by detecting headings.
 * Returns { name: string, body: string }[]
 */
function segmentDocument(text) {
  // Candidate heading: short line (<80 chars), possibly numbered, ALL CAPS or Title Case
  // followed by substantive content
  const lines = text.split('\n');
  const segments = [];
  let currentName = '_preamble';
  let currentLines = [];

  const headingRx = /^(?:\d+\.?\s+|[IVXLC]+\.?\s+)?([A-Z][A-Z\s&'()-]{2,60}[A-Z])(?:\s*$|\s*:)/;
  const titleHeadingRx = /^(?:\d+\.?\s+)?([A-Z][a-z][a-zA-Z\s&'()-]{3,60})(?:\s*$|\s*:)/;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trim();

    // A heading must: be short, not end in sentence punctuation,
    // not start lowercase, have alphabetic content, and ideally be
    // preceded/followed by a blank line
    const prevBlank = li === 0 || lines[li - 1].trim() === '';
    const nextBlank = li === lines.length - 1 || lines[li + 1].trim() === '';
    const boundaryOk = prevBlank || nextBlank;

    const isHeading =
      trimmed.length > 2 && trimmed.length < 80 &&
      !hasBinaryChars(trimmed) &&
      (headingRx.test(trimmed) || titleHeadingRx.test(trimmed)) &&
      !/^[a-z]/.test(trimmed) &&
      !/[.!?,;]$/.test(trimmed) &&
      (trimmed.match(/[a-zA-Z]/g) || []).length > 2 &&
      (boundaryOk || /^(?:[IVXLC]+|\d+)\.\s+[A-Z]/.test(trimmed));

    if (isHeading && currentLines.join('').trim().length > 30) {
      segments.push({ name: currentName, body: currentLines.join('\n').trim() });
      currentName = trimmed;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length) {
    segments.push({ name: currentName, body: currentLines.join('\n').trim() });
  }

  return segments;
}

/**
 * Match a segment name to one of the 7 legal sections.
 * Returns section key or null.
 */
function classifySegment(segmentName) {
  const n = segmentName.trim().toUpperCase();
  for (const [key, patterns] of Object.entries(SECTION_HEADINGS)) {
    for (const rx of patterns) {
      if (rx.test(n) || rx.test(segmentName.trim())) return key;
    }
  }
  return null;
}


// ── JUDGE ATTRIBUTION ENGINE ──────────────────────────────────────────────────

/**
 * Parse a block of reasoning text and split into per-judge attribution.
 * Returns { judgeName: string, text: string }[]
 */
function attributeByJudge(text, knownJudges) {
  if (!text) return [];

  // Build a list of judge surname patterns from known judges
  const judgeNames = [];

  if (knownJudges) {
    // Parse "Gibbs CJ, Mason J" etc.
    const parts = knownJudges.split(/[,;]/);
    for (const part of parts) {
      const m = part.trim().match(/^(?:Lord(?:s)?|Lady|Sir|Dame|Justice\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:CJ|ACJ|JA|JJA|JJ|FCJ|J|LJ|LJJ|MR|VP|P|LJ)?/);
      if (m) judgeNames.push(m[1].trim());
    }
  }

  // Scan text for judge attribution lines: "Mason J:", "Lord Atkin:", "Gibbs CJ:"
  const attributionRx = new RegExp(
    '(?:^|\\n)\\s*(' +
      '(?:Lord(?:s)?|Lady|Sir|Dame)?\\s*' +
      '[A-Z][a-zA-Z\'-]+(?: [A-Z][a-zA-Z\'-]+)?' +
      '(?:\\s+(?:' + JUDICIAL_TITLES.join('|') + '))?' +
    ')\\s*(?::|\\((?:dissenting|majority|concurring)\\)\\s*:?)\\s*',
    'gm'
  );

  const matches = [];
  let m;
  while ((m = attributionRx.exec(text)) !== null) {
    matches.push({ name: m[1].trim(), index: m.index + m[0].length });
  }

  if (!matches.length) {
    // No explicit attribution — return as single unattributed block
    return [{ judgeName: '', text: text.trim() }];
  }

  // Slice text between attribution markers
  const attributed = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end   = i + 1 < matches.length ? matches[i + 1].index - matches[i + 1].name.length - 10 : text.length;
    const body  = text.slice(start, end).trim();
    if (body.length > 20) {
      attributed.push({ judgeName: matches[i].name, text: body });
    }
  }

  return attributed.length ? attributed : [{ judgeName: '', text: text.trim() }];
}

/**
 * Format attributed reasoning into human-readable string.
 */
function formatAttribution(attributions) {
  if (!attributions.length) return '';
  if (attributions.length === 1 && !attributions[0].judgeName) {
    return attributions[0].text;
  }
  return attributions.map(a =>
    a.judgeName
      ? `${a.judgeName}:\n${a.text}`
      : a.text
  ).join('\n\n');
}


// ── CONTENT-BASED SECTION EXTRACTION ─────────────────────────────────────────

/**
 * When heading-based segmentation finds no matches for a section,
 * fall back to content-signal scanning.
 */
function extractBySignals(text, section) {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 60);
  if (!paras.length) return '';

  switch (section) {

    case 'holding': {
      const hits = paras.filter(p => HOLDING_SIGNALS.some(rx => rx.test(p)));
      if (hits.length) return hits.slice(0, 3).join('\n\n');
      // Last ~20% of document often contains orders
      return paras.slice(-Math.max(1, Math.floor(paras.length * 0.2))).join('\n\n').substring(0, 800);
    }

    case 'ratio': {
      const hits = paras.filter(p => RATIO_SIGNALS.some(rx => rx.test(p)));
      return hits.slice(0, 4).join('\n\n').substring(0, 1200);
    }

    case 'dissent': {
      const hits = paras.filter(p => DISSENT_SIGNALS.some(rx => rx.test(p)));
      return hits.join('\n\n').substring(0, 1500);
    }

    case 'facts': {
      // First 25% of substantive content is usually background/facts
      const end = Math.max(3, Math.floor(paras.length * 0.25));
      return paras.slice(0, end).join('\n\n').substring(0, 2000);
    }

    case 'issue': {
      // Look for question-framed paragraphs
      const hits = paras.filter(p =>
        /\bwhether\b/i.test(p) ||
        /\bthe\s+(?:key\s+)?question(?:\s+(?:is|for determination))?\b/i.test(p) ||
        /\bthe\s+(?:main\s+)?issue\b/i.test(p) ||
        /\b(?:at\s+)?(?:issue|dispute)\s+(?:is|in\s+this\s+(?:case|appeal))\b/i.test(p)
      );
      if (hits.length) return hits.slice(0, 2).join('\n\n').substring(0, 600);
      return paras.slice(0, 2).join('\n\n').substring(0, 400);
    }

    case 'reasoning': {
      // Middle 50% of document
      const start = Math.floor(paras.length * 0.2);
      const end   = Math.floor(paras.length * 0.85);
      return paras.slice(start, end).join('\n\n').substring(0, 3000);
    }

    case 'notes': {
      return ''; // Notes are generated — not extracted
    }

    default:
      return '';
  }
}


// ── NOTES GENERATION ─────────────────────────────────────────────────────────

/**
 * Generate study notes from extracted content — purely rule-based.
 * Does NOT invent anything not present in the text.
 */
function generateNotes(brief, text) {
  const notes = [];

  // Pull ratio as first note
  if (brief.ratio) {
    const ratioSnippet = brief.ratio.split('\n')[0].substring(0, 200);
    notes.push(`Key principle: ${ratioSnippet}`);
  }

  // Identify if dissent exists
  if (brief.dissent) {
    notes.push('Dissenting judgment present. Compare majority and minority reasoning for exam purposes.');
  } else {
    notes.push('Decision appears unanimous — no dissent identified in this document.');
  }

  // Court hierarchy note
  const courtText = (brief.court || '').toLowerCase();
  if (/high court/i.test(courtText)) {
    notes.push('High Court of Australia decision — binding on all Australian courts.');
  } else if (/house of lords|supreme court of the united kingdom/i.test(courtText)) {
    notes.push('House of Lords / UK Supreme Court — persuasive authority in Australian courts.');
  } else if (/privy council/i.test(courtText)) {
    notes.push('Privy Council decision — historically binding on Australian courts prior to 1986.');
  } else if (/court of appeal/i.test(courtText)) {
    notes.push('Court of Appeal decision — binding on courts below in this jurisdiction.');
  }

  // Extract any obiter dicta signals
  const obiterRx = /(?:obiter|by\s+way\s+of\s+observation|I\s+note\s+in\s+passing|it\s+is\s+not\s+necessary\s+to\s+decide)[^.]{10,200}\./gi;
  const obiterMatches = text.match(obiterRx);
  if (obiterMatches && obiterMatches.length) {
    notes.push(`Obiter dicta present — see judgment for non-binding observations.`);
  }

  return notes.filter(Boolean).join('\n\n');
}


// ── MAIN EXTRACTION PIPELINE ──────────────────────────────────────────────────

/**
 * Trim a section body if it bleeds into the next section.
 * Looks for ALL-CAPS headings that match other section patterns.
 */
function trimSectionOverflow(body, currentKey) {
  if (!body) return body;
  // List of heading patterns for sections OTHER than currentKey
  const otherHeadings = [];
  for (const [key, patterns] of Object.entries(SECTION_HEADINGS)) {
    if (key !== currentKey) {
      for (const rx of patterns) {
        otherHeadings.push(rx);
      }
    }
  }
  const lines = body.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (otherHeadings.some(rx => rx.test(t))) {
      // Trim here
      return lines.slice(0, i).join('\n').trim();
    }
  }
  return body;
}

/**
 * Primary entry point.
 * @param {string} rawText  — cleaned text from PDF.js / mammoth / plain
 * @param {string} filename — original filename for fallback naming
 * @returns {object}        — 12-key brief object
 */
function extract(rawText, filename) {
  // 1. Clean
  let text = cleanText(rawText);
  text = removePDFArtifacts(text);

  // 2. Metadata
  const name     = extractCaseName(text)     || filenameToName(filename);
  const citation = extractCitation(text);
  const year     = extractYear(text, citation);
  const court    = extractCourt(text);
  const judges   = extractJudges(text);

  // 3. Segment document by headings
  const segments = segmentDocument(text);

  // 4. Map segments to section keys
  const sectionContent = {
    facts: [], issue: [], holding: [], ratio: [],
    reasoning: [], dissent: [], notes: [],
  };

  for (const seg of segments) {
    const key = classifySegment(seg.name);
    if (key && sectionContent[key] !== undefined) {
      sectionContent[key].push(seg.body);
    }
  }

  // 5. For sections with no heading match, use content-signal fallback
  for (const key of Object.keys(sectionContent)) {
    if (!sectionContent[key].length) {
      const signal = extractBySignals(text, key);
      if (signal) sectionContent[key] = [signal];
    }
  }

  // 6. Merge multi-segment sections and trim overflow
  const merged = {};
  for (const [k, arr] of Object.entries(sectionContent)) {
    merged[k] = trimSectionOverflow(arr.join('\n\n').trim(), k).substring(0, 3000);
  }

  // 7. Attribute reasoning by judge
  if (merged.reasoning) {
    const attributions = attributeByJudge(merged.reasoning, judges);
    merged.reasoning = formatAttribution(attributions);
  }

  // 8. Check dissent — if no heading found, scan for dissent signals
  if (!merged.dissent) {
    const dissentParas = text.split(/\n{2,}/)
      .filter(p => DISSENT_SIGNALS.some(rx => rx.test(p)))
      .slice(0, 5)
      .join('\n\n')
      .substring(0, 1500);
    if (dissentParas) merged.dissent = dissentParas;
  }

  // 9. Generate notes if absent
  if (!merged.notes) {
    merged.notes = generateNotes({ ...merged, court }, text);
  }

  // 10. Normalise and return
  return normalise({
    name, citation, court, year, judges,
    facts:     merged.facts,
    issue:     merged.issue,
    holding:   merged.holding,
    ratio:     merged.ratio,
    reasoning: merged.reasoning,
    dissent:   merged.dissent,
    notes:     merged.notes,
  }, filename);
}

function filenameToName(filename) {
  return (filename || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalise(obj, filename) {
  const clean = (v) => (v || '').replace(/\s{3,}/g, '\n\n').trim();
  return {
    name:      clean(obj.name)      || filenameToName(filename),
    citation:  clean(obj.citation),
    court:     clean(obj.court),
    year:      clean(obj.year),
    judges:    clean(obj.judges),
    facts:     clean(obj.facts),
    issue:     clean(obj.issue),
    holding:   clean(obj.holding),
    ratio:     clean(obj.ratio),
    reasoning: clean(obj.reasoning),
    dissent:   clean(obj.dissent),
    notes:     clean(obj.notes),
  };
}


module.exports = { extract, cleanText };
