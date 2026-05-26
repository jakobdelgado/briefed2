/**
 * BRIEFED — LOCAL LEGAL EXTRACTION ENGINE v4.0
 * -----------------------------------------------
 * Pure Node.js. Zero external AI dependencies. Zero API keys.
 * Implements the 7-section case brief methodology:
 *   1. Relevant Facts   2. Issue   3. Holding
 *   4. Ratio Decidendi  5. Reasoning  6. Dissent  7. Notes
 *
 * Rules (from engine specification):
 *  - Use ONLY information contained in the source material
 *  - Do NOT infer, assume, or introduce external legal knowledge
 *  - If information is missing -> output exactly "Not specified"
 *  - Preserve doctrinal meaning exactly
 *  - Attribute reasoning to specific judges where possible
 */
'use strict';

// ── SECTION HEADING PATTERNS ─────────────────────────────────────────────────
// Maps each of the 7 sections to all heading variants found in judgments/briefs

const SECTION_PATTERNS = {
    facts: [
          /^relevant\s+facts?\s*[:.]?\s*$/i,
          /^facts?\s*[:.]?\s*$/i,
          /^background\s+(?:facts?|and\s+facts?)\s*[:.]?\s*$/i,
          /^factual\s+(?:background|matrix|findings?)\s*[:.]?\s*$/i,
          /^the\s+facts?\s*[:.]?\s*$/i,
          /^statement\s+of\s+facts?\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*facts?\s*$/i,
          /^01[\.\)]\s*relevant\s+facts?\s*$/i,
        ],
    issue: [
          /^issues?\s*[:.]?\s*$/i,
          /^legal\s+issues?\s*[:.]?\s*$/i,
          /^questions?\s+(?:of\s+law\s+)?(?:for\s+determination\s+)?[:.]?\s*$/i,
          /^the\s+issues?\s*[:.]?\s*$/i,
          /^questions?\s+(?:raised|at\s+issue|in\s+dispute)\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*issues?\s*$/i,
          /^02[\.\)]\s*issues?\s*$/i,
        ],
    holding: [
          /^holding\s*[:.]?\s*$/i,
          /^held\s*[:.]?\s*$/i,
          /^decision\s*[:.]?\s*$/i,
          /^judgment\s*[:.]?\s*$/i,
          /^orders?\s*[:.]?\s*$/i,
          /^result\s*[:.]?\s*$/i,
          /^the\s+court\s+held\s*[:.]?\s*$/i,
          /^conclusion\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*(?:holding|held|decision)\s*$/i,
          /^03[\.\)]\s*holding\s*$/i,
        ],
    ratio: [
          /^ratio\s+decidendi\s*[:.]?\s*$/i,
          /^ratio\s*[:.]?\s*$/i,
          /^reason\s+for\s+(?:the\s+)?decision\s*[:.]?\s*$/i,
          /^reasons?\s+for\s+(?:the\s+)?(?:judgment|decision)\s*[:.]?\s*$/i,
          /^legal\s+(?:principle|rule|basis)\s*[:.]?\s*$/i,
          /^the\s+ratio\s*[:.]?\s*$/i,
          /^controlling\s+(?:principle|rule)\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*ratio\s*(?:decidendi)?\s*$/i,
          /^04[\.\)]\s*ratio\s*(?:decidendi)?\s*$/i,
        ],
    reasoning: [
          /^reasoning\s*[:.]?\s*$/i,
          /^reasons?\s*[:.]?\s*$/i,
          /^analysis\s*[:.]?\s*$/i,
          /^the\s+(?:court'?s?\s+)?reasoning\s*[:.]?\s*$/i,
          /^judicial\s+reasoning\s*[:.]?\s*$/i,
          /^application\s*[:.]?\s*$/i,
          /^(?:majority\s+)?reasoning\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*reasoning\s*$/i,
          /^05[\.\)]\s*reasoning\s*$/i,
        ],
    dissent: [
          /^dissent(?:ing\s+(?:judgment|opinion|reasoning))?\s*[:.]?\s*$/i,
          /^minority\s+(?:judgment|opinion|reasoning)?\s*[:.]?\s*$/i,
          /^(?:the\s+)?dissent\s*[:.]?\s*$/i,
          /^dissenting\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*dissent\s*$/i,
          /^06[\.\)]\s*dissent\s*$/i,
        ],
    notes: [
          /^notes?\s*[:.]?\s*$/i,
          /^(?:key\s+)?(?:study\s+)?notes?\s*[:.]?\s*$/i,
          /^doctrinal\s+(?:significance|notes?)\s*[:.]?\s*$/i,
          /^significance\s*[:.]?\s*$/i,
          /^commentary\s*[:.]?\s*$/i,
          /^observations?\s*[:.]?\s*$/i,
          /^\d+[\.\)]\s*notes?\s*$/i,
          /^07[\.\)]\s*(?:key\s+)?notes?\s*$/i,
        ],
};

// ── TEXT CLEANING ─────────────────────────────────────────────────────────────

function cleanText(raw) {
    return raw
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')   // control chars
    .replace(/\uFFFD/g, ' ')                                 // replacement char
    .replace(/[ \t]+/g, ' ')                                 // collapse spaces
    .replace(/\n{3,}/g, '\n\n')                              // max double newline
    .trim();
}

// ── METADATA EXTRACTION ───────────────────────────────────────────────────────

function extractCaseName(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Pattern 1: "X v Y [year]" or "X v Y (year)" — all-caps or title case
  const vPattern = /^([A-Z][A-Z\s,\-'\.&]+)\s+[Vv][Ss]?\.?\s+([A-Z][A-Z\s,\-'\.&]+?)(?:\s*[\[\(]\d{4}[\]\)].*)?$/;
    const vPatternTitle = /^([A-Z][a-z][A-Za-z\s,\-'\.&]+)\s+[Vv][Vs]?\.?\s+([A-Z][a-z][A-Za-z\s,\-'\.&]+?)(?:\s*[\[\(]\d{4}[\]\)].*)?$/;

  for (const line of lines.slice(0, 10)) {
        const clean = line.replace(/\*+/g, '').trim();
        if (vPattern.test(clean) || vPatternTitle.test(clean)) {
                // Return just the party names without citation
          const m = clean.match(/^(.+?\s+[Vv][Vs]?\.?\s+[A-Z][A-Za-z\s,\-'\.&]+?)(?:\s*[\[\(]\d{4}|$)/);
                if (m) return m[1].trim();
                return clean;
        }
  }

  // Pattern 2: Look for "Case Name:" label
  const labelMatch = text.match(/^case\s+name\s*[:]\s*(.+)$/im);
    if (labelMatch) return labelMatch[1].trim();

  // Pattern 3: Any early line containing " v " or " vs "
  for (const line of lines.slice(0, 15)) {
        if (/\s+[Vv][Vs]?\.?\s+/.test(line) && line.length < 120) {
                return line.replace(/[\[\(]\d{4}.*/, '').trim();
        }
  }

  return 'Not specified';
}

function extractCitation(text) {
    // Australian and UK citation formats
  const patterns = [
        /\((\d{4})\)\s+(\d+)\s+(CLR|ALR|ALJR|ACLC|ACSR|FCR|NSWLR|VR|QdR|SASR|WAR|TLR|AC|QB|WLR|All\s+ER|EWCA|UKSC|HCA)\s+(\d+)/gi,
        /\[(\d{4})\]\s+(\d+)?\s*(CLR|ALR|ALJR|AC|QB|WLR|All\s+ER|HCA|UKSC|EWCA)\s+(\d+)/gi,
        /\((\d{4})\)\s+(\d+)\s+(CLR|ALR|FCR|HCA)\s+(\d+)/gi,
      ];

  for (const pattern of patterns) {
        const m = text.match(pattern);
        if (m) return m[0];
  }

  // Look for bracketed year + reporter
  const broad = text.match(/[\[\(]\d{4}[\]\)]\s+\d*\s*[A-Z]{2,5}\s+\d+/);
    if (broad) return broad[0];

  return 'Not specified';
}

function extractCourt(text) {
    const courts = [
      { pattern: /high\s+court\s+of\s+australia/i, name: 'High Court of Australia' },
      { pattern: /\bHCA\b/, name: 'High Court of Australia' },
      { pattern: /federal\s+court\s+of\s+australia/i, name: 'Federal Court of Australia' },
      { pattern: /supreme\s+court\s+of\s+(?:new\s+south\s+wales|nsw)/i, name: 'Supreme Court of New South Wales' },
      { pattern: /supreme\s+court\s+of\s+(?:victoria|vic)/i, name: 'Supreme Court of Victoria' },
      { pattern: /supreme\s+court\s+of\s+queensland/i, name: 'Supreme Court of Queensland' },
      { pattern: /supreme\s+court\s+of\s+(?:western\s+australia|wa)/i, name: 'Supreme Court of Western Australia' },
      { pattern: /supreme\s+court\s+of\s+(?:south\s+australia|sa)/i, name: 'Supreme Court of South Australia' },
      { pattern: /court\s+of\s+appeal/i, name: 'Court of Appeal' },
      { pattern: /house\s+of\s+lords/i, name: 'House of Lords' },
      { pattern: /privy\s+council/i, name: 'Privy Council' },
      { pattern: /uk\s+supreme\s+court/i, name: 'UK Supreme Court' },
      { pattern: /\bUKSC\b/, name: 'UK Supreme Court' },
        ];

  // First check for labelled court
  const labelMatch = text.match(/^court\s*[:]\s*(.+)$/im);
    if (labelMatch) return labelMatch[1].trim();

  for (const { pattern, name } of courts) {
        if (pattern.test(text)) return name;
  }
    return 'Not specified';
}

function extractJudges(text) {
    // Look for Coram/Before lines
  const coramMatch = text.match(/(?:coram|before|bench)\s*[:]\s*([^\n]+)/i);
    if (coramMatch) {
          return coramMatch[1].trim().replace(/\s+/g, ' ');
    }

  // Look for "Judges:" label
  const judgesLabel = text.match(/^judges?\s*[:]\s*(.+)$/im);
    if (judgesLabel) return judgesLabel[1].trim();

  // Look for lists of judicial titles in header area (first 500 chars)
  const header = text.substring(0, 800);
    const judgePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:CJ|ACJ|JA|JJ?|FCJ|NPJ|DPFJ|LJJ?|MR|VP|P|Lord|Lady|Baron(?:ess)?|Sir|Dame|Justice))/g;
    const found = header.match(judgePattern);
    if (found && found.length > 0) return [...new Set(found)].join(', ');

  return 'Not specified';
}

function extractYear(text) {
    const m = text.match(/[\[\(](\d{4})[\]\)]/);
    return m ? m[1] : '';
}

// ── SECTION SEGMENTATION ──────────────────────────────────────────────────────

function matchesHeading(line, patterns) {
    const trimmed = line.trim();
    return patterns.some(p => p.test(trimmed));
}

function identifyHeading(line) {
    for (const [section, patterns] of Object.entries(SECTION_PATTERNS)) {
          if (matchesHeading(line, patterns)) return section;
    }
    return null;
}

function segmentDocument(text) {
    const lines = text.split('\n');
    const segments = {};
    let currentSection = null;
    let currentLines = [];
    let preHeadingLines = [];
    let foundFirstHeading = false;

  for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const section = identifyHeading(line);

      if (section) {
              // Save previous section
          if (currentSection) {
                    segments[currentSection] = (segments[currentSection] || '') + currentLines.join('\n');
          } else if (!foundFirstHeading) {
                    preHeadingLines = currentLines.slice();
          }
              foundFirstHeading = true;
              currentSection = section;
              currentLines = [];
      } else {
              if (!foundFirstHeading) {
                        currentLines.push(line);
              } else {
                        currentLines.push(line);
              }
      }
  }

  // Save last section
  if (currentSection) {
        segments[currentSection] = (segments[currentSection] || '') + currentLines.join('\n');
  }

  return { segments, preHeadingLines };
}

function cleanSection(text) {
    if (!text) return '';
    return text
      .replace(/^[\s\n]+/, '')   // leading whitespace
    .replace(/[\s\n]+$/, '')   // trailing whitespace
    .replace(/\n{3,}/g, '\n\n') // max double newline
    .trim();
}

// ── SIGNAL-BASED FALLBACK EXTRACTION ─────────────────────────────────────────
// Used when no headings are found in the document

function fallbackExtract(text) {
    const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
    const result = {};

  // Holding signals
  const holdingSignals = /\b(held|ordered|appeal\s+(?:allowed|dismissed)|judgment\s+(?:for|against)|found\s+(?:in\s+favour|against)|the\s+court\s+(?:held|ordered|found|dismissed|allowed))\b/i;

  // Ratio signals
  const ratioSignals = /\b(the\s+(?:principle|rule)\s+is|the\s+controlling\s+(?:principle|rule)|the\s+ratio|as\s+a\s+matter\s+of\s+(?:law|principle)|the\s+law\s+(?:is|requires|provides))\b/i;

  // Dissent signals
  const dissentSignals = /\b(dissent(?:ing|ed)?|I\s+respectfully\s+(?:dissent|disagree)|in\s+dissent|minority\s+(?:judgment|opinion))\b/i;

  let holdingPara = '';
    let ratioPara = '';
    let dissentPara = '';
    const otherParas = [];

  for (const para of paras) {
        if (!holdingPara && holdingSignals.test(para)) {
                holdingPara = para;
        } else if (!ratioPara && ratioSignals.test(para)) {
                ratioPara = para;
        } else if (!dissentPara && dissentSignals.test(para)) {
                dissentPara = para;
        } else {
                otherParas.push(para);
        }
  }

  // Facts: first substantive paragraph(s) not classified as holding/ratio/dissent
  result.facts = otherParas.slice(0, 3).join('\n\n') || 'Not specified';
    result.issue = 'Not specified';
    result.holding = holdingPara || 'Not specified';
    result.ratio = ratioPara || 'Not specified';
    result.reasoning = otherParas.slice(3).join('\n\n') || 'Not specified';
    result.dissent = dissentPara || 'Not specified';
    result.notes = 'Not specified';

  return result;
}

// ── JUDGE ATTRIBUTION IN REASONING ───────────────────────────────────────────

function structureReasoning(rawReasoning) {
    if (!rawReasoning || rawReasoning.trim() === '') return 'Not specified';

  // Pattern: "Mason CJ:", "Lord Atkin:", "Brennan J:" etc. at start of line
  const judgeLinePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:CJ|ACJ|JA|JJ?|FCJ|LJJ?|MR|J|Justice|Lord|Lady|Baron(?:ess)?|Sir|Dame)\.?)\s*:/gm;
    const hasAttribution = judgeLinePattern.test(rawReasoning);

  if (hasAttribution) {
        // Already attributed — clean and return
      return rawReasoning
          .replace(/^[\s\n]+/, '')
          .replace(/[\s\n]+$/, '')
          .trim();
  }

  return rawReasoning.trim();
}

// ── NOTES GENERATION FROM SOURCE ─────────────────────────────────────────────
// Only generate notes from what's actually in the document — no external knowledge

function deriveNotes(segments, text) {
    // If there's an explicit notes section, use it
  if (segments.notes && segments.notes.trim().length > 10) {
        return cleanSection(segments.notes);
  }

  // Otherwise derive minimal notes from ratio and holding — no invention
  const parts = [];

  if (segments.ratio && segments.ratio.trim() && segments.ratio.trim() !== 'Not specified') {
        const ratioClean = cleanSection(segments.ratio);
        if (ratioClean.length > 20) {
                parts.push('Key principle: ' + ratioClean.split('\n')[0].trim());
        }
  }

  if (segments.dissent && segments.dissent.trim() && !/not\s+specified/i.test(segments.dissent)) {
        parts.push('Dissenting judgment present. Compare majority and minority reasoning for exam purposes.');
  }

  const court = extractCourt(text);
    if (court !== 'Not specified') {
          parts.push(court + ' decision.');
    }

  return parts.length > 0 ? parts.join('\n\n') : 'Not specified';
}

// ── MAIN EXTRACT FUNCTION ─────────────────────────────────────────────────────

function extract(rawText, filename) {
    const text = cleanText(rawText);

  // Extract metadata
  const name = extractCaseName(text);
    const citation = extractCitation(text);
    const court = extractCourt(text);
    const judges = extractJudges(text);
    const year = extractYear(text);

  // Segment the document by headings
  const { segments, preHeadingLines } = segmentDocument(text);
    const hasHeadings = Object.keys(segments).length > 0;

  let facts, issue, holding, ratio, reasoning, dissent, notes;

  if (hasHeadings) {
        // Use heading-based extraction
      facts     = cleanSection(segments.facts)     || 'Not specified';
        issue     = cleanSection(segments.issue)     || 'Not specified';
        holding   = cleanSection(segments.holding)   || 'Not specified';
        ratio     = cleanSection(segments.ratio)     || 'Not specified';
        reasoning = structureReasoning(cleanSection(segments.reasoning));
        dissent   = cleanSection(segments.dissent)   || 'Not specified';
        notes     = deriveNotes(segments, text);
  } else {
        // No headings — use signal-based fallback
      const fb = fallbackExtract(text);
        facts     = fb.facts;
        issue     = fb.issue;
        holding   = fb.holding;
        ratio     = fb.ratio;
        reasoning = fb.reasoning;
        dissent   = fb.dissent;
        notes     = fb.notes;
  }

  // Ensure empty strings become "Not specified"
  const ns = v => (v && v.trim().length > 3 ? v : 'Not specified');

  return {
        name:      ns(name),
        citation:  ns(citation),
        court:     ns(court),
        year:      year || '',
        judges:    ns(judges),
        facts:     ns(facts),
        issue:     ns(issue),
        holding:   ns(holding),
        ratio:     ns(ratio),
        reasoning: ns(reasoning),
        dissent:   ns(dissent),
        notes:     ns(notes),
  };
}

module.exports = { extract };
